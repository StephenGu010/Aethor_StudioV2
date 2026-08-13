# 系统架构

## 当前状态

仓库已经包含可运行的 React/Vite 前端、共享 TypeScript/JSON Schema 契约、Dummy 与 Aethor_robo 两个内置 Profile、Dummy 专属 .NET 10 网关，以及 Phase 8A 的 WinForms/WebView2 桌面壳。Aethor_robo A0 模型与双七轴本地控制台、A1-U0 候选电机帧与 ID 诊断、A1-U1/U2 有界双工基础、A1-T0 数字孪生实时内核和 A1-H0 主机协议 codec 已完成；Aethor 请求会话运行时仍未进入生产网关、动作执行或真实硬件状态层。Phase 5 Gate B 运动未执行；Phase 6A 已实现 Dummy 离线动作编辑器，6B-S 已实现无生产接线的 C# 执行内核，6B-H 硬件接线未开始。Phase 7A 已实现 Dummy 有界实时示波/协议观测，7B 真实网关长测未开始；Phase 8B 的安装签名、DPI 与正式发布门尚未完成。当前代码统一为：

```text
apps/
  studio-web/               React、Three.js、ECharts UI
  studio-desktop/           WinForms/WebView2 壳、打包与测试（Phase 8A）
services/
  robot-gateway/            C# .NET 10 Domain/Application/Infrastructure/API 与测试
shared/
  contracts/                网关/动作 JSON Schema、TS 类型、协议纯函数、状态机与 conformance vectors
  robot-profiles/
    verify-provenance.mjs    内置模型来源/规范化资产完整性门
    BuiltIn/dummy-6dof/     URDF、STL、manifest、来源与许可
    BuiltIn/aethor-robo-dual-7dof/
                            双臂整机 URDF、23 个 STL、manifest、来源与许可说明
docs/
```

根目录拥有 pnpm workspace、统一 Web/C# 脚本和唯一 pnpm 锁文件。Vite/Vitest/TypeScript 统一从 `shared/robot-profiles/BuiltIn` 读取 Profile；仓库不保留迁移前的兼容目录。阶段 0–4 已完成；阶段 5 的 Gate B 和阶段 6B-H 仍被四参数运动包络阻止，阶段 6A/6B-S 可在零硬件写入边界内独立验证。

## 前端信息架构与视觉系统

- 五个工作区固定为 `/console`、`/scope`、`/terminal`、`/devices` 和 `/actions`；旧 `/twin` 只做兼容重定向，不再是规范路由。页面模块按路由懒加载。
- 顶栏 `Current profile` 是整台设备的唯一全局选择器：`Dummy` 表示一台六轴机械臂，`Aethor_robo` 表示一台包含左右两组七轴机械臂的空间机器人。Aethor_robo 内部的左右臂 tab 和整机/左右臂取景只是 Profile 内二级选择，不创建第二个设备会话。
- Dummy 顶栏串口组件是 `RobotGatewayV1` 的全局会话入口，只负责端口枚举、人工选择、显式连接和满足 disabled/valid 条件后的断开。它与设备页共享 runtime session/active port，不直接访问 HTTP、SignalR 或 `SerialPort`，不自动连接、不重试；Aethor_robo 下固定为不适用。顶栏工程状态收敛为 `MOTOR / FEEDBACK / MODE`，避免重复串口和 URDF 状态挤占紧凑布局。
- 石墨深色主题、字号、间距、栏宽和语义状态由 `apps/studio-web/src/styles/tokens.css` 统一定义，不依赖在线字体；标题与正文使用 `Inter, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif` 本地回退栈并启用 optical sizing，只有数值、协议与紧凑工程编码使用 `Cascadia Mono`。产品名、导航和普通说明使用自然/句首大小写；`URDF`、`SERIAL`、`TX/RX`、单位与机器状态码保留大写。
- 1366×768 使用不低于 11px 的紧凑标尺和工作区内部滚动；1920×1080 为设计基准，页面标题 28px、正文 15px；Aethor_robo 每次只显示当前七轴臂并允许控制列局部滚动。2560×1440 将页面标题提升至 30px并提高画布与数据密度。
- 顶栏、导航、关键状态、软件急停和主下发区保持可达。禁用操作由可聚焦说明容器暴露原因，浏览器模式不伪造桌面窗口能力。
- `/actions` 是 Phase 6A 离线动作编辑工作台：允许新建、导入、显式保存、点位编辑/排序和目标草稿预览。运行入口固定禁用并显示 `PHASE 6B LOCKED`；页面没有硬件命令路径。

## 控制台交互与资源所有权

- `robotModel.ts` 只按 Profile 声明的稳定关节名绑定 URDF joint；mesh 名称不参与关节推断。Dummy 使用 `joint_1…joint_6`，Aethor_robo 使用左右两组各七个关节。关节原点和局部轴来自 URDF 对象变换，本地预览范围来自已校验 manifest。
- `JointManipulator.tsx` 将选中关节的局部轴变换到世界空间，在轴法向平面计算右手规则有符号角；视线接近平面时退化为屏幕切向投影。黄色旋转环拥有高优先级拾取，避免被重叠模型几何抢占事件。
- Aethor_robo 模型点选、旋转环、滑块、数值框和键盘微调共享独立的 14 轴本地目标草稿；它不读取 `showcaseJointFrame`、Dummy runtime store 或 `RobotGatewayV1`。左右臂 tab 只切换当前七轴控制组，六个车轮保持模型专用。
- 相机取景是 ConsolePage 的临时 UI 状态，只有 `all / left-arm / right-arm` 三种值。`RobotScene` 根据 Profile `jointGroups` 计算整机或目标机械臂的联合实际/幽灵包围盒；切换取景会同步当前七轴控制组，但不修改任何关节值。未知组回退整机，显式重置只重算当前取景。
- 实体模型与目标模型是独立对象树；同一 STL 的 visual/collision 节点在单次模型生命周期内合并并发加载并共享一份只读 geometry，实体节点共享同一材质，目标树继续共享 geometry、但拥有可独立高亮的幽灵 material。失败条目立即从缓存移除，使有界网络重试启动一次真实新加载；缓存不跨模型生命周期持有资源。卸载时按唯一引用释放 geometry、material 和 texture，OrbitControls、renderer 所有权与活动拖动会话进入可见诊断计数。
- `RobotScene` 是控制台页面内的二级动态分包，避免 Three.js/URDF 加载器进入页面主 chunk。WebGL 缺失、上下文丢失、URDF/mesh/映射失败均显示明确降级状态；R3F 使用 demand render，画布尺寸或设备 DPR 变化时按实际 CSS 面积重算栅格密度：balanced 上限 1.75/350 万 framebuffer pixels，constrained 上限 1.2/180 万，最低 DPR 1；布局尺寸与相机不变。低性能环境同时关闭抗锯齿和阴影。R3F `Canvas fallback` 会成为原生 `canvas` 的子节点，视觉隐藏时仍可能进入可访问性树，因此不承载错误语义；真实故障只由预检、外层错误边界和 `webglcontextlost` 状态负责，READY 画面不能同时暴露失败告警。
- R3F 使用 `frameloop="demand"`：静止模型不持续占用 GPU。OrbitControls 原生 change、阻尼未收敛、相机适配、模型加载、关节差量、可见性/轴/高亮变化以及拖拽开始结束都显式 invalidate；模型 READY 的两帧门也会自行请求下一帧，不能依赖永久动画循环。场景根的只读 frame counter 用于生产 E2E 证明空闲帧收敛且交互后恢复，不参与业务状态。
- 初次加载 Profile 时，相机根据实际模型与目标模型的联合世界包围盒、画布宽高比和透视 FOV 计算取景，不写死某一机器人尺寸；窗口尺寸变化或显式“重置相机”会重新适配。场景不使用固定距离雾化，因为它会让大于 Dummy 尺寸的模型在正确取景后仍被背景雾完全遮蔽。联合包围盒只在模型就绪、整机/分组取景变化或显式重置时遍历重算；连续关节预览只应用差量关节姿态，不在每次输入时遍历整机或自动移动相机。
- 参考网格从完整实体/幽灵模型的世界包围盒独立计算，不跟随左右臂局部取景缩小。网格中心覆盖整机 X/Z 足迹，边长为足迹的 2 倍且至少 6 m，分格数限制在 24–80；Y 平面位于完整模型最低点下方模型高度的 6%，并限制为 8–30 cm，不能穿过模型。
- 内置 Profile 的 URDF/STL 都是同源只读静态资产。浏览器网络切换导致 status 0 / failed fetch 时，每个资源只允许一次立即重试；404、外部 URL、解析失败和第二次网络失败立即进入模型错误。该策略不适用于 REST、SignalR、串口或硬件命令。
- Aethor_robo 的 `provenance.json` 固定来源 ZIP、原始/规范化 URDF 和 23 个源 STL→规范名称的 SHA-256 映射。`verify-provenance.mjs` 流式计算当前资产哈希，并要求 provenance、URDF 引用和磁盘 STL 集合完全一致；`test:web` 与 `build:web` 在 Vitest/Vite 前失败关闭。完整 BSD 条款仍缺失，因此哈希完整不代表获得分发授权。
- Playwright 使用 `vite preview` 验收当前源码的生产构建；`test:e2e` 先执行 Profile 溯源与 strict TypeScript，再使用固定无网关的 Vite `e2e` mode 构建，防止本机 `.env.local` 的开发网关 URL/令牌污染零硬件请求断言。直接复用旧 `dist` 或开发配置的结果不构成阶段证据。
- Aethor_robo 的 visual/collision 节点按 URL 共享 23 份 geometry；实体模型共享材质，目标幽灵不绘制 collision，并按 14 个受控关节与一个基础组共享高亮材质。目标姿态只更新数值发生变化的关节。workbench store 由场景设置、窗口开关和具体窗口分别选择订阅，窗口坐标变化不能重渲染 3D 场景。

## 依赖方向

```text
studio-web ──> shared/contracts
     │               ▲
     └─ RobotGatewayV1│
                     │
robot-gateway ───────┘ ──> SerialPort ──> Dummy firmware

Aethor_robo console ──> profile + local 14-joint draft
                    ├──> AethorArmMotorFrameV1 ingest
                    │      └── latest-per-arm coordinator (20 ms / ≤50 commits/s)
                    │             └── atomic dual-arm projection + per-joint freshness
                    └─X─> runtime gateway / SerialPort

studio-desktop ──> DesktopBridgeV1 ──> studio-web
       └────────> process supervisor ──> robot-gateway
```

- Dummy 设备、示波、终端和状态页面只依赖 `RobotGatewayV1`，不直接访问 HTTP、SignalR 或串口。只有当前 Profile 为 Dummy 时，AppShell 才挂载唯一 `GatewaySessionCoordinator` 和全局安全告警；路由切换不创建第二条 SignalR 通道。`/terminal` 是双 Profile 外壳，Aethor 分支只做候选协议校验并保持 TX 禁用；示波和动作编排仍使用明确的 Dummy 能力门。
- C# `RobotGateway` 独占串口、查询循环、命令仲裁、超时、取消和协议/命令历史；所有写入经过 Domain formatter 与 Infrastructure payload policy，不能另建前端命令通道。
- 桌面壳只负责窗口生命周期、进程启动、会话令牌、应用数据路径和能力声明，不拥有机器人业务状态；网关仍是串口与命令唯一所有者。
- Profile 是设备描述和资源来源，不能承载运行时连接状态。
- `shared/contracts` 不拥有串口；其中的 transport 只是端口，fake 只用于无硬件测试。Phase 4 的 C# adapter 才拥有真实 SerialPort 生命周期。
- Aethor 的 `AethorArmMotorFrameV1` 是未来 adapter 到 UI 的信任边界，不是第二个串口入口。Schema 保留无序子集、重复和范围外 ID；`ingestAethorTwinMotorFrame` 先按左右臂各保留一条最新待处理帧，在 20 ms 提交窗口中把双臂原子写入一次 Zustand，模型提交上限为 50 Hz。入口拒绝同一会话内的 controller/arm 身份切换、旧序号、旧 boot 回流和不兼容帧；Profile 切换/会话重置后才接受新身份。
- 领域层按 ID 1–7 更新对应关节并隔离冲突值。每个关节保留自己的最后观察时刻与设备 `feedbackAgeMs`；总年龄达到 250 ms 后保留最后角度但转为 `stale`，实体链灰显，来源标签撤销为 `UNAVAILABLE`。这是前端显示新鲜度，不参与未来固件/网关控制授权。

## 桌面宿主与进程边界

- `AethorStudioV2.Desktop` 使用单实例 mutex/activation event。第二次启动只唤起现有窗口，不创建第二个网关。
- 父进程每次启动生成 32 字节加密随机 token 和随机 loopback 端口，以最小环境白名单启动 `AethorStudioV2.Api`。无参数启动固定 `Production + desktop token + commandPolicy=disabled`；显式 `--engineering` 才使用 `Development + development token + commandPolicy=engineering`，用于本机调试且不自动打开串口，不作为正式发布候选证据。
- 父进程对自有子网关的 readiness 与 host shutdown 请求使用 `UseProxy=false`、禁止重定向的专用 HTTP 客户端；本机代理配置不得参与 loopback 生命周期，也不要求用户维护 `NO_PROXY`。
- WebView2 将包内 `web` 目录映射为 `http://localhost`，在应用脚本前注入冻结的 `DesktopBootstrapV1`。外部导航、新窗口、权限和拖放全部拒绝。
- 桌面启动顺序固定为：离线探测 WebView2 Stable Runtime → 创建 WebView 环境与控件 → 启动命令关闭的机器人网关 → 注入 bootstrap 并导航。Beta/Dev/Canary、空/非法版本或 loader 异常均在网关启动前失败关闭；原生前置条件面板明确不自动下载组件，并提供仍经过宿主安全门的关闭入口。
- `DesktopBridgeV1` 仅允许最小化、最大化切换、关闭、标题栏拖动和诊断包导出。未知版本、字段或来源失败关闭；前端对同类在途请求做合并。窗口动作 2 秒、关闭 10 秒、诊断导出 120 秒超时，浏览器 fallback 始终禁用且不会伪造成功。
- 正常关闭先调用带令牌的 `POST /api/v1/host/shutdown`。网关只有在无串口会话或设备明确 disabled 时返回 202；否则宿主保留窗口并显示失败。Windows Job Object 为父进程异常退出提供子进程回收兜底。
- 桌面进程显式为 Per-Monitor V2 DPI aware；窗口尺寸由 WinForms DPI 缩放，自定义无边框命中区按当前显示器 DPI 计算。网关意外退出会阻断整个工作区并保持设备状态为未知，不自动重启或重连；进程消失不能替代宿主 202 安全关闭确认，普通关闭保持拒绝。恢复策略以原子单向状态固定 `Normal → GatewayFailed → OfflineRestartRequested`，正常态不能越权请求离线重启，并发点击也只接受一次；随后才结束当前桌面 session 并用 `--offline` 创建新进程。
- `%LOCALAPPDATA%\Aethor Studio V2` 是日志、WebView2 数据、RobotProfiles、CrashDumps、Temp、布局版本和窗口位置的唯一应用数据根。日志有界轮转并遮蔽令牌；窗口恢复被限制到当前显示器可见区域。用户可通过桌面桥导出原子写入的诊断 ZIP，包内仅包含说明、清单和最多五份已脱敏桌面轮转日志，不复制终端记录、命令审计、目标草稿或模型资源。
- Desktop 在页面导航成功后通过 WebView2 CDP 每 60 秒采集一次低频 `AETHOR_PERF_V1`。采样 single-flight，失败即停止；除可信本地路由映射出的 `console/scope/terminal/devices/actions/unknown` 工作区、有界 JS heap、Documents/Nodes、Layout/RecalcStyle 次数和可见性外，还从 `CoreWebView2Environment.GetProcessInfos()` 的官方快照聚合可观测 WebView2 进程数/工作集，并附桌面宿主、可空网关及三者受跟踪合计。工作区分类器拒绝非 `http://localhost`、非默认端口、非打包入口和未知路由，日志不保存完整 URL、查询参数或片段。进程句柄读取后立即释放，PID、路径、命令行、CDP 原文、脚本、DOM 内容和设备数据均不落盘。WebView2 快照明确排除 crashpad，因此合计不冒充 OS 完整进程树；该采样用于资源趋势诊断，不是 Phase 7B 真实长测或内存合格阈值。
- 自包含包生成逐文件 SHA-256 manifest，且输出目录必须位于仓库根内；默认拒绝脏工作树。`-AllowDirty` 只产出 `development-dirty`，干净但未签名的包为 `development-unsigned`。.NET publish 使用本次短名 `.stg-*` staging 内的隔离 `.dn` artifacts path，并在 manifest 前删除中间目录；短内部路径避免自定义输出根把 Windows 清理路径推过 260 字符，旧运行进程锁定常规 `bin/Release` 时也不会污染或阻断新包。包内 `Legal/` 集中携带两个 Profile 的 NOTICE/provenance 与独立模型再分发状态；同时从安装后的 pnpm 生产图与实际发布 `.deps.json` 生成 SPDX 2.3 组件清单、完整性摘要和包内法律文本，不把开发依赖或推测组件写入发布事实。包根遗漏正文的依赖只能由精确 ecosystem/name/version、包完整性、不可变上游 revision/blob 和双 SHA-256 绑定的仓库输入补齐；版本、声明、路径、哈希或来源变化均失败关闭，打包期间不下载法律材料。package smoke 校验组件/PURL/关系/附件、双模型状态与 manifest 闭包；`releaseReady` 同时要求依赖正文和模型再分发条款完整。四项签名输入必须同时存在，脏工作树禁止签名；七个自有 PE 文件在 manifest 哈希前完成 Authenticode、精确 Publisher 和 RFC 3161 时间戳复验后才可标记 `release-candidate`。正式发布目标为 MSI，二进制与应用数据根分离；当前依赖正文门已关闭，但两个模型条款、安装工具治理、真实证书签名、升级/卸载演练与完整四档 DPI/多显示器目视矩阵仍属于 8B。
- 构建验证输出与运行输出分离：根 `pnpm test` / `pnpm build` 的网关和桌面步骤经 `dotnet-isolated.ps1` 创建唯一 `artifacts/validation/dotnet/.run-(gw|dt)-<pid>-<uuid>`，拒绝调用方覆盖 artifacts path，并在成功或失败后只删除自己拥有的精确子目录。常规 `bin/Release` 仅由显式 `gateway:build` / `desktop:build` 持久化，供运行手册消费；验证脚本不得终止进程、打开串口或发送硬件命令。

## 运行时状态所有权

| 状态 | 所有者 | 生命周期 |
|---|---|---|
| 当前 Profile | `useActiveRobotProfileStore` | 当前前端应用会话；浏览器模式恢复版本化 `sessionStorage`，带 Dummy child gateway 的 Desktop 新会话强制从 `Dummy` 启动，使唯一 coordinator 能立即只读枚举端口；切换时清空隐藏目标草稿、Dummy runtime 与遥测历史 |
| 当前人工选择/已连接端口 | 顶栏或设备页 → studio-web runtime store；串口句柄仍由 C# `RobotGateway` 所有 | 当前 Dummy session；只在显式连接后记录，完成断开即清空；端口列表可重新枚举 |
| 连接、使能、模式、最新反馈 | C# `RobotGateway` | 当前唯一设备会话 |
| 命令在途、幂等、安全联锁与有界审计 | C# `RobotGateway` | 当前设备会话；未知结果锁存至成功停止或新 session |
| 动作执行内核状态 | C# `ActionProgramRunner` | 6B-S 进程内单 run owner；当前仅 fake port、无 DI/API/持久化或硬件可达路径 |
| 命令审计恢复状态、页面副本与前端联锁镜像 | AppShell `GatewaySessionCoordinator` + `GatewayCommandLifecycle` → studio-web runtime store | 当前 session；`unavailable/loading/ready/error`，最多 128 条，session identity 改变即清空；最近展示结果与 `latchedSafetyResult` 分离，成功 STOP 时间水位抵抗乱序旧终态 |
| 前端遥测可信度与全局降级告警 | AppShell `GatewaySessionCoordinator` → studio-web runtime store | SignalR 故障立即把 measured session/joint 降为 `stale`；仅 REST 权威恢复成功后清除，五个工作区共享同一持续告警 |
| 有界遥测历史 | runtime store → `LiveSignalHistory` | 当前 measured session；18 路、每路最多 4800 点/120 秒，session identity/offline 改变即清空，同 session 重连保留可信历史 |
| Dummy 目标关节角 | `useRobotSessionStore` draft | 当前前端会话；新硬件 session 首个可信实测帧可一次性建立目标基准，用户编辑优先；只供预览/受门控整组命令，不由后续反馈覆盖 |
| Aethor_robo 双臂目标角 | `useAethorRoboConsoleStore` draft | 当前前端会话；14 轴本地预览，与 Dummy 状态和网关完全隔离 |
| Aethor_robo commissioning 帧/实体姿态 | `AethorTwinFrameCoordinator` → `useAethorRoboConsoleStore` | adapter 只提交版本化帧；最新帧合并、双臂原子提交和显示新鲜度已经实现，不覆盖目标草稿；生产调用方仍等待 A1-H adapter |
| 动作文档草稿、选择和预览标记 | `useActionProgramStore` ephemeral state | 当前编辑会话；不持久化 |
| 页面、筛选、选中信号 | URL | 可分享导航状态 |
| 工具窗布局、显示偏好 | Versioned local storage | 本机用户 |
| 静态展示采集 | StaticShowcaseSource | 仅展示，永不产生在线状态 |
| 已保存动作程序 | `useActionProgramStore` versioned local storage | 本机浏览器；只在显式保存后写入，启动时按 Schema 重验；导出文件是备份/交接边界 |

反馈与目标草稿必须独立，不同 Profile 的草稿也必须独立。拖动滑块或 3D 关节只修改当前 Profile 草稿和幽灵模型，不得改写实际反馈、另一个 Profile 的草稿或自动向硬件发送。Dummy 完成断开后，前端以一个原子 runtime 复位清空连接/协议/命令/遥测临时态，将实体与幽灵模型恢复到 Profile 软件启动姿态并重置相机；已保存动作程序、布局和显示偏好保留。软件启动姿态不声明物理 HOME 或安全位置。

Dummy 建立新硬件 session 后，协调器只接受 profile、DOF、source 和 validity 均合法的首个实测帧做一次目标基准对齐；若操作者先编辑目标则取消待对齐。`#GETJPOS` 设备角贯穿反馈、目标、动作点位、误差与网关命令，Profile 的 `modelTransform` 只在 Three.js/URDF 边界换算；Dummy J3 为 `model=device-90°`，其余五轴为恒等。后续实测帧只更新实体反馈，不覆盖幽灵目标，也不构成物理零位或关节方向验收。

从 Dummy 切换到 Aethor_robo 前，Dummy 必须处于 `offline`、无安全联锁且已确认去使能；连接中、重连中、状态未知或电机未确认 disabled 时切换失败关闭。Profile 切换不是断开或停止命令，也不能替代安全清理。

示波页面不拥有实时连接。runtime store 在接受合法关节帧时同步写入 `LiveSignalHistory`，使 REST 初始快照、SignalR 更新和人工权威刷新共享同一入口。采集逐帧进行；React hook 只将图表快照限制为前台 100 ms、页面隐藏 1000 ms。ECharts 实例跨数据刷新复用，页面卸载时唯一 dispose。终端直接消费 runtime store 的 256 帧有界协议证据，不从帧数推断网关是否存在。

## 网关边界

Dummy 的 `RobotGatewayV1` 有两个实现，相关页面不直接依赖 HTTP、SignalR 或串口：

- `StaticShowcaseSource`：未配置网关时的安全默认值；不枚举/连接串口，命令返回 `unsupported`，展示数据永不提升为真实状态。
- `HttpRobotGateway`：仅接受 loopback URL 和 32–256 字符令牌；REST 负责能力、枚举、人工连接/断开、结构化命令、Development-only engineering direct、权威快照与有界历史，SignalR 负责 session、关节帧、协议帧、结构化命令终态和 direct 发送状态通知。
- engineering direct 不是浏览器串口旁路：C# 继续独占 transport、规范化单行 ASCII、执行白名单/限位/状态校验，并把真实 TX/RX 写入协议证据。HTTP 受理产生 `queued + gatewayAccepted`；物理 writer 成功后发布 `sent + transportWritten`。请求不等待 FIFO、`ok` 或到位，迟到回包只进入有界日志；终端可连续提交，队列过期、淘汰、断开和写失败分别收束。唯一后台 reader 继续尝试 `#GETJPOS`，运动期间查询超时只把反馈降为 stale，不自动断开或阻止下一次人工目标。
- C# API 使用 `ListenLocalhost`，`/api/v1` 与 `/hubs/robot-v1` 校验同一 opaque session token。Development token 不能用于非 Development 环境。
- `RobotGateway` 独占 transport、轮询与命令仲裁，并把已打开 transport 交给唯一 `DummySerialSession`。该 session 只有一个连续 reader、一个有界优先级 writer 和一个 Dummy decoder；结构化问答通过单一 response fence 匹配无标签回包，direct 只排队写入而不持有 fence。`#GETJPOS` 默认以 25 ms 固定周期、P2 优先级查询；模式与使能每 250 ms 交替插入一项。普通结构化命令与 direct 为 P1，STOP/DISABLE 为 P0 并可有界抢占低优先级 fence。任何查询超时都会降为 stale，并通过两个错峰周期重新取得完整状态。固件自身已有独立通信任务和 CAN 回调，运动期间反馈不更新的根因是位置控制分支未周期触发电机角采集，不是主机缺少第二条异步串口。命令默认关闭；supervised 只接受 desktop token；没有 raw 端点。HOME/RESET 因固件阻塞风险不进入生产 supported capabilities；关节组只有在速度、到位容差、连续稳定窗口和总超时同时配置时才声明，并由网关持有实测到位判定。
- SignalR 事件队列只承担有界通知，不拥有串口或权威状态。每次 sink 发布有独立超时；超时即停止该事件泵并记录 `events.publish.timeout`，不继续生成悬挂发布。dispose 先完成命令/轮询与 transport 释放，再给事件队列有界排空窗口；不响应取消的 sink 不能阻塞串口释放或宿主无限退出。
- REST session/joint state 和命令历史是 Dummy 硬件路径的权威值；命令审计保存规范化请求、请求指纹、最多 32 条实际成功写入 transport 的 payload 和截断标志。AppShell 协调器独占初始权威状态恢复，页面挂载不再重复写入 capabilities/session。SignalR `commandResult` 或 session identity 改变会触发 REST 审计重取；只有恢复状态为 `ready` 才允许普通硬件命令，失败时只读遥测继续但仅保留停止去使能。SignalR 重连、关闭或契约错误会立即保留最后实测值并降为 `stale`；重连事件本身不清除降级，必须重新取得 REST capabilities/session/joint/protocol 快照。契约错误触发合并限流的 REST 恢复，重连中等待 `onreconnected`，最终关闭则保持降级直至重新建立实时会话。恢复窗口内到达的实时 valid 帧仍按 stale 接收。Dummy 相关页面继续保留最后实测姿态并标记 `MEASURED STALE`；Aethor_robo 控制台始终保持 `MODEL ONLY`，不会把该状态解释为本机反馈。全局告警跨路由持续存在，普通 Dummy 控制保持锁定。前端将“最近命令结果”与安全联锁镜像分离，手动刷新也会从历史重建联锁；空白、陈旧或截断历史不会清除已知联锁，只有时间不早于联锁的 `stopAndDisable completed` 证据可清除。前端仅保存当前 session 最多 128 条展示副本，设备页可刷新并导出 JSON。容量 128 的 SignalR 事件队列拥塞时丢弃最旧通知，容量 256 的协议历史仅用于补充诊断，不能替代命令审计。
- 串口成功打开后先显示 `connected + stale`，完整有效查询循环后才是 `valid`；普通打开失败会释放临时 transport、保留关联错误并直接恢复 `offline`，不会生成需要人工释放的 faulted 会话或阻塞桌面关闭。打开阶段另有默认 5 秒、宿主可在 `100–30000 ms` 内配置的总超时；超时或调用方取消会立即触发候选连接 dispose、记录 `serial.open.timeout/cancelled`，并隔离本 Gateway 进程的后续打开尝试，要求重启后再连，防止不响应取消的原生 `SerialPort.Open()` 工作项重复累积。通常，成功打开后的连续三次协议查询超时、拔线或 I/O 错误进入 `faulted` 并释放 transport；engineering 人工运动写入后是明确例外：查询超时保持 `connected + stale` 并继续低噪声重试，直到反馈恢复、显式停止/去使能或人工断开。Windows adapter 使用短同步读窗口检查取消，避免 `BaseStream.ReadAsync` 在驱动无回包时永久占有串口；硬件命令获取串口所有权使用 `CommandTimeout` 有界等待，STOP 未取得所有权时返回未确认并锁存联锁，普通命令在零写入前超时则拒绝。

浏览器开发模式只有在 `VITE_AETHOR_GATEWAY_URL` 和 `VITE_AETHOR_GATEWAY_SESSION_TOKEN` 同时有效时才创建 `HttpRobotGateway`；否则显式回退为 `BACKEND ABSENT`。有效 Desktop bootstrap（包括显式 `gateway=null`）是唯一权威配置，不能被 `.env.local` 或构建变量覆盖；production/e2e bundle 强制清空两项 Vite 网关值，Windows 打包还会扫描并拒绝开发 URL 或令牌进入产物。

Application 的 `SerialDuplexScheduler` 已在 A1-U2 接入 Dummy 生产网关：持续 RX reader、有界优先级 TX writer、RX 背压、P0 安全预留/低优先级淘汰、P1/P2/P3 公平调度、排队时效和关闭 transport 解锁均由同一运行时负责。协议 parser 与 response correlation 留在 `DummySerialSession`；旧 `serialIoGate` 和第二 reader 已删除。A1-H0 的 `AethorArmAsciiProtocol` 是无状态 Domain codec，尚未注册 DI 或接触 transport；后续 Aethor session adapter 复用调度器机制，并以 request ID/boot/session 关联响应而不拥有 writer。

串口目录与会话动作属于临时运行态，由 `useGatewayRuntimeStore` 唯一持有。顶部入口和设备页通过 `refreshSerialPortCatalog` 合并同一 gateway 上的并发枚举；显式连接/断开通过 `serialSessionOperations` 合并相同意图并拒绝冲突意图，两个入口不能各自拥有第二套 busy 状态或直接发起物理会话请求。UUID `operationId` 贯穿前端 `AETHOR_PROBE_V1` 与网关：目录使用 Event 1006/1007/1002，会话使用 Event 1008/1009/1010；只记录终态、耗时、数量/连接状态和失败分类，不记录令牌、端口身份或请求正文。完整约定见 [诊断与日志探针](runbooks/diagnostics.md)。

## 动作文档与执行边界

- `shared/contracts/action-program-v1.schema.json` 是文件格式权威源；前端 Zod 在导入、保存、导出和本机恢复时重复校验 profile、六轴长度、manifest 限位、模式、来源与 UTC 时间。
- 草稿与已保存 revision 分离。新建、导入、复制和编辑只改内存草稿；显式保存后才写入版本化 local storage。库限制为 64 个文档和 4 MiB，未知版本、损坏记录与超限写入失败关闭，不静默迁移。
- `manual / measuredCapture / showcaseExample` 来源不可互相伪装。实测采集要求 connected、session/joint profile 匹配、source measured、valid 且六轴完整；SHOWCASE 不生成采集时间。
- 预览只调用 Dummy `alignTarget` 写入 Dummy 本地目标草稿，不调用 `RobotGatewayV1`，也不改写 Aethor_robo 14 轴控制台草稿。Action 页面没有 runner、队列或定时推进逻辑。
- Phase 6B-S 的 C# `ActionProgramRunner` 是独立 owner，但仅依赖未注册的 `IActionProgramCommandPort`。它逐点要求模式和关节组 `completed + feedbackConfirmed`，到位后才等待；异常进入一次有界停止，checkpoint 绑定 revision/session/计划指纹。Phase 6B-H 才允许新增真实 adapter、API 与前端运行态，且依赖 Gate B。

## 资源与故障边界

- URDF、mesh 和配置包导入必须拒绝路径穿越、Windows 大小写/保留名冲突、外部 URL、重复关节、DOF 不匹配、缺失资源和非法限位。前端 ZIP 预览先以中央目录元数据实施 250 MiB 压缩/解包、2,048 文件、1 MiB manifest、8 MiB URDF 和 64 条诊断边界，再只异步解压 manifest 与目标 URDF；STL 不在校验阶段展开。选择替代文件或页面卸载会取消旧任务，旧结果不得覆盖新选择。
- Three.js 场景切换/卸载时释放 geometry、material、texture、controls 和 renderer 资源。
- 串口断开、帧解析失败、反馈过期或查询超时均进入可见降级/故障状态，不能回退成“成功”。轮询取消、手动断开、打开失败、进程退出和 dispose 都收束到唯一 transport 释放路径；adapter 用 100 ms 同步读窗口实现可观察取消，断开仍先关闭句柄，再等待任务终态并 dispose。打开阶段的候选连接尚未成为 active transport，因此取消时由独立后台清理观察原生 Open 结果；Gateway 同时禁止同进程重试，进程退出是无法中断驱动调用的最终回收边界。完成断开后清空当前会话证据和联锁，下一次连接不得继承旧协议帧、命令记录或关节序号。
- 外部事件 sink 不属于机器人资源所有权链。其超时只影响实时通知并产生诊断；不得反向延长 transport 生命周期，也不得把未发布的 SignalR 通知解释为设备状态变化。客户端继续以 REST 快照和命令历史恢复。
- 软件急停不能替代物理急停；只有后端明确确认去使能后，UI 才能显示完成。
- 结构化命令若丢失 HTTP 响应，前端不能假设请求未到达后端；本地生成 `unconfirmed + transportError` 并锁定普通命令，直到成功停止或新 session/权威审计恢复完成。
- C# 以命令审计条目写入作为接管线性化点：接管前已经取消的请求不留审计且零串口写入；接管后的 HTTP 取消只中断调用方等待，网关拥有的命令继续到唯一终态。同 ID 恢复读取同一结果，不重复物理发送。人工断连在仍有硬件命令或设备未明确 disabled 时拒绝；宿主清理先取消任务、关闭 transport 解除原生 I/O，再等待 runner 收束并 dispose，避免关闭过程永久挂起。
- 监督控制预检以 Domain/Application/Infrastructure/API 四个自有 Release DLL 的有序逐项哈希和总清单哈希标识待运行网关；API DLL 单项哈希仅保留兼容展示，不能证明依赖层代码未变化。
- 所有前端命令入口共用 `GatewayCommandLifecycle` 收束 HTTP 终态、REST 快照和审计恢复；顶部软件急停不再拥有简化旁路。响应丢失一律生成本地 `unconfirmed/transportError/none` 并把 measured 状态降为 stale；命令后的 REST 状态恢复失败同样降级。成功 STOP 的时间水位阻止迟到旧结果重新锁存或覆盖最近结果。
- 实时示波只接收 `measured + valid` 且 profile/DOF/时间/序号合法的帧；重复或倒序帧拒绝，序号缺口可见。目标意图和派生误差分别标记 `COMMANDED/COMPUTED`，不能被解释为实机确认。

关键目录决策见 [ADR-0001](decisions/0001-repository-layout.md)，协议白名单见 [ADR-0002](decisions/0002-dummy-protocol-boundary.md)，Phase 4 只读进程边界见 [ADR-0003](decisions/0003-readonly-gateway-boundary.md)，Phase 5 受监督命令边界见 [ADR-0004](decisions/0004-supervised-command-boundary.md)，动作离线/执行拆分见 [ADR-0005](decisions/0005-offline-action-document-boundary.md)，观测软件门/实机长测拆分见 [ADR-0006](decisions/0006-live-observability-boundary.md)，桌面进程与桥接边界见 [ADR-0007](decisions/0007-desktop-process-and-bridge-boundary.md)，Windows 安装与数据保留见 [ADR-0008](decisions/0008-windows-installer-and-user-data.md)。
