# 阶段 6 交接

- 状态：`IN PROGRESS`
- 子阶段：`6A OFFLINE EDITOR VERIFIED / 6B-S SOFTWARE CORE VERIFIED / 6B-H HARDWARE WIRING LOCKED`
- 日期：2026-08-10
- 实施者：Codex
- 仓库/分支：`Aethor_StudioV2 / main`
- 开始基线提交：`f423e460f9f36f4067785782a4af59b0a98353f2`
- 阶段完成提交：无；Phase 6B-H 与 Phase 5 Gate B 未完成

## 本阶段目标

提供专业、版本化、来源可审计的 Dummy 六轴动作文档与受控逐点执行。当前完成 Phase 6A 和无生产接线的 6B-S 软件内核；不实现动力学、轨迹规划、预灌队列或基于固定 sleep 的执行，真实接线仍被 Gate B 锁定。

## 已完成

- 新增 `ActionProgramV1` TypeScript/JSON Schema、SHOWCASE 示例和权威接口文档；只接受 `dummy-6dof`、六轴 manifest 限位和模式 1–3。
- 实现空白/示例/复制、点位增删排序、程序与点位属性、目标草稿预览、真实反馈采集门、导入导出、dirty guard 和显式保存。
- 本机动作库只持久化已保存文档；草稿、选择和预览不落盘。库限制为 64 个文档和 4 MiB；恢复时逐条复验 Schema 与稳定 ID，损坏或超限记录隔离并告警。
- 1 MiB 导入上限在读取内容前执行；未知 Schema 版本、重复 ID、错误 DOF、非法限位/模式、来源时间造假和冲突覆盖均失败关闭。
- 页面持续显示 `NO EXECUTION PATH / PHASE 6B LOCKED`；运行按钮永久禁用，代码不依赖或调用 `RobotGatewayV1` 命令方法。
- C# Application 新增独立 `ActionProgramRunner` 与 Domain 执行记录。它只依赖 fake `IActionProgramCommandPort`，没有 DI 注册、API、SignalR、前端入口或真实 `RobotGateway` adapter。
- 6B-S 逐点先确认模式、再确认关节组；两者都必须是 `completed + feedbackConfirmed`。当前点确认后才执行到位后等待，模式未变化时不重复发送模式命令。
- SHOWCASE、Aethor_robo、错误 DOF/限位、非正速度和不匹配 checkpoint 在 command port 接管前拒绝。恢复绑定同一 program revision、session 和执行计划 SHA-256 指纹。
- 操作者停止、命令等待超时、弱证据或内部步骤失败终止序列，并至多调用一次独立有界 stop-and-disable。未确认停止返回失败并要求物理急停；dispose 走同一停止路径。
- 计划已按 ADR-0005 拆为 6A、6B-S 和 Gate B 后的 6B-H。

## 未完成与下一步

1. Phase 5 Gate B 仍缺可追溯的速度上限、到位容差、稳定窗口、总超时和独立实机授权。
2. Phase 6B-H 尚无运行计划 wire contract、RobotGateway adapter、DI/API、前端风险确认/运行态、REST 审计恢复或监督实机证据。
3. 固件没有真正暂停队列语义；未来 UI 只能提供“停止后从最后确认点恢复”，除非固件能力发生版本化改变。现有 checkpoint 不能跨 session 或 program revision。
4. Aethor_robo 固件、可信限位/速度和完成/停止语义未定义；当前文档与 6B-S 内核均明确拒绝该 Profile。
5. Phase 6 总体退出门和本地 `phase(06)` 提交均未满足；不得 push。

## 关键决策

| 决策 | 原因 | 影响 |
|---|---|---|
| 6A / 6B-S / 6B-H 分离 | 外部运动证据不应冻结纯软件语义验证，也不能让软件内核变成硬件入口 | 可先验证编辑器和执行状态机，但不能宣称动作可运行 |
| 只显式保存 | 区分编辑草稿与操作者接受的 revision | 导航/关闭有 dirty guard，刷新只恢复已保存库 |
| 来源不可伪造 | SHOWCASE/人工/实测的安全含义不同 | 只有 profile 匹配的 valid measured 六轴帧可采集 |
| 到位后才等待 | 固定等待不能证明运动完成 | 6B-S 已强制先收到 `completed + feedbackConfirmed` |
| 恢复绑定计划指纹 | 同 ID/revision 下内容漂移会让“从下一点恢复”失去含义 | checkpoint 同时绑定 revision、session、SHA-256 和最后确认点 |
| 未知版本拒绝 | 当前没有可信 V0 迁移来源 | 未来升级必须新增显式迁移和测试 |

## 变更范围

- 契约：`shared/contracts/action-program-v1.schema.json`、`src/actionProgram.ts`、示例与接口说明。
- 前端：`domain/actionProgram.ts`、`useActionProgramStore.ts`、`ActionProgrammingPage.tsx`、导航 dirty guard、样式及测试。
- C# Domain/Application：`ActionProgramExecutionContracts.cs`、`ActionProgramRunner.cs`、`IActionProgramCommandPort`/`IActionProgramDelay`；当前无生产 adapter。
- C# 测试：`ActionProgramRunnerTests.cs`，只使用 fake command port/delay。
- 文档：ADR-0005、路线图、产品边界、架构、验收矩阵、Phase 6 提示词与本 handoff。
- 数据迁移：无；当前不存在 V0。未知版本不会静默转换。

## 验证证据

| 检查 | 命令/环境 | 结果 | 证据路径 |
|---|---|---|---|
| 全量测试 | `pnpm test` | shared 87 + frontend 116 + C# 46，共 249 项通过 | 控制台输出 |
| 严格类型 | `pnpm typecheck` | shared/contracts 与 studio-web 通过 | 控制台输出 |
| Release 构建 | `pnpm build` | Vite 2617 modules、Profile 10 项；.NET 0 warning/0 error | `apps/studio-web/dist` 与网关 Release 输出（均不提交） |
| 三档工作区 | `pnpm test:e2e`，Edge 1366×768 / 1920×1080 / 2560×1440 | 39/39 通过 | Playwright 控制台；报告/结果不提交 |
| 动作聚焦回归 | domain/store/page/sidebar Vitest | 21/21 通过 | 控制台输出 |
| 6B-S 执行内核 | .NET fake command port | 11/11 通过；逐点、停止竞态、恢复、并发、超时、故障和 dispose | `ActionProgramRunnerTests.cs` |
| 动作网络边界 | 三档 Playwright | 保存/刷新恢复期间 fetch、XHR、WebSocket 均为 0；运行按钮禁用 | `workspaces.spec.ts` |
| COM4 安全预检 | `pnpm gateway:preflight:control` | passed；gateway/listener 0，串口未打开，网络未请求 | 本次控制台输出 |

## 增量验证（2026-08-10）

- 6B-S 聚焦 fake-port 测试 11/11 通过；覆盖逐点顺序、模式去重、弱证据不推进、模式确认后停止竞态、操作者停止、停止未确认、checkpoint 恢复、并发拒绝、120 ms command await 超时、内部 delay 故障和 dispose。
- `pnpm test`：contracts 91 + frontend 168 + gateway 65 + desktop 74，共 398 项通过。
- `pnpm build`：Web 2629 modules、复制 37 项 Profile 资源；gateway/desktop Release 均为 0 warning/0 error。
- 动作页当前生产构建三档 E2E 3/3 通过：运行按钮保持禁用，编辑/保存/刷新期间 fetch、XHR、WebSocket 均为 0。
- 源码检查确认 `AethorStudioV2.Api/Program.cs` 与 `apps/studio-web` 对 `ActionProgramRunner`、`IActionProgramCommandPort` 和执行计划均为零引用；生产路由和 DI 未变化。
- 当前 `development-dirty` Windows 包已重建为 674 个文件，包内 Application DLL 包含 6B-S 类型但命令策略仍为 disabled；manifest 闭包、gateway ready/offline、shutdown 202 和进程退出 smoke 通过，零串口/零硬件命令。
- 本轮未启动网关、未打开 COM4、未发送查询、状态改变或运动命令。

## 硬件操作

- 是否打开串口：否。
- 是否发送状态改变/运动命令：否。
- 2026-08-09 08:55 UTC 的控制预检只枚举 COM4 并返回 passed；明确声明 `serialPortOpened=false/networkRequestSent=false`。用户随后提出 `!START`，但本次运行尚未重新确认工作区净空与物理急停条件，因此没有打开端口或发送命令。

## 已知风险与限制

- local storage 是本机浏览器数据，不是服务端备份或正式安装；重要程序必须导出并进入后续受管流程。
- 文档有效只证明结构、Profile 和限位合法，不证明点位安全、路径安全或可达；当前没有碰撞、动力学或轨迹规划。
- 6B-S 记录是进程内软件结果，不是 wire 审计或持久化恢复。6B-H 必须新增受管运行计划契约和 API/REST 权威状态，不能把 UI 草稿直接遍历后发送。

## 下一阶段启动清单

- [ ] 阅读公共上下文、路线图、本 handoff、ActionProgram V1、RobotGatewayV1、ADR-0004 与 ADR-0005。
- [ ] 检查 Git 状态；Phase 5/6 仍有未提交工作，不能覆盖或拆散既有改动。
- [ ] 复现 ActionProgram 全量测试和三档 E2E。
- [ ] 在 Phase 5 Gate B 完成前保持运行按钮禁用，并保持 `ActionProgramRunner` 无 DI/API/真实 adapter。
- [ ] 若进入实机，重新取得当次现场授权；历史 Gate A 不得复用。
- [ ] 只有 Phase 6 完整退出门通过后创建本地提交；远端 push 仍由用户执行。
