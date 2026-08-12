# Aethor_robo A1-U1 交接：串口双工软件门与共用终端

## 阶段结论

| 项 | 结果 |
|---|---|
| 阶段 | A1-U1 |
| 状态 | `DONE`（软件门） |
| 生产串口接线 | 未接线 |
| A1 总体 | `IN PROGRESS` |
| 硬件访问 | 无；未枚举或打开 COM4，未发送硬件命令 |
| 计划提交 | `phase(A1-U1): add bounded serial duplex runtime` |

## 已完成

- Application 新增 `SerialDuplexScheduler`：唯一持续 reader、唯一 writer、RX 有界背压、P0–P3 有界发送、急停预留容量、满载低优先级淘汰、队列时效、ticket 终态和资源探针。
- 关闭先取消运行时并关闭 transport，以释放忽略 cancellation 的读写；随后等待任务收束并唯一 dispose。
- `/terminal` 不再由 Dummy-only 路由门阻断。页面跟随全局 Profile：Dummy 保留当前网关入口；Aethor_robo 只显示候选 `REQ` 模板、operation 白名单和 adapter pending 状态，不消费 Dummy session/帧，发送固定禁用。
- Aethor 候选校验覆盖单行 ASCII、512-byte 边界、uint32 request ID、operation 白名单和 CRC 占位/文本形态。它不声称 CRC 已通过固件一致性验证。
- 1366×768、1920×1080 与 2560×1440 实页检查无根横向溢出；长快捷命令单行省略，动作文字不重叠，完整模板保留在 `title`。

## 验证证据

- `pnpm test`：contracts 98 + frontend 225 + gateway 113 + desktop 118 + legal inventory 6，共 560/560 通过；其中双工调度器 10/10。
- `pnpm build`：Profile provenance 通过；Web 2653 modules；Gateway/Desktop Release 均为 0 warning / 0 error。
- `pnpm test:e2e`：三档视口 63/63 通过；双 Profile 终端、页面边界、禁用原因和视觉基线均纳入回归。
- 隔离 wrapper 明确报告 `serialPortOpened=false / hardwareCommandSent=false`；本阶段未枚举或打开 COM4。

## 尚未完成

- `SerialDuplexScheduler` 没有注册到生产 DI，Dummy `RobotGateway` 仍使用旧 `serialIoGate` 问答循环。
- Dummy 终端除关节组外仍会等待匹配回包；“入队后立即继续发送”的生产行为属于 A1-U2。
- Aethor 固件 parser、CRC vectors、C# codec、pending request registry、REST/SignalR 和真实串口入口不存在。
- Aethor 921600 baud、50 Hz、MIT/POS_VEL、同步到达、梯度速度和 STOP/DISABLE 仍需固件与实机证据。

## 下一阶段

执行 [A1-U2 Dummy 运行时迁移提示词](../prompts/aethor-robo-a1-u2-dummy-runtime-migration.md)：一次性迁移所有 Dummy 物理读写，避免双 reader；将 direct terminal 改为有界入队立即返回，同时保留结构化命令的响应与审计语义。该阶段仍只使用 fake transport，不打开 COM4。

固件资料到位后，再按 [A1-H 固件与 adapter 提示词](../prompts/aethor-robo-a1-h-firmware-adapter.md) 实施独立 Aethor codec。
