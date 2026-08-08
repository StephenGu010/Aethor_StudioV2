# 阶段 4 交接

- 状态：`IN PROGRESS`
- 日期：2026-08-08
- 实施者：Codex
- 仓库/分支：`Aethor_StudioV2 / main`
- 开始基线提交：`246b9996e43eb19e1be155e27cef10a5d5d38eca`
- 预期完成提交主题：`phase(04): deliver supervised readonly gateway`（只有监督实机门通过后才能创建）

## 本阶段目标

建立 .NET 10 单一串口所有者、loopback REST/SignalR 和前端只读设备会话，只在监督下读取 Dummy 的关节、模式与使能状态。本阶段明确不包含使能、停止、回零、复位、模式切换、raw command、关节运动、动力学或轨迹规划。

## 已完成

- 建立 `Domain → Application ← Infrastructure` 与 `Api` 分层 solution；Domain 不依赖 HTTP、串口或前端类型。
- `ReadOnlyRobotGateway` 独占 session、transport、轮询任务、最新快照、容量 256 的协议历史和容量 128 的事件队列；手动断开、取消、打开失败、拔线、连续超时、退出和 dispose 都有释放路径。
- C# formatter 和真实 SerialPort adapter 双重限制为 `#GETJPOS/#GETMODE/#GETENABLE`；115200、8-N-1、ASCII/LF、无 handshake、DTR/RTS 关闭，没有任何状态改变网络端点。
- API 只使用 `ListenLocalhost`，健康检查与认证 API/Hub 分离；同一 opaque token 支持 REST header 和 SignalR Bearer/query transport，Development token 不能用于非 Development 环境。
- 提供能力、端口枚举、session、关节帧、协议帧、人工只读连接/断开 REST，以及三种 SignalR 通知；REST 快照保持权威。
- 协议帧方向和来源保持一致：TX 查询为 `commanded`、RX 回包为 `measured`、错误诊断为 `unavailable`，并由先失败后通过的 C# 回归断言保护。
- 前端新增 `HttpRobotGateway`、显式环境配置、安全 static fallback、Zod trust-boundary 校验、5 s REST 超时和有界 SignalR 重连；所有 Phase 5 命令本地返回 `unsupported`。
- 设备页支持真实端口列表、人工选择、只读连接/断开/刷新、session/validity/motor/mode/source/反馈显示；只有 `valid` 反馈显示六轴值，陈旧/不可用值不冒充当前反馈。
- 修复 1366×768 设备页根滚动溢出：工作区固定在 shell 内部滚动，导航和关键状态仍保持可达。
- 重整应用壳字体和比例：移除侧栏工程副标、保留 `AETHOR STUDIO / V2` 锁定，采用 Windows 本地 Display/Text/Mono 字体分工，并提高窗口标题、导航、工作区标题和状态值层级；三档视觉基线已逐张复核。
- `dotnet.ps1` 直接透传任意 SDK 参数；`--info/--version` 与原有 restore/build/test/run 均可使用同一项目本地 SDK 选择逻辑。

## 未完成与恢复入口

唯一 Phase 4 退出门尚未执行：监督下打开 COM4 并核对真实 `#GETJPOS/#GETMODE/#GETENABLE` 回包、故障降级与断开释放。用户确认下列现场条件前，不得调用 `/api/v1/session/connect`：

1. 记录在场操作者；机械臂周围净空。
2. 物理急停可立即触达；确认供电状态与当前姿态安全。
3. 核对 COM4 身份为 `USB\VID_1209&PID_0D32&MI_00\7&2BF1B17E&0&0000`。
4. 明确授权本次只发送三个查询，不发送使能、停止、模式或运动命令。
5. 保存时间、原始 TX/RX、session 终态和断开后句柄/进程检查；任何异常立即断开。

实机门通过前，路线图保持 `IN PROGRESS`，工作树不创建误导性的阶段完成提交。

## 关键决策

| 决策 | 原因 | 影响 |
|---|---|---|
| 单一 C# session/transport owner | 防止 UI、Hub 或 adapter 竞争串口和状态 | 同时只允许一个连接；Phase 5 必须扩展同一 owner |
| Domain + Infrastructure 双重精确查询白名单 | raw 或状态改变命令不属于 Phase 4 权限 | 即使上层误用也不能写出其他 payload |
| REST 权威、SignalR 有界通知 | 实时通知可能断线、拥塞或漏中间事件 | UI 显示 transport 警告并由 REST 恢复当前快照 |
| 打开串口后先 `connected + stale` | transport 可用不等于已收到有效反馈 | 六轴值保持 unavailable，完整状态循环后才 valid |
| 查询故障释放且不自动重连 | 端口/现场状态可能已变化 | 操作者必须重新评估后手动连接 |
| Loopback + opaque 启动令牌 | 限制本机进程边界，不依赖浏览器信任 | Phase 8 才由桌面壳生成 production token 和守护进程 |

完整决策见 [ADR-0003](../decisions/0003-readonly-gateway-boundary.md)。

## 变更范围

- 后端：`global.json`、`services/robot-gateway/{src,tests}`、solution、统一 dotnet wrapper 与根脚本。
- 前端：`apps/studio-web/src/integrations`、`pages/device-model`、相关样式、组件/E2E 测试和 `.env.example`。
- 契约：`SerialPortDescriptor`、`ReadOnlyConnectRequest`、`ReadOnlyGatewayCapabilities` 的 TypeScript/JSON Schema 定义。
- 文档：根 README、架构、产品边界、接口规范、运行手册、ADR、路线图、验收矩阵、变更记录和本 handoff。
- 模型/固件资源：未修改 Dummy URDF、STL、manifest 或固件；未进行数据迁移。

## 验证证据

| 检查 | 命令/环境 | 结果 | 证据路径 |
|---|---|---|---|
| 严格类型 | `pnpm typecheck` | shared + studio-web 通过 | `shared/contracts`、`apps/studio-web` |
| Web/C# 测试 | `pnpm test` | shared 80 + frontend 61 + C# 25，共 166 项通过 | `shared/contracts/tests`、`apps/studio-web/src/**/*.test.*`、`services/robot-gateway/tests` |
| Release 构建 | `pnpm build` | Vite 2612 modules、Profile 10 项资源；.NET 0 warning/0 error | 生成物均被忽略 |
| 三档浏览器 | `pnpm --filter @aethor/studio-web exec playwright test --workers=4` / Win32 Edge | 1366×768、1920×1080、2560×1440 共 36/36 通过，1.6 min；覆盖品牌锁定、字体层级、无溢出和视觉基线 | `apps/studio-web/tests/e2e/workspaces.spec.ts`、`workspaces.spec.ts-snapshots/` |
| 后端窄复验 | `pnpm gateway:test` | .NET 10 Release 25/25 通过；覆盖 TX/RX/error 来源映射 | `services/robot-gateway/tests/AethorStudioV2.Tests` |
| 无硬件 API smoke | loopback 5127/5128、显式开发令牌 | live、未认证 401、capabilities `hardwareCommands=false`、COM1/COM4 枚举、session offline、SignalR connect/stop；未调用 connect endpoint | 当前代码对应 API/Hub 与安全测试；无持久化 token 日志 |
| 运行环境 | Windows 10.0.26200 x64 | SDK 10.0.302；ASP.NET/.NET runtime 10.0.10 | `global.json`、`dotnet.ps1 --info`（本机 SDK 不提交） |
| SDK wrapper | `dotnet.ps1 --info/--version`；`pnpm gateway:restore/test/build` | 根级参数透传成功；25/25 测试、Release 0 warning/0 error | `services/robot-gateway/dotnet.ps1` |
| 清理 | 端口/进程只读检查 | 5127/5128/5131 无 listener，无 Aethor gateway host；残留仅为可关闭的 MSBuild build-server 节点 | 本次收口命令输出 |

本次收口曾尝试再次自动启动 smoke host，但命令在进程创建前被本机策略拒绝，因此没有计入通过证据，也没有触碰串口。

## 硬件操作

- 是否枚举端口：是；只读枚举得到 `COM1`、`COM4`，没有打开端口。
- COM4 操作系统身份：`USB 串行设备 (COM4)`，PnP status `OK`，Instance ID 如上。
- 是否打开串口：否。
- 是否发送任何查询、状态改变或运动命令：否；三个批准查询也尚未向真实硬件发送。
- 操作者与物理急停条件：尚未取得本阶段新鲜现场确认，因此实机门未开始。

## 已知风险与限制

- 真实固件的三个回包、时序、拔线和断开释放尚未现场验证；fake serial 和 API smoke 不能替代该证据。
- Windows catalog 当前只保证 `portName`，API 的 `hardwareId` 可能为 null；本 handoff 的 COM4 Instance ID 来自操作系统只读 PnP 检查。
- C# DTO 当前显式维护，并非由 JSON Schema 自动生成；Schema 变更必须同步两端测试。
- SignalR 队列采用 DropOldest 且协议历史有界，慢客户端可能漏中间事件；REST 快照是恢复来源。
- 控制台日志没有持久化保留策略；Phase 7/8 需补发布环境日志根、retention 和故障导出。
- 当前没有 WebView2 进程守护；桌面退出后子进程回收属于 Phase 8，不在 Phase 4 冒充完成。

## 下一步启动清单

- [ ] 阅读公共上下文、路线图、本 handoff、ADR-0003、Dummy ASCII v1 与网关运行手册。
- [ ] 检查 Git 状态并复现 `pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm test:e2e`。
- [ ] 重新取得现场操作者、净空、物理急停、供电、姿态、COM4 身份和三查询范围确认。
- [ ] 只执行 Phase 4 监督 runbook；保存原始查询/回包和释放证据，异常立即断开。
- [ ] 通过实机门后更新本 handoff 为 `DONE`、路线图和变更记录，再创建本地 Phase 4 完成提交；禁止 push。
- [ ] 在 Phase 4 完成提交存在前，不开始 Phase 5 的任何硬件状态改变功能。
