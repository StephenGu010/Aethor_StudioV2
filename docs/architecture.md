# 系统架构

## 当前状态

仓库已经包含可运行的 React/Vite 展示前端、可执行的共享 TypeScript/JSON Schema 契约、内置 Dummy Profile，以及 C#/WebView2 的边界说明。真实串口、C# 服务和桌面壳尚未实现；动作编排已有信息架构入口，但编辑器、文档 Schema 和执行器仍属于阶段 6。阶段 0–2 已将代码统一为：

```text
apps/
  studio-web/               React、Three.js、ECharts UI
  studio-desktop/           WebView2 壳（后续阶段）
services/
  robot-gateway/            C# .NET 10 服务（后续阶段）
shared/
  contracts/                JSON Schema、TS 类型、协议纯函数、状态机与 conformance vectors
  robot-profiles/
    BuiltIn/dummy-6dof/     URDF、STL、manifest、来源与许可
docs/
```

根目录拥有 pnpm workspace、统一脚本和唯一锁文件。Vite/Vitest/TypeScript 统一从 `shared/robot-profiles/BuiltIn` 读取 Profile；仓库不保留迁移前的兼容目录。

## 前端信息架构与视觉系统

- 五个工作区固定为 `/twin`、`/scope`、`/terminal`、`/devices` 和 `/actions`；页面模块按路由懒加载。
- 石墨深色主题、字号、间距、栏宽和语义状态由 `apps/studio-web/src/styles/tokens.css` 统一定义，不依赖在线字体。
- 1366×768 使用紧凑密度和工作区内部滚动；1920×1080 为设计基准；2560×1440 提升有效画布与数据密度。
- 顶栏、导航、关键状态、软件急停和主下发区保持可达。禁用操作由可聚焦说明容器暴露原因，浏览器模式不伪造桌面窗口能力。
- `/actions` 当前只声明未来交付边界，所有编辑、导入和执行入口均禁用；它不拥有动作契约或硬件命令路径。

## 依赖方向

```text
studio-web ──> shared/contracts
     │               ▲
     └─ RobotGatewayV1│
                     │
robot-gateway ───────┘ ──> SerialPort ──> Dummy firmware

studio-desktop ──> DesktopBridgeV1
```

- 页面只依赖 `RobotGatewayV1`，不直接访问 HTTP、SignalR 或串口。
- C# 服务独占串口、命令队列、超时、取消、确认和审计状态。
- 桌面壳只负责窗口生命周期、进程启动、会话令牌和能力声明，不拥有机器人业务状态。
- Profile 是设备描述和资源来源，不能承载运行时连接状态。
- `shared/contracts` 不拥有串口；其中的 transport 只是端口，fake 只用于无硬件测试。Phase 4 的 C# adapter 才拥有真实 SerialPort 生命周期。

## 运行时状态所有权

| 状态 | 所有者 | 生命周期 |
|---|---|---|
| 连接、使能、模式、最新反馈、命令在途 | Robot session | 当前设备会话 |
| 目标关节角与动作编辑草稿 | studio-web draft | 当前页面/编辑会话 |
| 页面、筛选、选中信号 | URL | 可分享导航状态 |
| 工具窗布局、显示偏好 | Versioned local storage | 本机用户 |
| 静态展示采集 | StaticShowcaseSource | 仅展示，永不产生在线状态 |
| 动作程序 | Versioned JSON document | 显式保存/导入导出 |

反馈与目标草稿必须独立。拖动滑块或 3D 关节只修改草稿和幽灵模型，不得改写实际反馈，也不得自动向硬件发送。

## 网关边界

`RobotGatewayV1` 当前由只读 `StaticShowcaseSource` 实现；所有命令返回“不支持/后端未连接”。后续适配保持页面 API 不变：

- REST：低频命令、设备枚举、连接和配置校验。
- SignalR：遥测、协议帧、命令状态和故障事件。
- Loopback-only 监听，并校验桌面壳创建的会话令牌。
- 所有可改变硬件状态的调用必须有命令 ID、设备会话 ID、超时和明确结果。

## 资源与故障边界

- URDF、mesh 和配置包导入必须拒绝路径穿越、外部 URL、重复关节、DOF 不匹配、缺失资源和非法限位。
- Three.js 场景切换/卸载时释放 geometry、material、texture、controls 和 renderer 资源。
- 串口断开、帧解析失败、反馈过期或命令超时均进入可见故障状态，不能回退成“成功”。
- 软件急停不能替代物理急停；只有后端明确确认去使能后，UI 才能显示完成。

关键目录决策见 [ADR-0001](decisions/0001-repository-layout.md)。
