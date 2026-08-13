# 公共执行上下文

你正在开发 Windows 平台 `Aethor Studio V2`。控制对象包括 `dummy-6dof` 六轴机械臂，以及 `aethor-robo-dual-7dof` 空间机器人上的左、右两个七轴机械臂。D 盘仓库 `D:\Aethor_robot\Aethor_StudioV2` 是权威工作副本；C 盘旧副本只作回退，不得同步写入。

## 开始前

- 先检查 Git 状态、现有实现和上一阶段 handoff，不覆盖用户已有改动。
- 固件与命令证据来自 `D:\Aethor_robot\dummy_ref` 提交 `5b9b602d8013799895c03f288e98ad72f38193be`。
- URDF 源来自 `D:\Aethor_robot\dummy_moveit\dummy_moveit_description`；迁移后稳定 ID 为 `dummy-6dof`，显示名 `Dummy`，adapter ID `dummy-ascii-v1`。
- Aethor_robo 当前源模型来自 `Aethor_Layout_deployed/`；迁移后稳定 ID 为 `aethor-robo-dual-7dof`，显示名 `Aethor_robo`，adapter ID 暂为 `aethor-robo-pending`。它只有本地双七轴预览，硬件 capability 全部为 false，独立动量轮 links/joints/meshes 已排除。
- 当前硬件端口 COM4 不能因此被自动打开。任何实机动作都需用户现场授权和阶段安全门。

## 永久约束

- 前端：React、严格 TypeScript、Vite、Zustand、Zod、R3F/Three.js、ECharts、Radix、Lucide。
- 后端：.NET 10 LTS、C# 分层服务；独占串口，loopback + 桌面会话令牌。
- Dummy 硬件页面只依赖 `RobotGatewayV1`；Aethor_robo 控制台使用独立 14 轴本地 store，不能消费 Dummy gateway。反馈、每个 Profile 的目标草稿、展示数据和命令状态必须分离。
- 3D 只做正向运动学；拖动关节不发送；硬件仅接受显式整组下发。
- Dummy 结构化命令只覆盖模式 1–3 与已批准的核心系统/查询命令。Aethor_robo 在独立协议完成前没有任何结构化命令。排除 RGB、电流/PID、标定、reboot、IK、动力学和轨迹规划。
- 不推断 URDF 中缺失的速度、effort 或安全回位姿态。
- 静态数据不得产生连接、使能、回包、命令接受或急停成功状态。
- 软件停止仅在后端明确读回去使能后成功；始终提示不能替代物理急停。

## 交付方式

只做当前阶段范围；更新最小权威文档；运行与风险相称的测试；记录实际命令和结果。每个阶段 handoff 必须分别写明对 Dummy 与 Aethor_robo 的影响，若不适用也要说明原因。最后列出完成、未完成、变更文件、验证证据、风险与下一步。不要写虚假成功，不要提交密钥、机器特定令牌或构建产物。
