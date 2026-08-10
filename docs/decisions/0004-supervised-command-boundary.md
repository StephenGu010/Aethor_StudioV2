# ADR-0004：受监督硬件命令边界

- 状态：Accepted（软件门与 Gate A 已验证，Gate B 未完成）
- 日期：2026-08-09

> 2026-08-10 补充：本 ADR 继续约束生产 `supervised` 与 Gate B。开发现场所需的受限 engineering direct 由 [ADR-0009](0009-engineering-direct-debug-boundary.md) 管理，不改变这里的生产运动完成语义。

## 背景

Phase 4 已证明 C# 可以作为唯一串口所有者读取 COM4。Phase 5 需要加入最小结构化控制，但 Dummy 固件缺少可信运动包络和统一运动完成事件；进一步检查还发现 `DummyRobot::Homing()` 与 `Resting()` 会阻塞协议命令处理线程直到动作结束。界面禁用、设备 ACK 或 FIFO 入队都不足以构成工业安全边界。若关节组在 FIFO 接受后直接返回 `unconfirmed` 并锁存联锁，Phase 6 动作编排也不可能诚实地继续第二个点。

## 决策

1. 继续扩展同一个 `RobotGateway`，不新增浏览器直连、第二串口 reader 或 raw 端点。
2. 硬件命令默认关闭。`supervised` 只在桌面壳来源令牌下成立；Development token 永远不能开启控制。
3. 所有命令使用稳定 ID、规范化 payload 指纹、单在途仲裁、超时/取消和有界审计。同 ID 同 payload 共享一次执行；同 ID 不同 payload 拒绝。审计保存规范化请求和 transport 成功写入的实际 payload，不依赖会被轮询覆盖的协议环。未知物理结果锁存安全联锁，只允许停止或现场复核后建立新 session。
   - 命令条目进入审计表是网关接管点。此前已取消的 HTTP 请求必须零审计、零串口写入；此后即使客户端断开，执行也由网关令牌负责收束，调用方只能通过同 ID 或历史恢复终态，不能触发第二次物理发送。
4. 停止并去使能可以取消普通命令，并执行 `!STOP -> 固定全零 -> !DISABLE -> #GETENABLE`。抢占等待有界；只有读回 0 才是完成并清除联锁，否则结果为失败或未确认，并要求物理急停。被取消命令的迟到回包不能恢复成功。
   - 普通命令与 STOP 获取串口 I/O 所有权都使用 `CommandTimeout` 有界等待。普通命令在零写入前超时可拒绝；STOP 超时必须形成未确认终态并锁存联锁，不能让 API 请求无限挂起。
5. 关节组只有同时配置外部已验证的正速度上限、到位容差、连续稳定窗口和总到位超时后才成为 capability。FIFO 接受后由网关独占串口并连续读取 `#GETJPOS`；六轴最大误差持续处于容差内达到稳定窗口才返回 `completed + feedbackConfirmed`。超时仍锁存联锁。不得从 URDF、README 或旧 UI 推断任一参数。
6. HOME/RESET 虽保留版本化端点，但生产配置不宣告、不执行。关闭该门必须先证明固件命令处理可被停止抢占，并完成监督台架验收。
7. 前端在应用壳层维持唯一 Dummy gateway session 协调器；页面挂载不重复初始化权威 capabilities/session。Dummy 设备页与固定顶栏停止共用命令生命周期协调器，不能各自简化终态处理；Aethor_robo 控制台没有该网关路径。当前 Dummy session 的命令审计必须恢复为 `ready` 才开放普通命令；恢复失败仍允许只读遥测与停止去使能。最近结果只用于展示，独立 `latchedSafetyResult` 由实时终态和 REST 历史共同重建；缺失历史不能清除已知联锁。成功 STOP 的终态时间作为 session 级水位，迟到旧未知结果不能重新锁存或覆盖最近结果。目标拖拽/滑块永远只写当前 Profile 草稿，显式整组下发还需对应适配器、速度、能力、状态和人工确认。
8. 受监督模式下，仍有硬件命令在途或电机未明确读回 disabled 时拒绝人工 disconnect，避免 UI 把“串口关闭”误当成“设备安全”。宿主强制清理先取消轮询/runner 并关闭串口句柄，用句柄关闭打断不响应 cancellation token 的原生读；随后才等待任务终态并 dispose transport。
9. SignalR 重连、关闭或契约错误立即把前端现有 measured session/joint state 降为 `stale`。重连回调只是恢复触发器，不是可信证据；只有 REST capabilities/session/joint/protocol 权威刷新成功才恢复 `valid`。期间保留最后实测姿态并明确标记 `MEASURED STALE`，四个路由持续显示全局告警，普通命令与关节组保持锁定，停止去使能仍可用。
10. SignalR sink 是 transport 之外的有界通知端口。单次发布超时后停止事件泵，避免累积不合作的悬挂调用；关闭时必须先释放唯一 transport，再有界排空/取消事件泵。事件发布失败不能阻止串口释放，也不能改变 REST 权威结果。

## 后果

- 当前软件可验证拒绝路径、状态机、幂等、停止链和资源释放，但 Phase 5 仍为 `IN PROGRESS`，不能据此宣称真实运动可交付。
- HOME/RESET 的 UI 可以显示契约占位和明确禁用原因；不得为满足旧计划而放宽固件事实。
- 真实 joint-group 验收必须先获得可信四参数运动包络、低风险姿态、物理急停和独立当次授权。
- SignalR `commandResult` 只是终态通知；REST command history 仍是恢复与审计来源。
- 事件 sink 卡死时允许丢失后续实时通知并明确记录诊断；相比让宿主或串口生命周期无限阻塞，客户端应通过 REST 权威恢复并保持旧遥测为 stale。
- 命令 POST 丢失响应时，前端本地锁存 `unconfirmed + transportError`；不能通过重复点击猜测第一次请求未执行。
- 单次 REST 快照不能冒充实时通道恢复；SignalR 降级后，手动读取可以辅助诊断，但在协调器完成权威恢复前不能解除遥测联锁。
- 2026-08-09 Gate A 已验证 enable、mode 1–3、stop-and-disable 和最终 disabled；未发送运动目标。Gate B 不因该结果自动授权。

## 被拒绝的替代方案

- **允许开发令牌开启命令**：拒绝，会绕过桌面壳会话来源与现场流程。
- **前端直接发送 ASCII**：拒绝，会破坏唯一所有者、许可校验和审计。
- **把 ACK/FIFO 数字显示为动作完成**：拒绝，固件证据不支持。
- **给 Dummy 猜测低速度或固定到位延时**：拒绝，没有可信硬件包络，低数值与等待若干秒都不自动等于完成或安全。
- **保持 HOME/RESET 可用并依赖软件 STOP**：拒绝，当前固件的阻塞处理可能让 STOP 无法及时解析。

## 关闭实机门的条件

- Gate A 已按 [Phase 5 监督式控制手册](../runbooks/phase-05-supervised-control-com4.md) 采证；Gate B 必须重新确认操作者、净空、物理急停、供电、姿态和 COM4 身份。
- 从机械/固件负责人取得并记录四参数运动包络；再进行低风险短动作、实测稳定窗口与停止抢占验收。
- HOME/RESET 只有在固件改造或台架证据证明其可抢占后才能进入 supported capabilities。
