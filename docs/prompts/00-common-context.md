# 公共执行上下文

你正在开发 Windows 平台 `Aethor Studio V2`，首版唯一设备是 `dummy-6dof` 六轴机械臂。D 盘仓库 `D:\Aethor_robot\Aethor_StudioV2` 是权威工作副本；C 盘旧副本只作回退，不得同步写入。

## 开始前

- 先检查 Git 状态、现有实现和上一阶段 handoff，不覆盖用户已有改动。
- 固件与命令证据来自 `D:\Aethor_robot\dummy_ref` 提交 `5b9b602d8013799895c03f288e98ad72f38193be`。
- URDF 源来自 `D:\Aethor_robot\dummy_moveit\dummy_moveit_description`；迁移后稳定 ID 为 `dummy-6dof`，显示名 `Dummy`，adapter ID `dummy-ascii-v1`。
- 当前硬件端口 COM4 不能因此被自动打开。任何实机动作都需用户现场授权和阶段安全门。

## 永久约束

- 前端：React、严格 TypeScript、Vite、Zustand、Zod、R3F/Three.js、ECharts、Radix、Lucide。
- 后端：.NET 10 LTS、C# 分层服务；独占串口，loopback + 桌面会话令牌。
- 页面只依赖 `RobotGatewayV1`；反馈、目标草稿、展示数据和命令状态分离。
- 3D 只做正向运动学；拖动关节不发送；硬件仅接受显式整组下发。
- 首版结构化命令只覆盖模式 1–3 与已批准的核心系统/查询命令。排除 RGB、模式 4/5、电流/PID、标定、reboot、IK、动力学和轨迹规划。
- 不推断 URDF 中缺失的速度、effort 或安全回位姿态。
- 静态数据不得产生连接、使能、回包、命令接受或急停成功状态。
- 软件停止仅在后端明确读回去使能后成功；始终提示不能替代物理急停。

## 交付方式

只做当前阶段范围；更新最小权威文档；运行与风险相称的测试；记录实际命令和结果。最后生成对应 handoff，列出完成、未完成、变更文件、验证证据、风险与下一步。不要写虚假成功，不要提交密钥、机器特定令牌或构建产物。

