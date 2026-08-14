# Dummy 连续动作故障恢复交接

- 状态：`DONE（软件修复）`
- 日期：2026-08-14
- 适用范围：Dummy engineering 控制台、`dummy-ascii-v1`、Windows 串口网关
- 实机复验：未执行；需要新的 COM4 现场授权

## 现场现象与证据

桌面日志中的同一会话 `50d070b0a381474a886b9258843bccdc` 记录了三次关节组写入：03:01:48、03:02:00、03:02:21 均为 `engineering.motion.transport_written`。第二次动作后出现一次 `#GETJPOS` timeout 并恢复；第三次动作后再次 timeout，随后 Windows 串口写入抛出原生错误 121，网关记录 `serial.polling.faulted` 并释放 transport。

页面显示的 `GATEWAY WARNING / 网关响应不符合 RobotGatewayV1 契约` 不是第三次动作响应本身。查询 timeout 会生成没有 correlation ID 的错误 `ProtocolFrame`；C# 旧 wire shape 写成 `correlationId: null`，而 `RobotGatewayV1` 定义的是可选 string。前端严格校验因此拒绝整条实时事件，遮蔽了真正的查询退化。

## 修复内容

1. `ProtocolFrame.CorrelationId` 为 null 时不再写入 JSON；有真实关联号时保持原字段。
2. `SerialWriteRequest` 新增默认关闭的 `RetryOnTransientTimeout`。只有网关内部的 `#GETJPOS/#GETMODE/#GETENABLE` 设置为 true。
3. 显式可重试查询遇到一次 `TimeoutException` 或 Win32 code 121 时等待 100 ms，再尝试一次相同查询。
4. 关节组、使能、停止、去使能、模式和人工终端写入保持默认关闭；主机不会因为不确定结果而重复动作。
5. probe 新增 `RetriedWrites`，首次恢复写入记录 `serial.scheduler.write.retry`；第二次失败继续执行原有 fault、close、dispose。

## 回归证据

- Gateway 150/150，0 warning/error。
- 整仓 contracts 125 + frontend 246 + gateway 150 + desktop 118 + legal 6，共 645/645。
- Web production 2658 modules；Gateway/Desktop Release 构建均为 0 warning/error。
- 覆盖无关联协议帧序列化、Win32 121 首次失败后查询恢复、RobotGateway 生产轮询接线、动作 timeout 只尝试一次以及 transport fault 资源释放。
- 隔离 wrapper：`serialPortOpened=false / hardwareCommandSent=false`。

## 现场复验步骤

1. 使用包含本修复的桌面包，确认只有一个 Gateway 和一个串口 owner。
2. 连接 COM4，等待 session/feedback/motor/mode 均为有效反馈。
3. 在现场人员确认后连续下发三次小幅、低速关节组目标；每次记录 request ID 与时间。
4. 核对 `directCommandHistory` 的 `transportWritten`、持续 `#GETJPOS`、模型更新和 `RetriedWrites`。
5. 若出现一次 `serial.scheduler.write.retry` 后恢复，可继续只读观察；若出现 `write.failed/polling.faulted`，停止操作并释放会话，不重放动作。
6. 复验完成后保存诊断包，并确认退出后 Gateway、Desktop 与 COM 句柄均已释放。

## 未宣称的结果

- 软件测试不能证明 COM4 的 USB/CDC 链路已经稳定。
- `transportWritten` 只证明主机写入完成，不证明固件执行或机械臂到位。
- 本修复没有改变 Dummy 固件，也没有自动重试任何动作。
