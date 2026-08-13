# Aethor Robot Gateway

`.NET 10` 网关是 Dummy 设备 session、串口 transport、轮询、命令仲裁和审计的唯一所有者。默认配置是只读且硬件命令关闭。Phase 5 Gate A 已完成真实状态控制验收；Gate B 运动未执行，阶段仍未完成。

## 分层

```text
AethorStudioV2.Api
  -> AethorStudioV2.Application
       -> AethorStudioV2.Domain
       <- AethorStudioV2.Infrastructure
```

- `Domain`：v1.4 DTO、Dummy ASCII formatter/parser、固件设备角限位和命令状态枚举。Dummy 限位为 J1 `-170…170`、J2 `-75…90`、J3 `0…180`、J4 `-180…180`、J5 `-120…120`、J6 `-720…720`；网关不执行 URDF 偏置换算。
- `Application`：`RobotGateway` 单一所有者、轮询、许可门、幂等、单在途命令、停止抢占、安全联锁和有界历史；另含无生产接线的 Phase 6B-S `ActionProgramRunner`。
- `Infrastructure`：Windows SerialPort adapter 和精确 payload policy；不接受任意 raw ASCII。
- `Api`：loopback REST/SignalR、session token、精确 CORS 白名单和受控进程退出。
- `Tests`：跨语言 vectors、fake serial、命令/生命周期/安全和 HTTP/SignalR 认证。

完整 wire contract 见 [`shared/contracts/robot-gateway-v1.md`](../../shared/contracts/robot-gateway-v1.md)。

## 构建与测试

从仓库根执行：

```powershell
pnpm gateway:restore
pnpm gateway:build
pnpm gateway:test
```

需要 `.NET SDK 10.0.302`。`global.json` 固定 feature band，`dotnet.ps1` 优先使用未提交的 `.tools/dotnet/dotnet.exe`，否则使用 PATH SDK。

`pnpm gateway:test` 通过 `dotnet-isolated.ps1` 为每次验证创建唯一的仓库内 `artifacts/validation/dotnet/.run-gw-*` 输出，并只清理该次目录；调用方不能覆盖 artifacts path。这样运行中的网关可以继续拥有自己的常规 Release 文件和串口会话，测试不会强杀进程、打开串口或复用运行输出。`pnpm gateway:build` 保留常规 Release 输出，供明确的开发/实机运行手册使用；根 `pnpm build` 则使用隔离的 `gateway:build:verify`。

## 本地只读开发

```powershell
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$env:AETHOR_GATEWAY_SESSION_TOKEN = '<32-256 printable ASCII token>'
$env:AETHOR_GATEWAY_TOKEN_SOURCE = 'development'
pnpm gateway:dev
```

默认监听 `http://127.0.0.1:5127` 与 IPv6 loopback。启动服务不枚举、不打开串口，也不自动连接。默认 `commandPolicy=disabled`；只有显式设置 `engineering` 才会在 Development + development token 组合下开放受限直连调试。

| 环境变量 | 默认 | 规则 |
|---|---|---|
| `AETHOR_GATEWAY_PORT` | `5127` | 1024–65535；仍只监听 loopback |
| `AETHOR_GATEWAY_SESSION_TOKEN` | 无 | 必填，32–256 个可打印 ASCII |
| `AETHOR_GATEWAY_TOKEN_SOURCE` | `development` | `development` 或 `desktop`；非 Development 必须为 desktop |
| `AETHOR_GATEWAY_DEV_ORIGINS` | 5173/5174 的 localhost 与 127.0.0.1 | 分号分隔、无 path 的 loopback HTTP(S) origin |
| `AETHOR_GATEWAY_COMMAND_POLICY` | `disabled` | `disabled`、`supervised` 或 `engineering`；supervised 强制 desktop token，engineering 强制 Development + development token |
| `AETHOR_GATEWAY_SERIAL_OPEN_TIMEOUT_MS` | `5000` | `100–30000` ms；打开超时或调用方取消后本 Gateway 禁止再次尝试，须重启进程 |
| `AETHOR_GATEWAY_JOINT_POLL_INTERVAL_MS` | `25` | `20–1000` ms；只读取六轴 `#GETJPOS`，默认约 40 Hz 固定请求节拍 |
| `AETHOR_GATEWAY_STATUS_POLL_INTERVAL_MS` | `500` | 不小于关节轮询且不大于 `10000` ms；读取模式与使能状态 |
| `AETHOR_GATEWAY_JOINT_GROUP_SPEED_LIMIT_DEG_S` | 无 | 有限正数；关节组四项配置之一 |
| `AETHOR_GATEWAY_JOINT_GROUP_POSITION_TOLERANCE_DEG` | 无 | `0.01–5` deg；关节组到位容差 |
| `AETHOR_GATEWAY_JOINT_GROUP_SETTLED_DURATION_MS` | 无 | `100–5000` ms；必须连续处于容差内的窗口 |
| `AETHOR_GATEWAY_JOINT_GROUP_COMPLETION_TIMEOUT_MS` | 无 | `500–120000` ms 且大于稳定窗口；总到位超时 |

四项关节组配置必须同时存在或同时缺失；不得只配置速度。不要在当前 Phase 5 未完成状态下自行组合 `supervised + desktop` 配置连接 COM4。真实控制只能从 [Phase 5 监督式控制手册](../../docs/runbooks/phase-05-supervised-control-com4.md) 进入并重新记录现场授权。

`engineering` 是本地开发调试策略，不是生产能力：它不需要前端管理员解锁，但仍由 C# 独占串口、校验单行可打印 ASCII、Dummy 白名单、session、限位、使能和模式。六轴速度 `0 < speed <= 100` 只来自固件输入范围，绝不是已验证安全速度。直连 HTTP 受理产生 `queued + gatewayAccepted`，物理 writer 成功后再通过结果历史与 SignalR 产生 `sent + transportWritten`；两者都不等待队列号、`ok` 或到位，操作者可以继续提交后续请求。若运动写入后至少 500 ms、至少 8 个位置回包均未变化且仍远离目标，网关将关节反馈标为 `stale` 并记录一次 `engineering.motion.feedback_frozen_suspected`；角度重新变化后自动恢复 `valid`。该诊断不阻止下一次人工目标，也不能判断实机是否运动。使用步骤见 [Dummy engineering 直连手册](../../docs/runbooks/dummy-engineering-direct.md)。

## 当前控制边界

- `ActionProgramRunner` 当前只通过 fake `IActionProgramCommandPort` 验证逐点、停止、恢复、并发和超时语义；未注册 DI、未映射 API、未提供真实 `RobotGateway` adapter，也未改变前端运行按钮。它不是可用硬件能力。

- `enable`、`stopAndDisable`、`setMode` 和可选 `jointGroup` 已有类型化端点、能力协商和 fake-serial 证据；默认全部关闭。
- HOME/RESET 端点仅保留稳定契约。固件在处理这两条命令时阻塞到动作结束，生产配置不宣告、不执行。
- 关节组只有在连接有效、反馈新鲜、设备已使能、六轴目标合法、显式速度不超过外部已验证上限、完整到位策略已配置且无在途命令时才可执行。
- FIFO 接受只产生 `deviceQueued` 证据。网关持续读取 `#GETJPOS`，只有六轴最大误差连续处于容差内达到稳定窗口才返回 `completed + feedbackConfirmed`；总超时或查询超时返回 `timedOut` 并锁存联锁。若目标仍在容差外且至少三个有效位置样本完全不变，总超时时还会记录一次 `motion.feedback.frozen_suspected` 告警，并在结果中提示检查固件运动模式的反馈采集；该告警不把目标值当作反馈，也不推断机械臂实际是否运动。
- 关节位置与慢状态分开调度：`#GETJPOS` 默认以周期起点为基准每 25 ms 查询，不把串口往返耗时再次叠加到周期；模式与使能在位置样本之间错峰，每 250 ms 只查询其中一项，因此各自约 500 ms 刷新。启动和超时恢复也按“位置→一个慢查询→位置→另一个慢查询”取得完整状态，不形成三查询突发。
- `DummySerialSession` 是唯一串口 owner：一个 reader 连续解码所有 RX，一个 writer 经 `SerialDuplexScheduler` 写入所有 TX。轮询为 P2，普通结构化命令和 direct 为 P1，STOP/DISABLE 为 P0。结构化问答以单一 response fence 关联无标签回包；direct 不创建响应 waiter，迟到 FIFO/ACK 只记协议观察。P0 可以抢占低优先级 fence，结构化关节组到位等待仍复用 25 ms 快节拍。
- 停止链为 `!STOP -> internal fixed zero -> !DISABLE -> #GETENABLE`；只有读回 0 才能显示完成。
- 所有硬件命令等待串口所有权均有界；普通命令超时且零写入时拒绝，STOP 超时返回未确认并锁存安全联锁。任一未知物理结果都会阻断后续普通命令，只允许再次停止，成功去使能或重建 session 才清除。
- 任意 raw 串口写入、RGB、模式 4/5、电流/PID、标定和 reboot 没有公共端点；engineering direct 端点只是受限协议命令，不接受任意字节。
- 如果仍有在途硬件命令，或电机已明确读回 enabled，人工 disconnect 会被拒绝；打开失败的临时 transport 在异常路径立即释放并把 session 恢复为 offline，不要求操作者再执行断开，也不能阻塞桌面关闭。已经成功打开过的 stale/unknown/faulted 会话仍允许人工释放。进程退出执行强制资源清理，但这不构成物理安全确认。
- 每条命令审计保留规范化请求、SHA-256 请求指纹和最多 32 条实际成功写入 transport 的 payload；高频轮询协议环只用于补充诊断。

## 运行与恢复

- 正常退出会取消轮询/命令并关闭、dispose 唯一 transport。
- HTTP 请求在命令接管前已取消时零审计、零硬件写入；接管后的请求断开不会取消物理 runner。网关继续形成唯一终态，同 ID 查询/恢复不会重复发送。session 断开会先取消轮询/runner 并关闭串口句柄，以打断不响应 token 取消的原生读，再等待任务形成终态并 dispose transport；不在仍打开句柄时无限等待。
- SignalR 事件发布位于 transport 生命周期之外：每次发布与关闭排空均有独立超时。发布器超时后停止事件泵并记录诊断，不继续创建悬挂调用；网关 dispose 始终先释放 transport，再有界等待事件泵。REST 快照仍是权威状态。
- 成功打开后的查询连续三次超时、拔线或 I/O 故障进入 `faulted` 并释放串口，不自动重连；普通打开失败记录 `serial.open.failed` 和 API 错误后回到 `offline`。打开超时/取消记录 `serial.open.timeout/cancelled`，回到 offline 并隔离本进程后续打开；先正常重启 Gateway，不能在同一进程中连续重试。
- SignalR 中断不停止串口所有者；REST 仍是权威状态，前端把旧遥测标为陈旧并显式恢复。
- WebView2 只允许已配置 loopback origin，以及 `Authorization`、`X-Requested-With`、`X-SignalR-User-Agent`、`X-Aethor-Session` 和串口目录/会话诊断用 `X-Aethor-Operation` 等明确请求头；不允许任意 origin/header。
- `/serial/ports` 记录 Event 1006/1007/1002 的开始、终态、耗时、结果数或失败分类；`/session/connect` 与 `/session/disconnect` 记录 Event 1008/1009/1010 的动作、终态、耗时和失败分类。三条链均使用 `X-Aethor-Operation`，不会记录 token、端口身份、关节目标或协议内容。前端与桌面的对应排障见 `docs/runbooks/diagnostics.md`。
- 认证的 `POST /api/v1/host/shutdown` 只在无串口会话或设备已明确 disabled 时返回 202，并在响应完成后停止宿主；状态不明确时返回 409。该端点只供桌面父进程安全退出使用。
- 日志不得记录 session token 或带 `access_token` 的 URL。协议和命令历史均有界。

Phase 4 的不可连接预检与只读证据入口仍保留：`pnpm gateway:preflight`、`pnpm gateway:smoke:offline`。Phase 5 增加 `pnpm gateway:preflight:control`，它只做身份、资源、配置和 Release assembly 检查，不启动网关、不打开串口、不发网络请求；这些预检都不能替代真实控制验收。

Phase 7B 的受监督只读长测入口为 `pnpm gateway:soak:readonly`。先使用 `-ValidateOnly` 验证零进程/零网络/零串口路径；真实运行必须提供精确授权短语、操作者、授权编号、设备 InstanceId 和五项现场确认。脚本强制 `commandPolicy=disabled`，只连接 `dummy-6dof` 并验证三个查询白名单，采集网关 working set/private memory/handle/CPU、关节 sequence 和协议一致性，最后断开、请求宿主 202 并执行 post-cleanup。完整命令和判定边界见 [Phase 7B 只读长测手册](../../docs/runbooks/phase-07b-readonly-soak.md)。`evidenceCollectionPassed=true` 仅代表采集与清理可信，不代表资源阈值、浏览器 heap、故障注入或 Phase 7B 已完成。

2026-08-09 Gate A 已验证 `enable / stopAndDisable / setMode 1–3` 并恢复 mode 2，断开前设备回读 disabled；未发送关节目标。完整本机证据在被 Git 忽略的 `TestResults/phase-05-com4/20260809T060050Z/`，Gate B 仍须重新授权。
