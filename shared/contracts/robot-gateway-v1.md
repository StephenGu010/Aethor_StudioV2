# RobotGatewayV1

## 版本、所有权与安全默认值

当前 wire contract 版本为 `1.3`，只服务 `dummy-6dof`。JSON 使用 camelCase、Schema 中的小写枚举和 UTC ISO 8601 时间；[`gateway-contracts-v1.schema.json`](gateway-contracts-v1.schema.json) 是跨语言 wire contract 的权威来源。`aethor-robo-dual-7dof` 尚无硬件网关契约，不能通过该接口连接或下发。

C# `RobotGateway` 是唯一的串口、轮询、命令仲裁、最新快照和有界历史所有者。前端只依赖 `RobotGatewayV1` 端口，不直接访问串口；REST 是权威快照，SignalR 是可丢中间通知的有界通道。`StaticShowcaseSource` 永远不能产生真实连接、使能或命令成功状态。

硬件命令默认关闭。主机策略为：

- `disabled`：默认值，`hardwareCommands=false/directCommand=false`；
- `supervised`：只允许 desktop token，公开 `supportedCommands` 中的结构化命令；
- `engineering`：只允许 Development 环境和 development token，结构化启停/模式仍可用，并额外声明 `directCommand=true` 与 `engineeringJointSpeedMaxDegS=100`。

服务没有任意 raw 串口端点。engineering direct 只接受规范化 Dummy 单行白名单，不能发送 HOME/RESET、RGB、电流、模式 4/5 或任意字节；100 deg/s 仅是固件输入上界，不是安全速度证据。

## 核心消息

- `SerialPortDescriptor`：端口名和可空 `hardwareId/displayName`；枚举存在不等于已连接。
- `RobotConnectRequest`：`portName/profileId`；当前只接受 `dummy-6dof` 和本次枚举到的合法 COM 名称。
- `RobotGatewayCapabilities`：contract/adapter 版本、查询能力、命令策略、支持命令和可空的完整关节组运动包络。
- `JointGroupCompletionPolicyV1`：到位容差、连续稳定窗口和总到位超时；与关节速度上限必须同时配置。
- `RobotSessionSnapshot`：session、连接、使能、模式、来源与有效性。
- `JointStateFrame`：递增序号、六个角度、UTC 时间、来源与有效性，顺序按 Profile `protocolIndex`。
- `ProtocolFrame`：有界 ASCII、方向、解析类别、来源和可选 correlation ID。
- `CommandResult`：命令终态、稳定 code、evidence、面向操作者的信息和可选设备回包。C# JSON 边界会把无回包序列化为显式 `null`，客户端必须同时接受字段缺失、字符串和 `null`，不能因此丢弃整条命令审计。
- `RobotCommandRequestSnapshot`：命令种类、SHA-256 请求指纹和有界参数快照；关节数组最多保留前六项，同时记录原数量和截断标志。
- `CommandAuditRecord`：命令身份、接收时间、请求快照、实际成功写入 transport 的 payload 和当前/最终结果；默认最多保留 128 项。
- `DirectCommandRequest/DirectCommandResult`：开发调试的一行白名单命令；六轴运动使用 `sent + transportWritten`，其他命令使用 `replied/rejected/timedOut/failed`。`sent` 只表示 transport 写入完成。

## REST

所有 `/api/v1/*` 请求必须携带 `X-Aethor-Session`；健康检查无需认证。串口目录、显式连接和显式断开请求另携带 UUID `X-Aethor-Operation`，只用于关联有界诊断，不能授权连接、断开或命令；非法/缺失值由网关 trace id 代替。连接/断开在前端由同一 gateway 的 single-flight owner 仲裁：相同意图共享一个请求，不同意图在现有动作终态前失败关闭。命令端点对协议级拒绝或不支持返回 HTTP 200 和明确 `CommandResult`，网络/认证错误仍使用 HTTP 状态码。

| Method | Path | Request | Response |
|---|---|---|---|
| `GET` | `/health/live` | — | 进程和 contract 版本 |
| `GET` | `/health/ready` | — | `ready`；不代表设备在线 |
| `GET` | `/api/v1/gateway/capabilities` | — | `RobotGatewayCapabilities` |
| `GET` | `/api/v1/serial/ports` | — | `SerialPortDescriptor[]`；不打开端口 |
| `GET` | `/api/v1/session` | — | 权威 session 快照 |
| `GET` | `/api/v1/joint-state` | — | 权威最新关节帧 |
| `GET` | `/api/v1/protocol-frames?limit=N` | — | 1–500 条协议帧 |
| `GET` | `/api/v1/commands?limit=N` | — | 1–500 条命令审计 |
| `GET` | `/api/v1/commands/{commandId}` | — | 单条命令审计或 404 |
| `POST` | `/api/v1/session/connect` | `RobotConnectRequest` | 人工打开唯一设备会话 |
| `POST` | `/api/v1/session/disconnect` | — | 释放会话；命令在途或电机已确认 enabled 时拒绝，stale/unknown 错误端口可释放 |
| `POST` | `/api/v1/commands/enable` | `SimpleRobotCommand` | `CommandResult` |
| `POST` | `/api/v1/commands/stop-and-disable` | `SimpleRobotCommand` | `CommandResult` |
| `POST` | `/api/v1/commands/home` | `SimpleRobotCommand` | 当前生产配置返回 `unsupported` |
| `POST` | `/api/v1/commands/reset` | `SimpleRobotCommand` | 当前生产配置返回 `unsupported` |
| `POST` | `/api/v1/commands/set-mode` | `SetModeCommand` | 仅模式 1–3 |
| `POST` | `/api/v1/commands/joint-group` | `JointGroupCommand` | 只有配置完整四参数运动包络后才支持 |
| `POST` | `/api/v1/engineering/direct-command` | `DirectCommandRequest` | 仅 engineering；返回 `DirectCommandResult` |

连接、端口枚举和 query 参数错误使用 400/409/503；认证失败使用 401。请求取消不会被改写为成功或自动重试。请求在网关接管前已取消时不得创建审计条目或写串口；写入命令审计条目是接管线性化点，接管后的 HTTP 取消只终止当前调用方等待，网关仍须把唯一物理执行收束为可查询终态。

## 命令仲裁与证据

- 同一时刻只允许一个硬件命令。停止并去使能可以取消正在等待/执行的普通命令；被取消命令保持 `cancelled`，不能被迟到 ACK 改写。
- `commandId + 完整规范化 payload` 是幂等键。同 ID 同 payload 共享一次物理执行；同 ID 不同 payload 返回 `commandIdConflict`。
- 命令审计在 transport 写成功后记录实际 payload，最多 32 条、每条最多 255 个 ASCII 字符，并以 `transmissionLogTruncated` 表示截断。校验失败或写入失败的 payload 不得伪装成已发送。
- 终态为 `unsupported/rejected/completed/failed/timedOut/cancelled/unconfirmed`。`accepted` 只表示网关接管命令，不是物理完成。
- evidence 从 `none`、`gatewayAccepted`、`transportWritten`、`deviceQueued`、`deviceAck` 到 `feedbackConfirmed` 分层；`transportWritten` 只适用于 engineering 六轴运动，FIFO 数字或通用 `ok` 也不能单独证明到位。
- 每个命令都校验 session/profile、连接有效性和适用状态；整组关节还校验新鲜实测反馈、已使能、恰好六个有限角、manifest 限位、显式正速度和完整四参数运动包络。
- FIFO 接受后，网关以有界频率读取 `#GETJPOS` 并计算六轴最大绝对误差。只有误差连续处于容差内达到稳定窗口才返回 `completed + feedbackConfirmed`；离开容差会重置窗口，总超时或查询超时返回 `timedOut + deviceQueued` 并锁存安全联锁。
- 常规遥测按一个串口 owner 串行调度：连接首轮读取 `#GETJPOS/#GETMODE/#GETENABLE`，之后关节位置使用 25 ms 主机目标节拍，模式与使能每 250 ms 交替插入一项，使每项约 500 ms 更新。位置帧仍按 Profile `protocolIndex` 原序发布并保留设备角；网关不应用 URDF 偏置，Dummy J3 的 -90° 只在前端模型边界处理。任何超时都会标记 stale，并要求下一次成功周期重新取得完整状态；engineering 人工运动期间不会因连续查询超时自动断开。
- 任一结构化命令进入 `unconfirmed/failed/timedOut` 后，网关锁存安全联锁并拒绝后续普通结构化命令；只允许停止并去使能。停止读回 disabled 成功或操作者现场复核后重新建立新 session 才能清除联锁。engineering 六轴直发不创建该联锁。
- UI 必须先完成 capability negotiation；页面禁用不是安全边界，C# 会重复全部许可校验。
- 客户端还必须先恢复当前 session 的 REST 命令历史；恢复状态不是 `ready` 时，普通结构化命令和 supervised 关节组失败关闭，停止并去使能仍可用。客户端的最近展示结果与安全联锁状态必须分离；空白、陈旧或因容量截断的历史不能清除已知联锁，只有时间不早于联锁的成功停止证据或新 session 才能清除。结构化命令 POST 的 HTTP 响应丢失属于物理结果未知，客户端以本地 `unconfirmed/transportError/none` 锁定控制，不能把网络异常当作“未发送”后重试。engineering 六轴请求失败只显示人工复核提示，不自动重发或创建结构化联锁。
- Dummy 设备页与固定顶栏软件停止必须进入同一客户端命令生命周期：统一记录终态、刷新 REST session/joint/audit，并对响应丢失执行同一联锁。Aethor_robo 控制台固定禁用软件停止和所有硬件动作，不进入该生命周期。客户端保存当前 Dummy session 最近一次成功停止的终态时间水位；迟到或乱序且不晚于该水位的旧未知结果不能重新锁存，也不能覆盖更新的最近结果。水位在 session identity 改变时清除，在空白或截断历史恢复时保留。

`jointGroupSpeedLimitDegS` 和 `jointGroupCompletion` 必须同时为非空或同时为空。后者包含 `positionToleranceDeg`（0.01–5）、`settledDurationMs`（100–5000）和 `timeoutMs`（500–120000，且运行时强制大于稳定窗口）。JSON Schema负责字段、类型和范围，跨字段大小关系由 C# 与 Zod 运行时重复校验。

Dummy 当前没有可信的完整运动包络，因此 `jointGroup` 默认不在 `supportedCommands`。禁止从 URDF 零 velocity、README、旧上位机默认值或展示数据推断任一参数。

## Engineering 直连调试

- 允许：`#GETJPOS/#GETMODE/#GETENABLE`、`!START/!STOP/!DISABLE`、`#CMDMODE 1–3`、`>j1,j2,j3,j4,j5,j6,speed`。
- 六轴命令必须显式携带第七个速度参数，六个角度满足 Profile 限位；网关还要求当前 session connected、模式有效、电机 enabled，并已至少取得一帧实测六轴数据。保留最后实测值的 stale 会话可继续人工下发；断开或新 session 后必须重新取得实测帧。
- 查询可用于 stale 会话诊断；`!STOP/!DISABLE` 可在 stale 状态发送。其他状态改变命令失败关闭。
- 直连命令与结构化命令共享唯一命令所有权、串口互斥和有界超时；任一时刻只能有一个在途硬件命令。停止并去使能先取消在途 direct，再在同一有界所有权链中执行；协议 TX/RX 带 correlation ID 进入有界证据。前端不得自行补写成功帧。
- 六轴 payload 写入 transport 后立即返回 `sent + transportWritten`，不等待或解释 FIFO、`ok`、队列满或到位。迟到回包只进入协议和诊断日志，不改变结果；操作者可继续发送下一目标。
- 该策略不关闭 Phase 5 Gate B。桌面无参数启动继续固定 `commandPolicy=disabled`；本机开发包只有显式 `--engineering` 才以 Development/development token 启用 direct，且不会自动连接串口。该入口不能作为正式发布或受监督运动证据，后者仍依赖四参数运动包络和 `feedbackConfirmed`。

## 停止、HOME 与 RESET

软件停止链固定为：

```text
!STOP -> $0,0,0,0,0,0 -> !DISABLE -> #GETENABLE
```

全零电流是网关内部固定 best-effort payload，不是公共 DTO。只有最终读回 `#GETENABLE=0` 才返回 `completed + feedbackConfirmed`；其他结果为失败或 `unconfirmed`，并持续提示软件急停不能替代物理急停。

STOP 抢占等待串口所有权也受 `CommandTimeout` 限制；超时不会无限挂起，而是返回 `unconfirmed/timeout`、锁存安全联锁、把反馈标为 stale 并要求立即使用物理急停。之后的普通命令返回 `safetyInterlockLatched`；被取消命令的迟到回包不能恢复为成功。

固件 `DummyRobot::Homing()` 和 `Resting()` 会在命令处理线程中阻塞到运动结束，ACK 也在返回后才发送。这会妨碍串口停止命令及时被解析。因此 Application 无条件拒绝 HOME/RESET，Infrastructure payload policy 也拒绝对应 ASCII；端点只作为稳定契约占位。未来需要先修复/验证固件抢占语义、完成新的监督台架验收，再通过新的版本化决策开放。

## SignalR

Hub 为 `/hubs/robot-v1`，使用 Bearer token；没有 client-to-server Hub method。事件为：

- `sessionSnapshot(RobotSessionSnapshot)`
- `jointStateFrame(JointStateFrame)`
- `protocolFrame(ProtocolFrame)`
- `commandResult(CommandResult)`

服务事件队列默认 128，拥塞时丢弃最旧通知；协议历史默认 256、命令历史默认 128。高频轮询可能覆盖协议历史中的早期命令帧，因此审计必须以 `CommandAuditRecord.request/transmittedPayloads/result` 为准，协议帧只作补充诊断。SignalR `commandResult` 是变化通知而非完整审计载荷；客户端收到后重新读取 REST 命令历史。session identity 改变时客户端立即清空旧历史并重新恢复，在成功前保持普通命令锁定。SignalR 重连、关闭或非法载荷会立即把已有 measured session/joint state 降为 `stale`；重连事件本身不是恢复证据，客户端必须重新取得 REST capabilities/session/joint/protocol 快照后才可恢复 `valid`。契约违规则触发合并限流的 REST 恢复；重连中等待 `onreconnected`，最终关闭则保持降级直至重新建立实时会话。恢复期间收到的实时 valid 帧也按 stale 接收，防止通道恢复与权威快照之间短暂误解锁。

## 串口与恢复

- 115200、8-N-1、ASCII/LF、无 handshake，DTR/RTS 关闭。
- 串口打开后先进入 `connected + stale`；完整有效查询循环后才是 `valid`。
- 串口打开有独立总超时，默认 5 秒，可由宿主在 `100–30000 ms` 内配置。从未取得串口所有权的普通打开失败在释放临时 transport 后回到 `offline`，错误由 HTTP 结果、operation probe 和 `serial.open.failed` 保留，不能留下需要人工释放的伪会话。打开超时或调用方取消使用 `serial.open.timeout/cancelled`，主动 dispose 候选连接，并隔离当前 Gateway 进程的后续打开尝试；只有重启进程才解除，避免无法取消的原生 `Open()` 工作项被重复累积。
- 默认查询顺序为 `#GETJPOS/#GETMODE/#GETENABLE`，单次 2 秒超时；成功打开后的连续三次查询超时或 I/O 故障进入 `faulted` 并释放 transport。
- 网关不会自动重连。普通失败后的再次连接仍由操作者重新确认端口和现场条件；打开超时/取消则必须先重启 Gateway。
- 未知、畸形、非 ASCII、超长和半帧保留为有界诊断，不更新可信状态。
- Infrastructure 使用 100 ms 有界同步读窗口并在每个窗口检查取消，不依赖 Windows `SerialPort.BaseStream.ReadAsync` 的非可靠取消；关闭仍先释放句柄，再等待轮询/命令收束和 dispose。
- 成功断开是新的会话边界：REST session 回到 `offline/unavailable`，joint 回到 unavailable，协议帧、命令审计和安全联锁清空。调用方必须同时清空当前会话遥测和目标草稿；显式保存到持久层或已经导出的文件不属于该临时会话。
