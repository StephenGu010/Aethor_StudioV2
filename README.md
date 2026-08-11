# Aethor Studio V2

面向 Windows 的多机器人工业调试工作台。当前包含两条严格隔离的产品线：`dummy-6dof` 六轴机械臂拥有经监督验证的 .NET 10 串口网关；`aethor-robo-dual-7dof` 空间机器人拥有两个七轴机械臂的规范化模型与本地控制预览，但固件、协议、反馈和硬件发送路径尚未实现。Phase 5 Gate B 与 Phase 6B 仍被 Dummy 运动包络阻止；Phase 7B 真实长测和 Phase 8B 正式发布门尚未完成。

## 当前可用

- 控制台：默认加载 Aethor_robo 整机模型，只允许分别预览左、右两个七轴机械臂的目标；车轮只参与模型展示。拖拽、滑块、数值和键盘均为本地 FK 预览，读取、下发和软件急停固定禁用，且不会复用 Dummy 指令集。
- 数据示波：无网关时使用明确标记的有限展示采集；配置网关后只接受当前 measured session 的 60–120 秒有界历史，支持信号选择、来源/单位分轴、缩放和长表 CSV。
- 串口终端：命令输入始终可编辑；无网关时只做本地格式校验并显示示例帧。`engineering` 本机网关连接 Dummy 后可发送受 C# 白名单约束的查询、启停/去使能、模式 1–3 和带显式速度的六轴目标；HOME/RESET、RGB、电流、多行和任意字节保持拒绝。TX/RX 只来自网关，不伪造前端记录。
- 设备与模型：Profile、URDF、关节映射、限位、来源、`.aethor-robot` 有界异步校验预览，以及当前会话命令证据的刷新与 JSON 导出；配置包不会在前端安装或持久化。
- 动作编排：当前仍是 Dummy 专属的 `ActionProgramV1` 离线编辑器，支持新建、复制、点位编辑/排序、来源标记、显式本机保存、导入导出和 Dummy 本地目标草稿预览；不会改写 Aethor_robo 控制台状态，且始终标记 `NO EXECUTION PATH / PHASE 6B LOCKED`。
- 工程契约：Dummy 模式 1–3 白名单、有界 ASCII parser/formatter、会话/命令状态机、fake transport 和跨语言 conformance vectors。
- 机器人网关：顶栏和设备页共用 `RobotGatewayV1.2`，支持端口刷新、手动选择、显式连接/断开、三查询轮询、REST/SignalR、loopback 会话令牌、超时/拔线降级、有界协议/命令历史和默认关闭的结构化命令；串口打开默认限时 5 秒。普通打开失败释放临时 transport 后直接回到 offline；打开超时或请求取消还会隔离本进程后续重试，要求重启 Gateway，避免驱动停滞任务累积。已打开会话的 stale/unknown/faulted 仍可人工释放。开发专用 `engineering` 端点只接受规范化 Dummy 白名单，不是任意 raw 串口通道。
- Dummy 实测同步：新硬件 session 的首个可信 `measured + valid` 六轴帧同时建立实体模型反馈和幽灵目标基准；后续反馈只更新实体模型，操作者一旦编辑目标，反馈不得覆盖目标草稿。该对齐不代表原点、关节方向或实机运动已验收。
- 安全控制软件门：结构化命令具备幂等、单在途、停止抢占、双重目标校验、人工确认与明确终态；SignalR 中断会把实测状态立即降为 `STALE`。开发专用六轴直发只有在已连接、反馈新鲜、模式有效且电机已使能时可用；固件 FIFO 应答只显示 `QUEUED`，不表示实机到位。HOME/RESET 因固件阻塞风险继续排除。
- Windows 桌面壳：自定义标题栏、单实例、严格窗口 bridge、随机 loopback 网关/短期令牌、Job Object 回收、有界日志、脱敏诊断包、窗口恢复、自包含 win-x64 便携包与离线 smoke；生产包命令策略保持关闭。

所有当前样例数据均标记 `SHOWCASE DATA / SERIAL OFFLINE`，不会伪造连接、使能、设备回包、命令成功或软件急停成功。

## 工程目录

```text
apps/
  studio-web/        React/Vite 前端
  studio-desktop/    WinForms/WebView2 壳、打包脚本与测试
services/
  robot-gateway/     .NET 10 单一串口/命令网关与测试
shared/
  contracts/         JSON Schema 与网关契约
  robot-profiles/    内置 dummy-6dof 与 aethor-robo-dual-7dof Profile
docs/                路线图、协议、决策、验收与交接
```

仓库根目录拥有 pnpm workspace、统一脚本和唯一锁文件；应用、服务与共享资产不保留旧路径副本。详情见 [架构](docs/architecture.md) 与 [ADR-0001](docs/decisions/0001-repository-layout.md)。

## 开发命令

需要 Node.js 24.x、pnpm 11.16+、.NET SDK 10.0.302 和 Microsoft Edge：

```powershell
pnpm install --frozen-lockfile
pnpm profile:verify
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm dev
```

`pnpm profile:verify` 校验内置 Profile 的可复现迁移记录、URDF 哈希、逐 STL 来源映射以及 URDF/磁盘/溯源清单覆盖一致性；`pnpm test:web` 和 `pnpm build:web` 会自动先执行该门。`pnpm test:e2e` 同样先执行溯源、strict TypeScript 和当前源码的 Vite 生产构建，并使用固定无网关的 `e2e` mode，避免本机 `.env.local` 调试令牌污染零硬件请求验收。`pnpm test` 与 `pnpm build` 同时覆盖 Web、网关和桌面壳；其中 .NET 验证使用仓库内唯一的 `artifacts/validation/dotnet/.run-*` 短期目录并在退出时删除，所以已运行的网关不会因锁定常规 `bin/Release` 而阻断回归。显式 `pnpm gateway:build` / `pnpm desktop:build` 仍生成供本地运行手册使用的常规 Release 输出；`pnpm gateway:test`、`pnpm desktop:test` 可用于窄验证。开发地址为 `http://127.0.0.1:5173`，生产预览使用 `pnpm preview`（`http://127.0.0.1:4173`）。桌面打包与诊断见 [Desktop README](apps/studio-desktop/README.md) 和 [Phase 8A smoke](docs/runbooks/phase-08-desktop-smoke.md)。启动前端、网关或桌面壳都不会自动打开串口。

需要真实调试 Dummy 时，按 [Dummy engineering 直连手册](docs/runbooks/dummy-engineering-direct.md) 启动开发网关。启动仍不会自动连接 COM 口、使能或运动；操作者必须在 UI 中显式选择端口并逐步执行。

## 从这里开始

- [文档中心](docs/README.md)
- [阶段制工程与 Git 工作流](docs/engineering-workflow.md)
- [阶段路线图](docs/roadmap.md)
- [产品与安全边界](docs/product-boundaries.md)
- [Dummy ASCII v1](docs/protocols/dummy-ascii-v1.md)
- [Aethor_robo 双七轴档案与进度](docs/profiles/aethor-robo.md)
- [Aethor_robo 当前交接](docs/handoffs/aethor-robo.md)
- [Phase 5 硬件控制交接](docs/handoffs/phase-05.md)
- [Phase 6 动作编排交接](docs/handoffs/phase-06.md)
- [Phase 7 实时观测交接](docs/handoffs/phase-07.md)
- [Phase 8 Windows 桌面交接](docs/handoffs/phase-08.md)
- [ActionProgram V1](shared/contracts/action-program-v1.md)
- [Phase 4 监督只读 COM4 验收](docs/runbooks/phase-04-supervised-readonly-com4.md)
- [Phase 5 监督式 COM4 控制验收](docs/runbooks/phase-05-supervised-control-com4.md)
- [Dummy engineering 直连调试](docs/runbooks/dummy-engineering-direct.md)
- [Phase 8A 桌面壳验证](docs/runbooks/phase-08-desktop-smoke.md)

当前阶段不会自动打开已连接的 COM4。任何实机操作都必须经过对应阶段的监督验收门。

每个阶段在验收和 handoff 完成后创建阶段 Git 提交，并在 fetch 确认远端未领先或分叉后普通 push 到 `origin` 对应分支；禁止 force-push，未完成阶段不会冒充交付。
