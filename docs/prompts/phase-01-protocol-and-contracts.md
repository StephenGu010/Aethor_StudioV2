# 阶段 1 提示词：协议、契约与安全状态机

在阶段 0 完成后执行。以指定 `dummy_ref` 固件提交为事实源，把 Dummy ASCII 协议变成可测试、可审计的共享契约；本阶段禁止打开 COM4。

## 任务

1. 对照 README 和固件源码记录 115200/newline、分支解析、ACK、错误、队列余量及模式 1–3 的真实语义；证据不明确处标为未知。
2. 在 `shared/contracts` 完成 `RobotProfileManifestV1`、session/frame/command/result/protocol/signal/desktop capability Schema 与 TS/C# 生成或一致性策略。
3. 实现纯函数 formatter/parser：处理分片、粘包、空行、未知行、数值错误、超长行和取消。
4. 定义 session 与 command 状态机，区分 accepted、completed、failed、timed out、cancelled、unconfirmed；模式 2 的 `ok` 不得解释为物理运动完成。
5. 建立 transport 接口和 fake serial；串口快捷命令从白名单生成，不允许任意命令混入结构化控制。
6. 更新协议文档、接口说明、测试和 handoff。

## 验收

- 固件样例、异常帧、随机分块、队列满、超时和断开测试通过。
- 模式只允许 1–3；禁用命令在 UI 与服务契约层都不可构造。
- 展示源不会推动 session 到 connected/enabled。
- 没有 COM4 打开记录，也没有硬件动作。

完成后写 `docs/handoffs/phase-01.md`，并附协议证据路径和仍未知的响应语义。

