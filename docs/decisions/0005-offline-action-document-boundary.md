# ADR-0005：动作文档与实机执行分离

- 状态：Accepted（2026-08-10 增补 6B-S/6B-H 边界；2026-08-19 修订编辑保存并增加 6B-E engineering 人工运行）
- 日期：2026-08-09；增补 2026-08-10、2026-08-19

## 背景

Phase 5 Gate B 因 Dummy 四参数运动包络未知而被阻止，但 Dummy 动作文档建模、离线编辑、本地目标预览，以及不注册到生产运行时的纯执行状态机都不需要硬件写入。如果把这些软件语义与实机接线绑定，外部安全证据会不必要地冻结故障与资源生命周期验证；如果提前点亮 API/UI 或接入真实 `RobotGateway`，又会把尚未关闭的 Gate B 误解为可执行能力。该决策不定义 Aethor_robo 双七轴动作格式。

## 决策

阶段 6 拆为四个有明确完成语义的子阶段：

- Phase 6A：`ActionProgramV1` 文件契约、本机自动保存、导入导出、点位编辑/排序、来源真实的单点采集和目标草稿预览。该边界不依赖 `RobotGatewayV1` 命令接口，没有运行状态或串口路径。
- Phase 6B-S：C# Application 层纯执行内核、取消/停止/恢复 checkpoint 和逐点结果记录。它只依赖 `IActionProgramCommandPort` fake，不注册 DI、不增加 REST/SignalR、不实例化真实 `RobotGateway`、不改变前端锁定状态，因此可在 Gate B 前验证。
- Phase 6B-E：仅在显式 Development engineering 策略下可达的人工确认 runner。前端提交 authored revision 的不可变快照；C# `EngineeringActionProgramRuntime` 独占循环、点位调度和停止，每点只等待 `sent + transportWritten`，按最大关节角差/程序速度加附加等待推进。它不产生到位或设备确认结论。
- Phase 6B-H：真实 `RobotGateway` adapter、受管运行计划提交、API/审计恢复、前端风险确认与运行状态，以及监督实机执行。只有 Phase 5 Gate B 关闭并取得当次现场授权后才开始。

6B-S 仍只消费 `completed + feedbackConfirmed`：首点和模式变化先取得模式实测确认，再发送单个关节组；当前点确认前不得构造下一点命令。`durationAfterConfirmed` 只在关节组确认后计时。SHOWCASE 程序/点位、非 Dummy Profile、错误 DOF、非有限角度、非正速度和 checkpoint 身份/指纹不匹配在 command port 接管前拒绝。

操作者停止、命令等待超时、非确认终态或内部步骤失败会终止循环，并至多触发一次独立有界的 `stopAndDisable`。只有该停止返回 `completed + feedbackConfirmed` 才能标记 `Stopped`；否则标记失败并要求物理急停。恢复不是暂停：checkpoint 只允许同一 program revision、同一 session、同一执行计划指纹从最后确认点之后继续。

等待字段命名为 `durationAfterConfirmed`，计时只能发生在确认到位之后。SHOWCASE、人工草稿和实测采集分别保留来源；只有 profile 匹配且 valid/measured 的六轴反馈可产生 `measuredCapture`。

V1 文件继续保留历史字段名 `durationAfterConfirmed`。6B-S/6B-H 只能在到位确认后使用；6B-E 没有到位证据，因此明确把该数值解释为“估算运动时间后的附加等待”，wire 字段名为 `postDispatchWaitMs`，UI 也使用该说明，不能把它显示成已到位等待。

本机动作库是前端离线文档存储，不是设备安装目录。2026-08-19 起，有效编辑在停止 350 ms 后自动保存，离开页面时同步尝试刷新；未通过 Schema 或容量检查的编辑不会覆盖最后有效 revision。退出工作区和删除点位不再弹未保存确认，导入稳定 ID 冲突仍需单独确认。恢复时按 V1 Schema 重新校验。当前没有 V0，因此未知版本直接拒绝；未来版本必须增加显式迁移，不静默重写。

动作文档是设备角意图与观测记录，不拥有当前硬件的命令限位。所有来源的 `positionsDeg` 只校验恰好六个有限值；`measuredCapture` 从 `#GETJPOS` 逐值原样复制，编辑、自动保存、导入导出、目标预览和两个 runner 的 port 交接都不裁剪或拒绝 Profile/URDF 范围外的有限角度。网关/固件可以明确拒绝，但不得改写点位。程序级 `speedDegS` 默认 20 deg/s，`loopEnabled` 默认关闭；6B-E 消费二者，仍不能产生 6B-H 的反馈确认能力。

6B-E 同一时刻只允许一个运行快照。启动时要求当前 Dummy session 和六轴实测反馈新鲜有效、电机 enabled、点位模式与当前模式一致；运行中拒绝外部非查询/非停止命令。有限运行结束为 `finishedUnconfirmed`；循环持续到操作者停止。停止、终端 `!STOP/!DISABLE`、结构化停止、断开和 dispose 都先取消未来点位，再尝试 transport 写入 `!STOP`、`!DISABLE`；只有两行都写入才是 `stoppedUnconfirmed`，仍不声称物理停止或去使能。

## 未采用方案

- 在 Gate B 前提供“模拟运行”按钮：容易把定时器进度误认为物理执行语义。
- 把 6B-S 的 `feedbackConfirmed` 语义改成固定等待：会破坏未来监督执行证据；因此新增独立 6B-E 契约和状态机，不复用/弱化 6B-S。
- 预先把全部点位写入固件 FIFO：无法逐点处理未知结果、停止和断线。
- 用固定 sleep 作为到位条件：与网关实测收敛契约冲突。
- 无校验地逐键保存全部编辑：会放大 local storage 写入并可能覆盖最后有效 revision；采用 350 ms 防抖、Schema/容量复验和离开时刷新。

## 影响

- `/actions` 在无 engineering 能力时仍是离线编辑器；满足能力、会话、反馈、使能和模式门后可提交 6B-E 运行快照。
- C# `EngineeringActionProgramRuntime` 是 6B-E 生命周期 owner，React 组件和浏览器定时器不拥有硬件执行；`ActionProgramRunner` 继续保持无生产 adapter。
- Phase 6 总体保持 `IN PROGRESS`；6A 与 6B-S 的软件验收不能替代 6B-H 或 Gate B 实机证据。

## 验证与回退

Schema/Ajv、Zod、store 和组件测试覆盖往返、来源、任意有限六轴值原样保留、自动保存、退出无拦截、无确认点位删除、持久化恢复与导入冲突。6B-E 覆盖不可变快照、20 deg/s、循环、transport-written 推进、并发拒绝、乱序事件、停止失败仍释放 owner、断开/外部停止取消和无物理完成声明；所有测试使用 fake port，不打开 COM 口。6B-S 原 fake-port 测试继续覆盖逐点确认、弱证据、checkpoint 和有界停止。
