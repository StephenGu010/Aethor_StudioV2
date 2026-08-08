# 变更记录

## 2026-08-08 - 阶段 4：只读网关软件门（IN PROGRESS）

需求：
- 建立工业级 .NET 10 串口边界，在监督实机前只允许读取 Dummy 六轴状态，不提前引入任何硬件状态改变或运动权限。

改动：
- 新增 Domain/Application/Infrastructure/API 分层、单一串口 session owner、fake transport、Windows SerialPort adapter 和 25 项 C# 测试。
- 将 Phase 4 写入限制固化为 Domain formatter 与 Infrastructure payload 双重白名单，仅允许 `#GETJPOS/#GETMODE/#GETENABLE`。
- 新增 loopback REST/SignalR、opaque session token、Development/desktop token source、显式失败状态、有界事件队列/协议历史和无自动重连策略。
- 修正协议帧来源语义：TX 查询标记为 `commanded`，RX 回包为 `measured`，解析/超时错误为 `unavailable`；不再把网关写出的查询误标为设备测量。
- 前端增加 `HttpRobotGateway`、loopback/Zod trust-boundary 校验、安全 static fallback、设备页人工只读连接/断开/刷新与真实来源/有效性显示；所有 Phase 5 动作保持禁用。
- 完成 Phase 4 视觉修订：移除侧栏 `ROBOTICS ENGINEERING / CONTROL WORKSPACE` 副标并保留清晰的 `V2` 版本标识；将标题、正文和工程数值拆分为 Windows 本地 Display/Text/Mono 字体角色，重新校准标题栏、导航、状态带和三档视口字号比例。
- 修正项目本地 `dotnet.ps1` 的参数透传；`--info/--version` 等根级 SDK 诊断参数不再被 PowerShell advanced-script 公共参数抢占，现有 restore/build/test/run 调用保持兼容。
- 同步运行手册、RobotGatewayV1 接口、架构、产品边界、ADR-0003、路线图、验收矩阵和 Phase 4 handoff。

验证：
- `pnpm typecheck` 通过；`pnpm test` 为 shared 80 + frontend 61 + C# 25，共 166 项通过。
- `pnpm build` 通过：Vite 2612 modules、Profile 10 项资源；.NET Release 0 warning/0 error。
- `pnpm test:e2e` 在 Edge 三档视口 36/36 通过；覆盖精简品牌锁定、主标题层级、无裁切/溢出和更新后的 Win32 视觉基线；未配置网关时没有端口枚举、连接、fetch 或 WebSocket 硬件路径。
- loopback smoke 验证 live、未认证 401、只读 capabilities、COM1/COM4 枚举、offline session 与 SignalR connect/stop，未调用连接端点。

踩坑：
- 设备页在 1366×768 曾让根 document 多出滚动；根因是内部工作区高度/contain 边界不完整，现由 shell 内部滚动并由全量三档 E2E 固化。
- 本机无系统 .NET SDK；使用官方 SDK 10.0.302 的项目本地、gitignored 安装，并由 `global.json` 与 wrapper 保持可复现。
- 自动 smoke 重跑命令被本机策略在启动前拒绝；未将该尝试写成成功，也未因此打开 COM4。
- 最初的协议帧记录将所有非 error 方向统一标成 `measured`；通过先失败的 C# 回归断言定位到唯一映射点，未在 UI 做补偿。
- `dotnet.ps1` 原先使用 `[CmdletBinding()]`，导致 `--info` 与 `InformationAction/InformationVariable` 发生模糊匹配；改为直接透传 `$args`，没有为每个 SDK flag 建立重复参数表。
- 首轮以 8 workers 并发加载三档 WebGL 场景时，2K 用例发生资源竞争超时；旧视觉快照差异符合预期。新基线逐张审阅后，以 4 workers 完整复验 36/36 通过，没有放宽 READY 或快照断言。

待完善：
- 监督下核对 COM4 的三个真实回包、超时/拔线和断开句柄释放；通过前阶段保持 `IN PROGRESS` 且不创建完成提交。
- Windows catalog 目前只保证端口名；硬件 ID 允许为空，实机 handoff 使用操作系统 PnP 身份记录。

新增约定：
- Phase 4 不存在 raw 或状态改变 API；REST 是权威快照，SignalR 只是有界通知；串口故障不自动重连。

## 2026-08-08 - 阶段 3：Dummy 六轴直接关节数字孪生

需求：
- 在不接入串口、动力学、轨迹规划或 IK 的前提下，实现类似 Robot Viewer 的六关节选择与轴约束拖动，并给出可交付的降级和资源生命周期证据。

改动：
- 以 manifest 的稳定关节 ID/URDF 名称和 URDF 原点/局部轴建立六轴绑定；缺失或重复映射失败关闭，不根据 mesh 名称猜测关节。
- 新增模型点选、黄色旋转环、选中链节高亮、滑块/数值/方向键统一草稿；所有入口只修改目标幽灵模型，展示反馈保持独立。
- 拖动采用世界关节轴法向平面的右手规则有符号角，近平行视线退化为屏幕切向；操纵器使用高优先级事件层/raycast，避免重叠模型抢占。
- 新增 WebGL 缺失、上下文丢失、URDF/mesh/映射失败和低性能显式降级；低性能模式收敛 DPR、抗锯齿与阴影成本。
- 增加 renderer、controls、model roots、geometry/material/texture 和拖动会话诊断；模型对象按唯一引用释放，浮动工具窗在拖动中卸载也清理窗口监听器。
- 将 `RobotScene`、`JointManipulator`、`robotModel`、能力策略、资源释放和资源计数拆为单一职责模块，并将 3D 场景作为页面内二级动态分包。

验证：
- 六轴 URDF 零位原点、局部轴、manifest 限位、右手方向、目标夹紧和反馈隔离均有单元测试。
- 三档 Edge 验证模型/键盘选择、真实 3D 拖动、零 fetch/XHR/WebSocket、URDF 失败、重复挂载资源计数、布局和视觉基线。
- `pnpm typecheck`、`pnpm test`、`pnpm build` 与 `pnpm test:e2e` 作为阶段退出门；未打开 COM4，未发送任何硬件命令。

踩坑：
- 操纵器与机械臂重叠时，默认按射线距离排序会先触发模型拾取并切换关节；通过独立高优先级事件层和操纵器优先 raycast 修复，而不是扩大不可见点击区域来掩盖问题。
- 3D 动态分包和并行 WebGL worker 增加首载波动；READY 仍由资源完成与真实渲染帧驱动，E2E 使用 30 秒有界状态等待，不使用固定 sleep。

新增约定：
- 3D 交互只能写目标草稿；未来网关下发仍必须经过独立的显式整组命令与安全状态机。

## 2026-08-08 - 阶段 2：工业 UI 系统与信息架构

需求：
- 修正展示前端的字体、比例、密度和三档视口表现，在不扩大硬件权限的前提下形成可交付的工业控制台信息架构。

改动：
- 建立石墨深色 token、Windows 本地字体栈、分级字号/间距和可见焦点规范，统一数值对齐、禁用态与低噪声语义色。
- 重排标题栏、导航、状态带、数字孪生控制区和底部数据区；1366×768 使用紧凑布局，1920×1080 为基准，2560×1440 完整利用画布。
- 禁用按钮的原因容器可通过键盘聚焦，设备选择、桌面窗口、软件急停和硬件命令继续诚实显示不可用原因。
- 增加 `/actions` 动作编排入口，但明确标记 `PHASE 6 PLANNED / NO EXECUTION PATH`，创建、导入和运行均不可用。
- Playwright 扩展为五工作区、三档视口 21 项检查，并提交三张 Win32 数字孪生视觉基线。
- Three.js 阴影配置改用受支持的 `PCFShadowMap` 映射，移除项目自身触发的软阴影弃用警告。
- 修正 URDF 回调早于异步 STL 完成导致的伪 `URDF READY`：所有 visual/collision mesh 收束后才克隆目标模型，并在两个真实渲染帧后上报 READY；取消或失败路径仍由 LoadingManager 完成迟到资源释放。

验证：
- `pnpm typecheck`、`pnpm test`、`pnpm build` 和 `pnpm test:e2e` 全部通过。
- 共享契约 77 项、前端 36 项，共 113 项单元测试通过；Edge 三档视口 21 项 E2E 通过。
- 五个工作区均显示 `SHOWCASE DATA / SERIAL OFFLINE`，真实硬件操作保持禁用；未打开 COM4。

踩坑：
- 本机 5173 被非权威旧服务占用，D 盘权威工程改用临时 5174 做人工复核；仓库默认端口约定未改变。
- 页面高度修复后必须先重建再刷新视觉基线，否则复用旧 `dist` 会造成 2K 底部空白的假象。
- `urdf-loader` 的 URDF 根回调不代表 STL 已完成，不能据此克隆目标模型或上报 READY；三档并行 WebGL 验收改用明确状态的 15 秒有界超时，不使用固定 sleep。
- Three.js r185 会对 React Three Fiber 9.7 内部的 `THREE.Clock` 发出上游弃用警告；当前无控制台错误，后续依赖兼容升级时消除，不通过过滤日志规避。

新增约定：
- 动作编排路由在阶段 6 前只承担产品信息架构，不得获得保存或执行路径。

## 2026-08-08 - 阶段 1：Dummy 协议、契约与安全状态机

需求：
- 以固定 `dummy_ref` 提交为证据，将 Dummy 六轴协议收敛为工业可审计的共享契约，不访问 COM4。

改动：
- 将 `shared/contracts` 建为 `@aethor/contracts` workspace，前端删除重复类型并改为消费共享类型。
- 新增模式 1–3 公共白名单、`>` 六轴 formatter、response parser、255 字符有界行解码、命令/会话纯状态机和有界 fake transport。
- JSON Schema 新增 `unconfirmed`、UTC 结果时间、完整 Profile capabilities、模式 1–3 限制和 `OperationEvent`；Dummy manifest 同步为明确能力数组。
- 新增跨语言 conformance vectors 与 ADR-0002；前端离线校验不再接受 RGB、模式 4/5、标定、PID、reboot、`&`、`@` 或通用 `$`。
- 固化源码差异：运动 FIFO 单项 64 bytes；固件有效行上限实际为 255；`$0...` 成功路径没有 ACK，只能作为未来停止链内部 best-effort 写入。

验证：
- `pnpm typecheck`：共享契约与前端均通过。
- `pnpm test`：共享契约 77 项、前端 33 项通过。
- `pnpm build`：通过，Dummy Profile 10 项资源复制成功。
- `pnpm test:e2e`：Edge 三档视口 12 项通过，离线发送保持禁用，模式 5 显示 INVALID。
- 未打开 COM4，未发送查询、使能、停止或运动命令。

待完善：
- C# DTO 生成和 adapter 对 vectors 的复用在 Phase 4 落地；速度上限、反馈收敛容差、HOME/RESET 完成语义仍待后续监督验收。

新增约定：
- 设备 FIFO 数字或 `ok` 只增加命令 evidence，不直接等于物理完成；终态不能被迟到 ACK 覆盖。

## 2026-08-08 - 阶段 0：工程治理与本地 Git 流程

需求：
- 所有 V2 工程文件只保存在 D 盘权威仓库；建立可交接的系统工程、计划、handoff 和 Git 流程。

改动：
- 新增根 `AGENTS.md`、项目内 `aethor-studio-workflow` skill 和阶段制工程工作流文档。
- 新增 `.gitattributes`、`.editorconfig` 与 `.gitmessage`，统一文本、编辑和提交约定。
- 明确完成阶段自动创建本地 commit，但绝不自动 push；远端推送由用户手动执行。
- 保留规范的 `apps/services/shared/docs` 结构，只借鉴 `Aethor_Studio` 的分层边界，不恢复旧目录。
- 清理阶段 0 迁移留在仓库外的 `node_modules` 备份和 skill 生成临时文件，均移入 Windows 回收站。

验证：
- Git 远端为 `StephenGu010/Aethor_StudioV2.git`，当前分支为 `main`。
- 项目 skill 通过官方 `quick_validate.py`，界面 YAML 可解析。
- Node.js 24.14.0 / pnpm 11.16.0 下 typecheck、23 项单元测试和生产构建通过。
- 指定 `Aether_matlabv3` 参考仓库因网络/公开访问不可用，未臆造其内容。
- 本次只修改工程治理文件和文档，未改产品代码、未打开 COM4、未发送硬件命令。

## 2026-08-08 - Dummy 分阶段路线图与交接体系

需求：
- 完成 Dummy 六轴平台分阶段实施计划，使工程可安全交接并收敛目录结构。

改动：
- 将 `D:\Aethor_robot\Aethor_StudioV2` 确立为权威工作副本；C 盘旧副本仅保留回退。
- 新增阶段 0–8 路线图、逐阶段执行提示词、验收矩阵、handoff 模板与进行中的阶段 0 交接。
- 接受 `apps/services/shared/docs` 目标目录 ADR；实际代码移动和 D 盘测试复验仍属于阶段 0 未完成工作。
- 将首版范围收敛为 `dummy-6dof`、模式 1–3、手动 COM4、显式整组关节下发和版本化动作 JSON。
- 根据指定固件提交补充停止、队列、模式和 ACK 的真实语义。

验证：
- 本次文档整理未打开串口，也未发送查询、使能、停止或运动命令。
- D 盘 TypeScript strict、23 项 Vitest、生产构建和 Edge 三档视口 9 项 Playwright 均通过；目录迁移后的再次复验仍属于阶段 0 退出门槛。

## 2026-08-08 - 阶段 0：目录治理完成

需求：
- 将扁平原型目录迁移为规范的应用、服务与共享资产边界，并提供根级可复现命令。

改动：
- 完成 `apps/studio-web`、`apps/studio-desktop`、`services/robot-gateway`、`shared/contracts`、`shared/robot-profiles` 迁移。
- 新增根 pnpm workspace、统一脚本和唯一锁文件；移除旧路径和子项目 workspace 配置。
- 修正 Vite/Vitest/TypeScript 的 Profile 路径，并同步 README、架构、路线图与阶段 handoff。
- 修正生产构建中 Dummy Profile 的重复目录层级，并新增 URDF/7 个 STL 的公开 URL 回归测试。

验证：
- `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm test:e2e` 全部通过。
- 23 项单元测试和 Edge 三档视口 12 项 E2E 通过；生产构建复制 10 项 Dummy Profile 资源。
- 旧顶层目录与重复锁文件不存在；未打开 COM4，未发送硬件命令。

踩坑：
- 机械移动后的旧 pnpm junction 仍指向迁移前位置；已将旧生成目录移出仓库并从根锁文件干净安装，源码未受影响。
- 静态复制目标原先重复包含 `dummy-6dof`，页面状态测试未覆盖真实资源 URL；现由生产预览 E2E 直接请求 URDF/STL 防止回归。

新增约定：
- 所有前端命令从仓库根执行；不再接受 `Frontend/Contracts/RobotProfiles/Backend/Desktop` 兼容副本。

## 2026-08-07 - 前端优先平台骨架

需求：
- 建立展示级 Windows 机械臂调试平台，先完成四个前端工作区并预留 C#/WebView2 边界。

改动：
- 新增 React/Vite 工程、版本化契约、Dummy 受管 Profile、架构与协议文档。
- 明确静态展示数据与真实设备状态隔离。
- 实现数字孪生、数据示波、串口终端、设备与模型四个工作区，并按工作区拆分 Three.js 与 ECharts 资源。
- 将 `URDFDummy4.urdf` 与 7 个 STL 规范化为 `dummy.urdf`、`base_link/link_1…6`、`joint_1…6` 和小写 mesh 路径。
- 增加 `.aethor-robot` 前端校验、共享 JSON Schema、只读 `StaticShowcaseSource` 与不可用 `DesktopBridgeV1`。

验证：
- `node node_modules/typescript/bin/tsc -b --pretty false`：通过。
- `node node_modules/vitest/vitest.mjs run`：7 个测试文件、23 项测试通过。
- `node node_modules/@playwright/test/cli.js test`：Edge 下 3 个视口、9 项 E2E 通过。
- `node node_modules/vite/bin/vite.js build`：通过；发布包包含 `dummy.urdf` 与 7 个 STL。
- 内置浏览器逐页检查四个路由；Dummy URDF 显示 `URDF READY`，中文、图表和离线安全状态正常。

踩坑：
- Safety First 与 `dummy_ref` 对 RGB 协议描述冲突；V2 固定以指定 `dummy_ref` 提交为准。
- 原 URDF 第四关节为 `Join4` 且 velocity/effort 为零，迁移时只修正名称，不推断动态上限。

待完善：
- C# 串口服务、SignalR 实时通道、WebView2 原生桥接和第二台机械臂 Profile。

新增约定：
- 展示数据不得生成任何真实连接、使能、命令接受或急停成功状态。
