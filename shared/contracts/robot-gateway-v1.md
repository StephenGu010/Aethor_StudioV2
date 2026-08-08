# RobotGatewayV1

## 所有权

未来 C# 服务独占串口、设备连接、命令排队、回包关联和实时反馈。前端只能通过此契约发送意图和消费归一化状态；静态展示源永远不能成为硬件状态源。

## 核心消息

- `RobotSessionSnapshot`：`sessionId/profileId/connectionState/motorState/controlMode/timestampUtc/source/validity`。
- `JointStateFrame`：递增 `sequence`、UTC 时间、`positionsDeg[]`、来源与有效性；数组顺序按 Profile 的 `protocolIndex`。
- `JointGroupCommand`：唯一 `commandId/sessionId/profileId/positionsDeg[]`，可选且经过验证的 `speedDegS`。
- `CommandResult`：`unsupported/rejected/accepted/completed/failed/timedOut/cancelled`，包含安全的用户消息与可选设备回包。
- `ProtocolFrame`：`tx/rx/error`、UTC 时间、原始 ASCII、解析类别和可选 `correlationId`。
- `SignalSample`：信号 ID、UTC 时间、数值、单位、`showcase/measured/commanded/computed/unavailable` 来源与有效性。

## 失败语义

- 缺少后端：命令返回 `unsupported`，不得产生 TX、RX 或设备状态变化。
- 反馈过期：服务将会话标记为 stale；前端禁用运动下发。
- 重复 `commandId`：服务返回同一终态或明确冲突，不重复执行。
- 超时或串口断开：不能显示成功；是否可重试由具体命令的幂等性决定。

## 安全边界

- 运动下发必须满足：会话匹配、Profile 匹配、已连接、反馈新鲜、设备已使能、目标在每个关节限位内、无互斥命令。
- 软件急停不弹确认框。服务执行 `!STOP`、`$0,0,0,0,0,0`、`!DISABLE`，逐步记录结果；任一步失败都必须返回未确认停机。
- 服务仅绑定 loopback，并由桌面壳提供每次启动生成的短生命周期会话令牌。

