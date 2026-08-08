# RobotGatewayV1

## 版本与所有权

Wire contract 版本为 `1.0`，JSON 使用 camelCase，枚举使用 Schema 中的小写字符串，时间使用 UTC ISO 8601。JSON Schema 是跨语言 wire contract 的权威来源；C# 内部类型和 `SerialPort` 类型不得直接暴露给前端。

Phase 4 的 C# 服务独占串口、轮询任务、session、最新反馈和协议历史。前端只通过 `RobotGatewayV1` 发送连接意图并消费归一化状态；`StaticShowcaseSource` 永远不能成为硬件状态源。REST 快照是权威状态，SignalR 仅是有界的低延迟通知通道。

## Phase 4 消息

- `SerialPortDescriptor`：`portName` 与可空 `hardwareId/displayName`。端口存在不等于已连接；当前 Windows adapter 保证端口名，硬件 ID 允许为空。
- `ReadOnlyConnectRequest`：`portName/profileId`；Phase 4 只接受 `dummy-6dof` 和当前枚举到的合法 Windows COM 名称。
- `ReadOnlyGatewayCapabilities`：contract/adapter 版本、端口枚举、只读连接、实时遥测和命令能力。Phase 4 的 `hardwareCommands` 固定为 `false`。
- `RobotSessionSnapshot`：`sessionId/profileId/connectionState/motorState/controlMode/timestampUtc/source/validity`。
- `JointStateFrame`：递增 `sequence`、UTC 时间、六个 `positionsDeg`、来源与有效性；顺序按 Profile `protocolIndex`。
- `ProtocolFrame`：`tx/rx/error`、UTC 时间、有界原始 ASCII、解析类别、来源和可选 `correlationId`。来源与方向固定映射为 `tx → commanded`、`rx → measured`、`error → unavailable`，不得把网关发出的查询标成设备测量值。

Phase 4 capabilities 只允许以下查询，顺序轮询：

```text
#GETJPOS
#GETMODE
#GETENABLE
```

串口写入 adapter 对编码后的完整 payload 再做一次精确白名单校验；其他字节序列不能通过公共 API 或内部 transport 写出。

## REST

所有 `/api/v1/*` 请求必须携带 `X-Aethor-Session`。健康检查不需要认证。

| Method | Path | Request | Response | 说明 |
|---|---|---|---|---|
| `GET` | `/health/live` | — | process/contract 状态 | 仅表示进程存活 |
| `GET` | `/health/ready` | — | `ready`, `serialRequired=false` | 不表示设备已连接 |
| `GET` | `/api/v1/gateway/capabilities` | — | `ReadOnlyGatewayCapabilities` | 当前能力声明 |
| `GET` | `/api/v1/serial/ports` | — | `SerialPortDescriptor[]` | 只枚举，不打开端口 |
| `GET` | `/api/v1/session` | — | `RobotSessionSnapshot` | 权威 session 快照 |
| `GET` | `/api/v1/joint-state` | — | `JointStateFrame` | 权威最新关节帧；不可用时 validity/source 明确降级 |
| `GET` | `/api/v1/protocol-frames?limit=N` | — | `ProtocolFrame[]` | `N` 为 1–500；历史容量默认 256 |
| `POST` | `/api/v1/session/connect` | `ReadOnlyConnectRequest` | `RobotSessionSnapshot` | 手动打开唯一串口会话并启动只读轮询 |
| `POST` | `/api/v1/session/disconnect` | — | `RobotSessionSnapshot` | 取消轮询并释放 transport；重复调用安全 |

Phase 4 不存在 raw、运动、使能、停止、模式、回零或复位端点。前端对应方法必须在本地返回 `unsupported`，不得试探未声明 URL。

### HTTP 失败

- `401`：会话令牌缺失或错误。
- `400`：非法 Profile、COM 名称、未枚举端口或协议历史 limit。
- `409`：另一个 session 正在连接、已连接或正在断开；不会创建第二个串口所有者。
- `503`：端口枚举失败、端口占用/拒绝访问或串口打开失败。
- 请求取消不会转换为成功或自动重试。前端 REST 请求默认 5 s 超时，连接失败后保留人工重试入口。

## SignalR

- Hub：`/hubs/robot-v1`。
- 认证：`Authorization: Bearer <token>`；SignalR WebSocket transport 可按客户端约定使用 `access_token` query 参数。
- Server-to-client events：
  - `sessionSnapshot(RobotSessionSnapshot)`
  - `jointStateFrame(JointStateFrame)`
  - `protocolFrame(ProtocolFrame)`
- 没有 client-to-server hub method。

服务端事件队列默认容量 128，拥塞时丢弃最旧事件，REST 状态不受影响。前端自动重连等待为 0/1/3 秒；重连耗尽后显示遥测断开，不能继续把旧值显示成新鲜反馈。

## 串口与状态语义

- 串口参数固定为 115200、8-N-1、ASCII、LF、无 handshake、DTR/RTS 关闭。
- 打开串口后 session 可进入 `connected + stale`，表示 transport 已打开但尚未完成有效状态循环；这不是反馈已确认。
- 每个查询默认 2 s 超时。任一超时将已有反馈降为 `stale`；连续三次查询超时、拔线或 I/O 故障将 session 置为 `faulted`、反馈置为 `unavailable` 并释放 transport。
- 网关不会自动重连；恢复必须由操作者重新选择并连接。
- 未知、畸形、非 ASCII、超长和半帧保留为有界诊断，不得被当作成功响应。

## 后续命令契约

Schema 已定义但 Phase 4 尚未提供网络端点的类型包括：

- `JointGroupCommand`：唯一 `commandId/sessionId/profileId/positionsDeg[]`，可选且经过验证的 `speedDegS`。
- `CommandResult`：`unsupported/rejected/accepted/completed/failed/timedOut/cancelled/unconfirmed`，含 UTC 时间、安全消息与可选设备证据。
- `SignalDescriptor/SignalSample`：信号 ID、时间、值、单位、来源与有效性。

Phase 5 后任何运动下发仍必须满足会话/Profile 匹配、连接有效、反馈新鲜、设备已使能、六轴目标合法且无互斥命令。设备 FIFO 数字或通用 `ok` 只能增加 evidence，不能单独证明物理运动完成。

规划中的软件停止链仍为 `!STOP → internal best-effort $0,0,0,0,0,0 → !DISABLE → #GETENABLE`；它在 Phase 4 不可调用，未来也只有最终读回去使能为 `0` 才能显示完成。软件停止不能替代物理急停。
