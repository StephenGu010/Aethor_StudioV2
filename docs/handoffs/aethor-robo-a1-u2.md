# Aethor_robo A1-U2 交接：Dummy 生产双工迁移

## 阶段结论

| 项 | 结果 |
|---|---|
| 阶段 | A1-U2 |
| 状态 | `DONE` |
| A1 总体 | `IN PROGRESS`；A1-H 固件与 Aethor adapter 仍被外部证据阻塞 |
| 开始基线 | `11f1e058b051378e3350dd9c82acf27f3142163a` |
| 计划提交 | `phase(A1-U2): migrate Dummy to duplex runtime` |
| 硬件访问 | 无；未枚举或打开 COM4，未发送任何硬件命令 |

## 本阶段目标

将 Dummy 的全部生产串口读写迁移到单一双工运行时，使终端请求不再因设备缺少回复阻止后续发送，同时保留结构化命令的响应、审计和联锁语义。本阶段不实现 Aethor codec、真实 Aethor 串口或实机验收。

## 已完成

- `DummySerialSession` 成为单一 Dummy 协议 owner：唯一 decoder 处理所有 RX，物理读写由 `SerialDuplexScheduler` 的一个 reader 和一个 writer 持有。
- 轮询使用 P2，普通结构化命令与 direct 使用 P1，STOP/DISABLE 使用 P0。结构化无标签问答一次只保留一个 response fence；P0 可抢占低优先级 fence。
- `RobotGateway` 删除 `serialIoGate`、直接 `ReadAsync/WriteAsync` 和 direct 响应等待。direct 请求按 request ID 幂等，HTTP 受理返回 `queued`，物理写入、过期、淘汰、断开取消与失败分别形成有界结果。
- RobotGatewayV1 升级到 1.4，增加 direct 结果 REST 历史和 `directCommandResult` SignalR 通知；连接切换和断开清空旧 session 历史。
- 前端 runtime store 按 request ID 合并 direct 状态并限制为 128 条。终端保留输入、允许连续提交，并显示最近多个请求；等待某条 RX 不会全局禁用发送。
- 结构化命令的 response ownership 保留 command ID，且只有 writer 已开始向 transport 提交对应 payload 才允许匹配；排队期间到达的旧 direct ACK/FIFO 只进入协议观察，不会提前完成结构化事务或改写 direct 终态。
- 串口 session 关闭会先解除可能不响应 cancellation 的 transport I/O，取消未写队列和响应 fence，再唯一释放 transport。

## 对 Aethor_robo 的影响

- 可复用的物理串口调度、优先级、背压、关闭和探针已经在 Dummy 生产路径完成迁移。
- Aethor_robo 仍保持 `aethor-robo-pending`、模型预览和候选协议本地校验；没有 C# codec、request registry、REST/SignalR 投影或真实 TX/RX。
- Aethor 后续只复用调度器资源所有权，不复用 Dummy 无标签 decoder/response fence 语义。它必须按 request ID、boot ID 和 session 建立独立 adapter。

## 验证证据

| 检查 | 结果 |
|---|---|
| strict TypeScript | 通过 |
| contracts | 98/98 |
| A1-U2 前端定向测试 | 50/50 |
| 全量测试 | contracts 98 + frontend 230 + gateway 122 + desktop 118 + legal 6，共 574/574 |
| 硬件隔离 | gateway/desktop wrapper 均报告 `serialPortOpened=false / hardwareCommandSent=false` |
| Release 构建 | Web 2653 modules；Gateway/Desktop 均 0 warning / 0 error |
| 三档 E2E | 1366×768、1920×1080、2560×1440 共 63/63 |

## 已知限制

- Dummy 固件仍是无 request ID 的 ASCII 协议；response fence 只能串行关联结构化问答。writer 开始后的迟到同形响应在线协议上仍不可区分，不能把该机制解释为 Aethor request ID 的强关联。
- direct 的 `sent` 只表示 transport 物理写入，不表示设备接收、入队、运动开始或到位。
- 该阶段没有实机验证 Windows 串口驱动下的持续吞吐、STOP 延迟或拔线行为；真实长测仍属于 Phase 7B/相应监督手册。
- Aethor 固件协议仍在外部开发，最终字段、CRC vectors、波特率和 telemetry 时序尚未进入仓库可执行 adapter。

## 下一阶段启动清单

- [ ] 以 Aethor 数字孪生为核心，先完善协议无关的双臂遥测投影、来源/新鲜度、实体/目标隔离和模型诊断。
- [ ] 保持真实 Aethor TX、使能和运动禁用，直到固件 commit 与跨语言 vectors 可追溯。
- [ ] Aethor codec 到位后，把 TEL/GET_JPOS 统一投影为现有 `AethorArmMotorFrameV1` 接缝，不让页面直接解析串口文本。
- [ ] 若进入任何实机步骤，重新取得现场授权；不得沿用本阶段零硬件许可。
