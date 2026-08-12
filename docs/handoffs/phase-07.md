# 阶段 7 交接

- 状态：`IN PROGRESS`
- 子阶段：`7A SOFTWARE GATE VERIFIED / 7B HARDWARE SOAK NOT STARTED`
- 日期：2026-08-09
- 最近更新：2026-08-12
- 实施者：Codex
- 仓库/分支：`Aethor_StudioV2 / main`
- 开始基线提交：`f423e460f9f36f4067785782a4af59b0a98353f2`
- 阶段完成提交：无；7B 未完成

## 已完成

- 实现 `LiveSignalHistory`：当前 measured session 的六轴 actual/target/error 共 18 路，每路同时受 120 秒和 4800 点限制；拒绝错误 profile/DOF/source/validity、重复和倒序帧，统计序号缺口。
- runtime store 是唯一采集入口，REST 初始快照、SignalR 和人工权威刷新不再各自维护历史；session identity/offline 改变清空，同 session 重连保留历史。
- 示波默认实时窗口 60 秒、最大 120 秒；采集逐帧，React/ECharts 可见最多 10 Hz、隐藏最多 1 Hz。ECharts 跨刷新复用同一实例，单位独立 y 轴，卸载唯一释放。
- CSV 使用长表格式，包含 UTC、session、profile、signal ID、显示名、来源、单位、值和 validity。
- 终端在网关模式只显示当前真实有界协议帧；无帧时显示 `WAITING/IDLE`，不回退静态样例。支持搜索、方向、自动滚动、复制反馈、仅清空视图和带来源文本导出。
- 协议帧按稳定 ID 去重并限制 256 条；清空只隐藏当时已有 ID，新到帧继续显示。终端默认隐藏 `#GETJPOS` TX 与 `jointPositions` RX，可用按钮展示或再次隐藏；该操作只改变终端订阅和显示，不停止采集或删除原始证据。控制台最近事件只订阅非位置轮询帧，避免每个轮询 TX/RX 触发无关重渲染。终端不再维护前端管理员/专家会话。
- 顶栏提供 Dummy 端口刷新、人工选择、显式连接和安全断开入口；不自动连接，且只复用既有 `RobotGatewayV1`/runtime owner。Aethor_robo 不枚举串口。
- Dummy 控制台“最近事件”只显示当前实测 session 的协议标题，不追加重复中文翻译；无实测 session 时才显示明确的静态样例。
- RobotGatewayV1.3 按 ADR-0009 提供 Development-only engineering direct：终端输入始终可编辑，但只有协商能力、已连接 Dummy session、已知 enabled/mode、至少一帧六轴实测值和 C# 白名单/限位门全部通过才发送。六轴运动写入后立即显示 `SENT · MANUAL CONFIRM`；反馈 stale 不阻止下一次人工目标。任意 raw 仍不存在，前端不伪造 TX/RX，生产 `disabled/supervised` 边界不变。
- engineering 人工运动新增在线反馈冻结识别：写入后至少 500 ms、至少 8 个 `#GETJPOS` 样本无变化且仍远离目标时，关节反馈降为 stale，并产生一次有 request/correlation 的 `feedbackFrozen` 帧和结构化诊断；真实角度重新变化后恢复 valid。该状态不阻断连续人工下发，也不宣称实机停止或到位。
- 修复 1366×768 下终端主区局部 87 px 溢出；实测 DOM 的 main/toolbar/log `scrollWidth === clientWidth`。
- 新增 `gateway:soak:readonly` 与 [Phase 7B 只读长测手册](../runbooks/phase-07b-readonly-soak.md)：显式授权、五项现场确认、Release 入口、command policy disabled、Dummy/三个查询白名单、有限时长资源/协议采样和 finally 清理全部固化；尚未执行真实 COM4 路径。

## 有界与资源证据

| 项目 | 设计/测试值 | 结果 |
|---|---:|---|
| 输入长测 | 10 分钟 × 40 Hz = 24000 帧 | 合成测试通过 |
| 单信号上限 | 120 秒 × 40 Hz = 4800 点 | 通过 |
| 18 路总上限 | 86400 点 | 通过 |
| 图表刷新 | 前台 100 ms / 隐藏 1000 ms | fake timer 通过 |
| ECharts 生命周期 | 数据更新不重建；卸载 dispose 一次 | 组件测试通过 |
| 协议日志 | 256 帧，稳定 ID 去重 | store 测试通过 |
| SignalR owner | AppShell 单一 coordinator | 既有 coordinator 回归通过 |
| 串口正常启停 | 32 次连接/有效轮询/断开 | 每个 fake transport 恰好 open/close/dispose 一次 |
| 不合作读取关闭 | 32 次读取忽略 cancellation | 10 秒总门内全部回到 offline，无串口 owner 遗留 |
| 不合作写入关闭 | 写入忽略 cancellation 并阻塞到 close | 先关闭句柄再等待任务，1 秒门内回到 offline |
| 网关持续轮询 | 64 个完整三查询状态周期 | 序号持续推进；协议历史严格保持 64 条配置上限；断开唯一释放 |
| 7B 工具 validation-only | 默认 600 秒/5 秒采样的配置校验 | gateway/network/serial/hardware command/filesystem mutation 均为 false |
| 授权失败关闭 | 缺少固定授权短语 | 证据目录、gateway process、5127 listener 均不产生 |

自动化证明前端容量与 fake transport 生命周期所有权，没有记录真实 COM4 驱动、浏览器 heap 或网关工作集曲线；这些属于 7B 实机长测证据，不能用理论上限或 fake 负载替代。

## 验证证据

| 检查 | 结果 |
|---|---|
| `pnpm test` | shared 87 + frontend 135 + C# 46，共 268 项通过 |
| `pnpm typecheck` | shared/contracts 与严格前端 TypeScript 通过 |
| `pnpm build` | Vite 2623 modules；.NET Release 0 warning/0 error |
| `pnpm test:e2e` | Edge 三档视口 39/39 通过 |
| 页面人工检查 | `/scope` 与 `/terminal` 无 console warning/error；1366×768 局部宽度复核通过 |
| 2026-08-10 串口资源增量 | 聚焦只读网关 14/14；gateway 71/71；整仓 contracts 91 + frontend 177 + gateway 71 + desktop 74 + legal inventory 1，共 414/414；strict TypeScript、Web 2639 modules 与两个 .NET Release build 通过，0 warning/0 error |
| 2026-08-10 7B 工具离线门 | PowerShell AST 解析通过；validation-only 零副作用；缺授权负向门失败关闭；OperationalScriptSafetyTests 5/5；整仓 contracts 91 + frontend 177 + gateway 72 + desktop 74 + legal inventory 1，共 415/415；strict TypeScript、Web 2639 modules 与两个 .NET Release build 通过，0 warning/0 error |
| 2026-08-10 全局串口与控制台观测增量 | contracts 91 + frontend 182 + gateway 72 + desktop 74 + legal inventory 1，共 420/420；strict TypeScript、完整 Release build 与三档生产 E2E 63/63 通过；顶部串口零自动连接，最近事件标题不再重复翻译，管理员模式仍无 raw 发送；只读网关 disabled/offline，COM1/COM4 仅枚举未打开 |
| 2026-08-10 engineering 终端增量 | contracts 93 + frontend 182 + gateway 79 + desktop 74 + legal inventory 1，共 429/429；strict TypeScript、完整 Release build 0 warning/0 error、三档生产 E2E 63/63；输入无需管理员解锁，只有 v1.2 direct capability 可发送白名单且前端不伪造帧；E2E 固定无网关 mode，不继承 `.env.local`；真实入口以 engineering/offline 启动，仅枚举 COM1/COM4，未打开 COM4、未发送硬件命令 |
| 2026-08-12 实时调度与终端降噪增量 | contracts 94 + frontend 209 + gateway 97 + desktop 118 + legal inventory 6；strict TypeScript、2644-module Web、Gateway/Desktop Release 0 warning/0 error、三档生产 E2E 63/63。fake transport 证明慢状态错峰和运动等待复用 25 ms 快节拍；engineering package smoke 只读枚举 COM1/COM4，`serialPortOpened=false / hardwareCommandSent=false` |
| 2026-08-12 engineering 人工确认增量 | contracts 95 + frontend 211 + gateway 101 + desktop 118 + legal inventory 6，共 531/531；六轴写入后立即 `SENT · MANUAL CONFIRM`，stale 反馈不阻止下一次人工目标，明确 STOP 回包保持自身 correlation；三档生产 E2E 63/63，双包 smoke 只枚举 COM1/COM4，未打开串口或发送硬件命令 |
| 2026-08-12 engineering 冻结识别增量 | contracts 95 + frontend 211 + gateway 103 + desktop 118 + legal inventory 6，共 533/533；strict TypeScript、2644-module Web、Gateway/Desktop Release 0 warning/0 error、三档生产 E2E 63/63。fake transport 证明持续位置回包但角度不变时只降级 joint feedback，连续人工目标保持 stale，角度变化后自动恢复；隔离脚本确认未打开串口、未发送硬件命令 |

## 未完成与下一步

1. 7B 需要新的现场授权后按手册运行干净只读基线；实际采样率、浏览器 heap、网关工作集和帧/审计一致性尚无真实证据。
2. 真实拔线、SignalR 重连、解析错误和连续查询超时仍需在受控条件下记录 UI、REST 权威恢复与端口释放证据。
3. 当前只有 ADR-0009 约束的 Development-only 白名单 direct，后续不得扩展为任意 raw、浏览器直串口或绕过 C# 状态门的通道。
4. Phase 7 不标记 `DONE`，不创建 `phase(07)` 完成提交，不 push。

## 硬件操作

- 本子阶段未启动网关、未打开 COM4、未发送查询、使能、停止或运动命令。
- 用户曾要求发送 `!START`，但没有为本次运行提供新的机械臂净空和物理急停确认，因此未执行。

## 下一阶段启动清单

- [ ] 阅读本 handoff、ADR-0006、Phase 4/5 handoff、只读/控制 runbook 与 `RobotGatewayV1`。
- [ ] 记录操作者、净空、物理急停、供电、姿态、COM4 身份和仅只读测试范围。
- [ ] 先完成不可连接预检和 `gateway:soak:readonly -ValidateOnly`；7B 默认只读，不复用历史授权。
- [ ] 严格按 [Phase 7B 手册](../runbooks/phase-07b-readonly-soak.md) 提供本次授权编号、固定短语和五项现场确认后运行干净基线。
- [ ] 采集实际资源曲线和协议证据，注入故障后验证 stale/恢复/session 隔离。
- [ ] 结束后释放串口和网关进程，确认 5127 listener 与进程均为 0。
- [ ] 全部退出门通过后才更新为 `DONE` 并创建本地阶段提交；仍不自动 push。
