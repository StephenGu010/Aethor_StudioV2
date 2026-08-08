# 阶段 4 提示词：C# 网关与只读 COM4

目标是建立 .NET 10 LTS 网关并在监督下读取 Dummy 状态。本阶段不得发送使能、停止、回零、复位、模式或关节运动命令。

## 任务

1. 在 `services/robot-gateway` 建立 Domain/Application/Infrastructure/API 分层和对应测试项目，保持依赖朝向领域与应用层。
2. 实现串口枚举、手动连接/断开、单一所有者、异步读取、newline framing、取消、超时、拔出、端口占用和进程退出清理。
3. 先用 fake serial 验证 parser、session 状态机和故障恢复，再接入 Windows `SerialPort`；默认参数 115200 仅来自协议配置。
4. 提供 loopback REST/SignalR 与 `RobotGatewayV1` adapter；要求桌面壳会话令牌。开发模式使用显式开发令牌流程，不能监听外网。
5. 前端设备页显示真实端口枚举和只读 session/feedback；静态源与真实源有清晰切换和来源标记。
6. 用户现场确认后才可手动选择 COM4，依次只发送批准的查询：`#GETJPOS`、`#GETMODE`、`#GETENABLE`。记录原始帧，出现异常立即断开。

## 验收

- 单元/集成/fake serial 覆盖并发连接、拔线、乱码、半帧、超时和关闭。
- API 仅 loopback，未认证请求拒绝；同一时刻只有一个串口读取循环。
- 真实验收只读且由用户监督；没有运动或状态改变命令。
- 前端不把端口存在等同于 connected，不把过期反馈显示为当前值。

完成后写 `docs/handoffs/phase-04.md`，附 .NET/驱动版本、端口硬件 ID、查询日志和清理验证。

