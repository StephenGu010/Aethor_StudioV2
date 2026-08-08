# 系统架构

## 当前状态

仓库已经包含可运行的 React/Vite 展示前端、共享 Schema、内置 Dummy Profile，以及 C#/WebView2 的边界说明。真实串口、C# 服务、桌面壳和动作编排尚未实现。阶段 0 已将代码统一为：

```text
apps/
  studio-web/               React、Three.js、ECharts UI
  studio-desktop/           WebView2 壳（后续阶段）
services/
  robot-gateway/            C# .NET 10 服务（后续阶段）
shared/
  contracts/                JSON Schema 与跨进程 DTO
  robot-profiles/
    BuiltIn/dummy-6dof/     URDF、STL、manifest、来源与许可
docs/
```

根目录拥有 pnpm workspace、统一脚本和唯一锁文件。Vite/Vitest/TypeScript 统一从 `shared/robot-profiles/BuiltIn` 读取 Profile；仓库不保留迁移前的兼容目录。

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
