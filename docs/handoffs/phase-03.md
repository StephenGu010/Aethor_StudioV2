# 阶段 3 交接

- 状态：`DONE`
- 日期：2026-08-08
- 实施者：Codex
- 仓库/分支：`Aethor_StudioV2 / main`
- 开始基线提交：`b6d18e00340988f7cdf26404293ea7c7fc0cd3a4`
- 最终提交主题：`phase(03): deliver direct joint manipulation`（精确 SHA 由最终响应和 `git log -1` 提供）

## 本阶段目标

完成 Dummy 六轴关节选择与关节轴约束拖动，只做 URDF/FK 目标预览；不实现末端 IK、动力学、轨迹规划、动作执行、C# 网关或任何 COM4 访问。

## 已完成

- 模型实体/幽灵点选、六关节稳定映射、选中链节高亮和黄色旋转环/轴向提示。
- 旋转环、滑块、数值框、方向键 ±0.1° 与 Shift ±1° 共用目标草稿并执行 manifest 限位。
- 拖动按 URDF 局部轴的世界变换计算右手规则角度，近平行视线使用屏幕切向退化；拖动时 OrbitControls 暂停。
- 操纵器拥有高优先级事件层和 raycast，解决环与机械臂重叠时模型拾取抢占的问题。
- 明确的 WebGL、上下文、URDF/mesh/映射失败和低性能降级；错误时右侧本地数值控件仍可用且硬件命令禁用。
- 模型、renderer、controls、geometry/material/texture、活动拖动会话的所有权诊断与卸载清理；工具窗活动拖动监听器也可在卸载时收束。
- `RobotScene`、`JointManipulator`、`robotModel`、能力和资源模块完成职责拆分；Three/URDF 场景为页面内动态分包。

## 六轴映射证据

| Profile | URDF joint | 协议索引 | URDF origin xyz / rpy | 设备角限位 (deg) | 模型换算 |
|---|---|---:|---|---:|---|
| `j1` | `joint_1` | 0 | `0 0 0.087` / `0 0 0` | -170…170 | `model=device` |
| `j2` | `joint_2` | 1 | `0.035 0 0.0375` / `1.5708 0 -3.1416` | -75…90 | `model=device` |
| `j3` | `joint_3` | 2 | `0 0.146 0` / `0 0 1.5708` | 0…180 | `model=device-90°` |
| `j4` | `joint_4` | 3 | `0.052 0 0` / `-1.5708 0 0` | -180…180 | `model=device` |
| `j5` | `joint_5` | 4 | `0 0 0.117` / `1.5708 0 0` | -120…120 | `model=device` |
| `j6` | `joint_6` | 5 | `0 0.0625 0` / `-1.5708 0 0` | -720…720 | `model=device` |

权威值仍来自 `shared/robot-profiles/BuiltIn/dummy-6dof/model/dummy.urdf` 与 `manifest.json`；表格是交接索引，不是新的配置源。设备角限位来自固定固件提交，URDF 的 effort/velocity 仍为零且未验证，未被推断为硬件动态上限。

## 未完成与下一步

- Phase 4 才建立 .NET 10 网关、loopback REST/SignalR、会话令牌和只读串口生命周期。
- COM4 只允许在用户重新进行现场安全确认后手动连接；Phase 4 仅查询 `#GETJPOS`、`#GETMODE`、`#GETENABLE`，不得发送状态改变或运动命令。
- Phase 5 才处理使能、停止、回零、复位、模式和整组关节下发；Phase 6 才实现动作 JSON 与执行器。
- 第二台七自由度机械臂仍没有 Profile/模型，本阶段没有虚构其配置。

## 关键决策

| 决策 | 原因 | 影响 |
|---|---|---|
| URDF joint 名称是模型绑定键，mesh 名称不参与 | mesh 层级和命名不是稳定运动学契约 | 缺失映射直接报错，不会操作错误关节 |
| 拖动角由世界关节轴和法向平面计算 | 保持任意相机下的右手规则方向 | 视线近平行时使用有界屏幕切向退化 |
| 操纵器事件优先于模型拾取 | J1 环与实体几何重叠会导致关节被切换 | 高优先级事件层与 raycast 固化为回归测试 |
| 目标/反馈继续使用独立对象与 store | 预览不等于设备状态或硬件命令 | 拖动、键盘和数值输入的硬件请求计数均为零 |
| 资源计数是应用所有权证据，不宣称 GPU 驱动内部计数 | 浏览器不能可靠暴露驱动对象总量 | 与唯一 dispose 测试、重复挂载 E2E 组合使用 |

## 变更范围

- 代码/测试：`apps/studio-web/src/components/visualization`、`components/workbench`、`domain`、`pages/digital-twin`、stores、styles 与 Playwright。
- 文档：README、架构、路线图、验收矩阵、变更记录和本 handoff。
- 契约/模型资源：未修改共享网关/协议 Schema，未修改 Dummy URDF/STL/manifest。

## 验证证据

| 检查 | 命令/环境 | 预期结果 | 证据路径 |
|---|---|---|---|
| 类型与单元/组件测试 | `pnpm typecheck && pnpm test` | 共享 77 + 前端 54，共 131 项通过 | `shared/contracts/src/**/*.test.ts`、`apps/studio-web/src/**/*.test.*` |
| 生产构建 | `pnpm build` | 无 chunk 超限警告；RobotScene 独立分包；10 项 Profile 资源复制 | `apps/studio-web/dist`（生成物不提交） |
| 三档 E2E | `pnpm test:e2e` / Edge | 3 个项目、33 项通过 | `apps/studio-web/tests/e2e/workspaces.spec.ts` |
| 真实 3D 拖动 | 1366/1920/2560 | J1 目标变化、J1 反馈不变、仍选中 J1、硬件请求 0、拖动会话回到 0 | `drags the selected 3D joint preview...` |
| 六轴运动学静态契约 | Vitest + 原始 URDF | 六个 origin/axis/limit 与 Profile 一致 | `apps/studio-web/src/domain/urdfKinematics.test.ts` |
| 资源生命周期 | 唯一 dispose 单测 + 三次 SPA 切换 E2E | renderer/controls `1/1`、model roots `2`、drag `0`；共享资源只 dispose 一次 | `sceneResources.test.ts`、资源挂载 E2E |
| 故障降级 | WebGL 组件测试 + URDF abort E2E | 明确 `3D VIEW UNAVAILABLE` / `URDF LOAD FAILED`，硬件下发保持禁用 | `RobotScene.test.tsx`、URDF failure E2E |
| 视觉验收 | Win32 Edge 三档截图 | 选中态、HUD、操纵器与控制区无关键裁切/重叠 | `apps/studio-web/tests/e2e/workspaces.spec.ts-snapshots/` |

## 硬件操作

- 是否打开串口：否。
- 是否发送状态改变/运动命令：否；自动化记录 fetch/XHR/WebSocket 为 0。
- 操作者与物理急停条件：不适用；本阶段明确禁止访问 COM4。

## 已知风险与限制

- 仅实现 FK 关节目标预览；不做末端拖拽、IK、碰撞求解、动力学、轨迹残影或规划。
- 目标高亮覆盖选中关节拥有的直接链节，幽灵模型与实体接近时仍可能视觉重叠；可通过目标值或显示设置分离查看。
- `THREE.Clock` 上游弃用警告仍来自 React Three Fiber 9.7/Three.js r185 组合；项目未过滤它，后续兼容升级需重新跑资源与视觉门禁。
- WebGL 驱动实际释放由 R3F/浏览器完成；当前证据覆盖应用所有权释放和 R3F 卸载路径，不冒充驱动级显存遥测。

## 下一阶段启动清单

- [ ] 阅读公共上下文、路线图、本 handoff、ADR-0002、Dummy ASCII v1 和 Phase 4 提示词。
- [ ] 检查 Git 状态并复现 131 项单元/组件、生产构建和 33 项 E2E。
- [ ] 先用 fake serial 完成 .NET 分层、并发/拔线/取消/超时和 loopback 认证，不先连接 COM4。
- [ ] 在任何 COM4 操作前重新记录操作者、净空、物理急停、供电、姿态和只读命令范围。
- [ ] 保持 Phase 4 严格只读；禁止使能、停止、回零、复位、模式或运动命令。
- [ ] 确认 Phase 3 本地提交存在，且任何远端 push 均由用户执行。
