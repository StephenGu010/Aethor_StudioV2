# 系统架构

## 当前状态

仓库已经包含可运行的 React/Vite 前端、可执行的共享 TypeScript/JSON Schema 契约、内置 Dummy Profile，以及 Phase 4 的 .NET 10 只读网关。网关的软件门已实现，但 COM4 尚未打开，真实 Dummy 回包仍待现场监督验收；WebView2 壳尚未实现。动作编排已有信息架构入口，但编辑器、文档 Schema 和执行器仍属于阶段 6。当前代码统一为：

```text
apps/
  studio-web/               React、Three.js、ECharts UI
  studio-desktop/           WebView2 壳边界（Phase 8）
services/
  robot-gateway/            C# .NET 10 Domain/Application/Infrastructure/API 与测试
shared/
  contracts/                JSON Schema、TS 类型、协议纯函数、状态机与 conformance vectors
  robot-profiles/
    BuiltIn/dummy-6dof/     URDF、STL、manifest、来源与许可
docs/
```

根目录拥有 pnpm workspace、统一 Web/C# 脚本和唯一 pnpm 锁文件。Vite/Vitest/TypeScript 统一从 `shared/robot-profiles/BuiltIn` 读取 Profile；仓库不保留迁移前的兼容目录。阶段 0–3 已完成工程治理、协议契约、工业 UI 系统和 Dummy 六轴直接关节预览；阶段 4 保持 `IN PROGRESS`，直到监督下只读 COM4 门通过。

## 前端信息架构与视觉系统

- 五个工作区固定为 `/twin`、`/scope`、`/terminal`、`/devices` 和 `/actions`；页面模块按路由懒加载。
- 石墨深色主题、字号、间距、栏宽和语义状态由 `apps/studio-web/src/styles/tokens.css` 统一定义，不依赖在线字体；标题优先使用 Windows 本地 `Segoe UI Variable Display`，正文使用 `Segoe UI Variable Text / Microsoft YaHei UI`，工程状态和数值使用 `Cascadia Mono`。
- 1366×768 使用紧凑密度和工作区内部滚动；1920×1080 为设计基准；2560×1440 提升有效画布与数据密度。
- 顶栏、导航、关键状态、软件急停和主下发区保持可达。禁用操作由可聚焦说明容器暴露原因，浏览器模式不伪造桌面窗口能力。
- `/actions` 当前只声明未来交付边界，所有编辑、导入和执行入口均禁用；它不拥有动作契约或硬件命令路径。

## 数字孪生交互与资源所有权

- `robotModel.ts` 只按 Profile 的 `joint_1…joint_6` 稳定名称绑定 URDF joint；mesh 名称不参与关节推断。关节原点和局部轴来自 URDF 对象变换，目标限位来自已校验 manifest。
- `JointManipulator.tsx` 将选中关节的局部轴变换到世界空间，在轴法向平面计算右手规则有符号角；视线接近平面时退化为屏幕切向投影。黄色旋转环拥有高优先级拾取，避免被重叠模型几何抢占事件。
- 模型点选、旋转环、滑块、数值框和键盘微调共享 `targetPositionsDeg` 草稿；`showcaseJointFrame` 反馈保持只读。任何预览路径都不调用 `RobotGatewayV1`。
- 实体模型与目标模型是独立对象树；目标树共享只读 geometry、拥有独立幽灵 material。卸载时按唯一引用释放 geometry、material 和 texture，OrbitControls、renderer 所有权与活动拖动会话进入可见诊断计数。
- `RobotScene` 是数字孪生页面内的二级动态分包，避免 Three.js/URDF 加载器进入页面主 chunk。WebGL 缺失、上下文丢失、URDF/mesh/映射失败均显示明确降级状态；低性能环境降低 DPR、抗锯齿和阴影成本。

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
- C# 服务独占串口、只读查询循环、超时、取消和协议诊断；Phase 5 的命令仲裁/确认/审计必须扩展同一所有者，不能另建前端命令通道。
- 桌面壳只负责窗口生命周期、进程启动、会话令牌和能力声明，不拥有机器人业务状态。
- Profile 是设备描述和资源来源，不能承载运行时连接状态。
- `shared/contracts` 不拥有串口；其中的 transport 只是端口，fake 只用于无硬件测试。Phase 4 的 C# adapter 才拥有真实 SerialPort 生命周期。

## 运行时状态所有权

| 状态 | 所有者 | 生命周期 |
|---|---|---|
| 连接、使能、模式、最新反馈 | C# `ReadOnlyRobotGateway` | 当前唯一只读设备会话 |
| Phase 5 之后的命令在途与审计 | C# command owner（规划） | 当前设备会话 |
| 目标关节角与动作编辑草稿 | studio-web draft | 当前页面/编辑会话 |
| 页面、筛选、选中信号 | URL | 可分享导航状态 |
| 工具窗布局、显示偏好 | Versioned local storage | 本机用户 |
| 静态展示采集 | StaticShowcaseSource | 仅展示，永不产生在线状态 |
| 动作程序 | Versioned JSON document | 显式保存/导入导出 |

反馈与目标草稿必须独立。拖动滑块或 3D 关节只修改草稿和幽灵模型，不得改写实际反馈，也不得自动向硬件发送。

## 网关边界

`RobotGatewayV1` 有两个实现，页面不直接依赖 HTTP、SignalR 或串口：

- `StaticShowcaseSource`：未配置网关时的安全默认值；不枚举/连接串口，命令返回 `unsupported`，展示数据永不提升为真实状态。
- `HttpRobotGateway`：仅接受 loopback URL 和 32–256 字符令牌；REST 负责能力、枚举、手动只读连接/断开和权威快照，SignalR 负责 session、关节帧和协议帧通知。
- C# API 使用 `ListenLocalhost`，`/api/v1` 与 `/hubs/robot-v1` 校验同一 opaque session token。Development token 不能用于非 Development 环境。
- `ReadOnlyRobotGateway` 独占 transport 和轮询；Phase 4 串口 adapter 只允许 `#GETJPOS/#GETMODE/#GETENABLE`，没有任何状态改变端点。
- REST session/joint state 是权威值；容量 128 的 SignalR 事件队列拥塞时丢弃最旧通知，容量 256 的协议历史限制诊断内存增长。
- 串口打开后先显示 `connected + stale`，完整有效查询循环后才是 `valid`；连续三次查询超时、拔线或 I/O 错误进入 `faulted` 并释放 transport，不自动重连。

前端只有在 `VITE_AETHOR_GATEWAY_URL` 和 `VITE_AETHOR_GATEWAY_SESSION_TOKEN` 同时有效时才创建 `HttpRobotGateway`；否则显式回退为 `BACKEND ABSENT`。Phase 8 的桌面壳才负责生产令牌和进程守护。

## 资源与故障边界

- URDF、mesh 和配置包导入必须拒绝路径穿越、外部 URL、重复关节、DOF 不匹配、缺失资源和非法限位。
- Three.js 场景切换/卸载时释放 geometry、material、texture、controls 和 renderer 资源。
- 串口断开、帧解析失败、反馈过期或查询超时均进入可见降级/故障状态，不能回退成“成功”。轮询取消、手动断开、打开失败、进程退出和 dispose 都收束到唯一 transport 释放路径。
- 软件急停不能替代物理急停；只有后端明确确认去使能后，UI 才能显示完成。

关键目录决策见 [ADR-0001](decisions/0001-repository-layout.md)，协议白名单见 [ADR-0002](decisions/0002-dummy-protocol-boundary.md)，Phase 4 只读进程边界见 [ADR-0003](decisions/0003-readonly-gateway-boundary.md)。
