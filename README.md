# Aethor Studio V2

面向 Windows 的 Dummy 六轴机械臂调试与数字孪生工作台。当前仓库已实现 React 前端、共享协议/状态契约、内置模型和 .NET 10 只读串口网关；WebView2 壳以及动作编排编辑/执行器仍在后续阶段。Phase 4 软件门已完成，但真实 COM4 读取尚未通过现场监督验收。

## 当前可用

- 数字孪生：Dummy 六轴实体/目标幽灵模型、模型点选、关节轴旋转环拖拽、滑块/数值/键盘统一目标预览和显示/诊断工具窗。
- 数据示波：有限静态采集、信号选择、缩放和 CSV 导出。
- 串口终端：只读示例帧、筛选、导出、会话级专家解锁和离线格式校验。
- 设备与模型：Profile、URDF、关节映射、限位、来源和 `.aethor-robot` 前端校验预览。
- 动作编排：已建立只读信息架构入口，明确标记 `PHASE 6 PLANNED / NO EXECUTION PATH`；当前不能创建、导入、保存或执行动作。
- 工程契约：Dummy 模式 1–3 白名单、有界 ASCII parser/formatter、会话/命令状态机、fake transport 和跨语言 conformance vectors。
- 只读网关：端口枚举、人工连接/断开、`#GETJPOS/#GETMODE/#GETENABLE` 轮询、REST/SignalR、loopback 会话令牌、超时/拔线降级和有界协议历史；没有任何硬件状态改变端点。

所有当前样例数据均标记 `SHOWCASE DATA / SERIAL OFFLINE`，不会伪造连接、使能、设备回包、命令成功或软件急停成功。

## 工程目录

```text
apps/
  studio-web/        React/Vite 前端
  studio-desktop/    WebView2 边界说明（尚无实现）
services/
  robot-gateway/     .NET 10 只读网关与测试
shared/
  contracts/         JSON Schema 与网关契约
  robot-profiles/    内置 dummy-6dof Profile
docs/                路线图、协议、决策、验收与交接
```

仓库根目录拥有 pnpm workspace、统一脚本和唯一锁文件；应用、服务与共享资产不保留旧路径副本。详情见 [架构](docs/architecture.md) 与 [ADR-0001](docs/decisions/0001-repository-layout.md)。

## 开发命令

需要 Node.js 24.x、pnpm 11.16+、.NET SDK 10.0.302 和 Microsoft Edge：

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm dev
```

`pnpm test` 与 `pnpm build` 同时覆盖 Web 和 C#；`pnpm test:web`、`pnpm build:web`、`pnpm gateway:test` 可用于窄验证。开发地址为 `http://127.0.0.1:5173`，生产预览使用 `pnpm preview`（`http://127.0.0.1:4173`）。网关令牌与启动流程见 [Robot Gateway 运行手册](services/robot-gateway/README.md)；启动服务不会自动打开串口。

## 从这里开始

- [文档中心](docs/README.md)
- [阶段制工程与 Git 工作流](docs/engineering-workflow.md)
- [阶段路线图](docs/roadmap.md)
- [产品与安全边界](docs/product-boundaries.md)
- [Dummy ASCII v1](docs/protocols/dummy-ascii-v1.md)
- [当前交接状态](docs/handoffs/phase-04.md)

当前阶段不会自动打开已连接的 COM4。任何实机操作都必须经过对应阶段的监督验收门。

每个阶段在验收和 handoff 完成后创建本地 Git 提交；仓库不会自动 push，远端推送由用户手动执行。
