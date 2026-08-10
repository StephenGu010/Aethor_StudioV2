# ADR-0005：动作文档与实机执行分离

- 状态：Accepted（2026-08-10 增补 6B-S/6B-H 边界）
- 日期：2026-08-09；增补 2026-08-10

## 背景

Phase 5 Gate B 因 Dummy 四参数运动包络未知而被阻止，但 Dummy 动作文档建模、离线编辑、本地目标预览，以及不注册到生产运行时的纯执行状态机都不需要硬件写入。如果把这些软件语义与实机接线绑定，外部安全证据会不必要地冻结故障与资源生命周期验证；如果提前点亮 API/UI 或接入真实 `RobotGateway`，又会把尚未关闭的 Gate B 误解为可执行能力。该决策不定义 Aethor_robo 双七轴动作格式。

## 决策

阶段 6 拆为三个有明确依赖的子阶段：

- Phase 6A：`ActionProgramV1` 文件契约、本机显式保存、导入导出、点位编辑/排序、来源真实的单点采集和目标草稿预览。该边界不依赖 `RobotGatewayV1` 命令接口，没有运行状态或串口路径。
- Phase 6B-S：C# Application 层纯执行内核、取消/停止/恢复 checkpoint 和逐点结果记录。它只依赖 `IActionProgramCommandPort` fake，不注册 DI、不增加 REST/SignalR、不实例化真实 `RobotGateway`、不改变前端锁定状态，因此可在 Gate B 前验证。
- Phase 6B-H：真实 `RobotGateway` adapter、受管运行计划提交、API/审计恢复、前端风险确认与运行状态，以及监督实机执行。只有 Phase 5 Gate B 关闭并取得当次现场授权后才开始。

6B-S 仍只消费 `completed + feedbackConfirmed`：首点和模式变化先取得模式实测确认，再发送单个关节组；当前点确认前不得构造下一点命令。`durationAfterConfirmed` 只在关节组确认后计时。SHOWCASE 程序/点位、非 Dummy Profile、错误 DOF/限位、非正速度和 checkpoint 身份/指纹不匹配在 command port 接管前拒绝。

操作者停止、命令等待超时、非确认终态或内部步骤失败会终止循环，并至多触发一次独立有界的 `stopAndDisable`。只有该停止返回 `completed + feedbackConfirmed` 才能标记 `Stopped`；否则标记失败并要求物理急停。恢复不是暂停：checkpoint 只允许同一 program revision、同一 session、同一执行计划指纹从最后确认点之后继续。

等待字段命名为 `durationAfterConfirmed`，计时只能发生在确认到位之后。SHOWCASE、人工草稿和实测采集分别保留来源；只有 profile 匹配且 valid/measured 的六轴反馈可产生 `measuredCapture`。

本机动作库是前端离线文档存储，不是设备安装目录。只有显式保存后才持久化；恢复时按 V1 Schema 重新校验。当前没有 V0，因此未知版本直接拒绝；未来版本必须增加显式迁移，不静默重写。

## 未采用方案

- 在 Gate B 前提供“模拟运行”按钮：容易把定时器进度误认为物理执行语义。
- 在 Gate B 前注册 6B-S 到 DI、API 或前端：会把纯软件测试内核变成真实硬件可达路径。
- 预先把全部点位写入固件 FIFO：无法逐点处理未知结果、停止和断线。
- 用固定 sleep 作为到位条件：与网关实测收敛契约冲突。
- 自动保存所有编辑：会模糊草稿与已接受 revision 的边界。

## 影响

- `/actions` 可独立形成可交付的离线编辑器，同时持续显示 `NO EXECUTION PATH / PHASE 6B LOCKED`。
- C# `ActionProgramRunner` 是独立生命周期 owner，但当前没有生产 adapter；React 组件和浏览器定时器仍不拥有硬件执行生命周期。
- Phase 6 总体保持 `IN PROGRESS`；6A 与 6B-S 的软件验收不能替代 6B-H 或 Gate B 实机证据。

## 验证与回退

Schema/Ajv、Zod、store 和组件测试覆盖往返、限位、来源、持久化恢复、冲突与 dirty guard；Playwright 验证三档视口的显式保存、刷新恢复和零硬件网络请求。6B-S fake-port 测试覆盖逐点确认、弱证据拒绝、有界超时、单次停止、停止未确认、checkpoint 恢复、并发拒绝、内部故障和 dispose。若软件内核需回退，可移除 `ActionProgramRunner` 与 Domain 执行记录，不改变 API、RobotGatewayV1、前端或串口所有权。
