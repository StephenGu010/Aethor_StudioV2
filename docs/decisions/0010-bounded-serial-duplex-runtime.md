# ADR-0010：有界串口双工运行时

- 状态：Accepted（Dummy 生产迁移已完成；Aethor adapter 待实现）
- 日期：2026-08-13
- 适用范围：Dummy adapter 迁移、Aethor Arm adapter、串口终端

## 背景

现有 Dummy 网关用 `serialIoGate` 把一次请求的写入、读取和匹配响应包在同一临界区。该实现保证只有一个串口 reader，但等待回包期间也占有 I/O 所有权。设备不回包或运动响应延迟时，人工终端、轮询和后续操作会互相等待。

Aethor Arm 候选协议带 request ID，要求持续接收遥测与命令终态；它不能复制 Dummy 的“写入后持锁等响应”模型。两种机器人仍应共享串口资源所有权、背压、优先级、关闭和诊断原则。

## 决策

Application 层提供 `SerialDuplexScheduler`，只接管已经打开的 `IAsciiTransport`：

- 一个任务持续调用物理 `ReadAsync`，一个任务负责所有物理 `WriteAsync`；
- RX 通过有界队列交给 adapter handler，慢消费产生背压，不无限占用内存；
- TX 总容量有界，分为 `Safety / Interactive / Telemetry / Background` 四级；
- 非安全工作不能占用预留的安全槽；总队列已满时，安全工作可以淘汰最早的低优先级项；
- P0 始终先取，P1/P2/P3 使用固定公平调度，后台任务不会永久饥饿；
- 入队成功与物理写入完成是两个事实。终端可以在入队后立即释放 UI，不需要等待任何 RX；实际写入、过期、淘汰、取消和失败由 ticket 收束；
- 每项工作有最大排队时间，陈旧命令不会在恢复后突然写入；
- reader、writer 或 handler 故障会停止 session，并主动关闭 transport，解除 Windows 驱动中不响应 cancellation 的原生 I/O；dispose 最终唯一释放 transport；
- probe 只记录队列深度、计数、优先级、work ID、故障类别和资源终态，不记录 payload。

协议 codec、帧解析、response correlation 和设备状态机不属于调度器。Aethor adapter 后续按 `request_id + boot_id + session` 关联；Dummy 迁移时必须为无标签响应保留单独的 request fence，不能让多个响应等待者争用同一回包。

## 当前接线状态

Dummy A1-U2 已将所有生产读写一次性迁移到 `DummySerialSession + SerialDuplexScheduler`，并删除 `RobotGateway` 的旧 `serialIoGate`/直接读写路径。单一 decoder 负责所有 Dummy RX；结构化命令的 response fence 只有在 writer 开始向 transport 提交对应 payload 后才允许匹配回包，排队期间到达的旧响应保持无主观察。direct terminal 只排队写入并通过结果事件/历史收束。Dummy 没有 request ID，writer 开始后的迟到同形响应仍无法从线协议上强区分。

2026-08-14 的现场日志证明 Windows CDC 写入可能在连续人工动作后的只读轮询中返回原生错误 121。调度器因此增加一个显式、默认关闭的 `RetryOnTransientTimeout` 属性：只有 Dummy adapter 的三种幂等只读查询设置它；一次 `TimeoutException` 或低位 Win32 code 121 允许在 100 ms 后重试一次。所有动作、状态改变和人工终端写入保持默认关闭，避免因主机不确定写入结果而重复执行。第一次失败计入 `RetriedWrites` 和 `serial.scheduler.write.retry`；重试仍失败时继续使用原有 session fault、close、dispose 路径。

`ProtocolFrame.correlationId` 在共享契约中是可选字符串。无关联的解析/查询错误必须省略该 JSON 属性，不能写成 `null`；否则 SignalR 严格边界会把真实串口退化误报成网关契约违规。

`/terminal` 已按 request ID 展示多个 direct 请求的 `queued/sent/失败类` 状态，某个请求缺少设备回复不会禁用下一次发送。Aethor_robo 仍只显示候选 REQ 模板和白名单校验；CRC 跨语言向量与 adapter 缺席时发送固定禁用，不显示 Dummy 帧。

## 后续顺序

1. A1-H0 已完成无状态 Aethor TypeScript/C# codec 与主机侧 CRC/parser vectors；A1-H1-S 已以 fake transport 完成未注册生产 DI 的 pending request/session core。固件 commit 和固件侧向量冻结后只新增启动/心跳与生产投影，不再新增第二套 codec、reader、writer 或 registry。
2. Aethor adapter 复用调度器资源所有权，但保持协议、session 与响应状态独立。
3. 只有 Aethor 生产 adapter 的软件门完整通过后，才编写并执行新的监督实机 runbook。

## 结果

- 串口调度成为跨 adapter 的基础设施，协议状态仍保持隔离。
- 队列拥塞和陈旧命令具有明确终态，不通过无限等待或无界缓存掩盖。
- 本 ADR 不声明 Aethor_robo 已可连接，也不改变当前 COM4 行为。
