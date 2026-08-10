# Aethor Robot Gateway

`.NET 10` 网关是 Dummy 设备 session、串口 transport、轮询、命令仲裁和审计的唯一所有者。默认配置是只读且硬件命令关闭。Phase 5 Gate A 已完成真实状态控制验收；Gate B 运动未执行，阶段仍未完成。

## 分层

```text
AethorStudioV2.Api
  -> AethorStudioV2.Application
       -> AethorStudioV2.Domain
       <- AethorStudioV2.Infrastructure
```

- `Domain`：v1.2 DTO、Dummy ASCII formatter/parser、关节限位和命令状态枚举。
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
| `AETHOR_GATEWAY_JOINT_GROUP_SPEED_LIMIT_DEG_S` | 无 | 有限正数；关节组四项配置之一 |
| `AETHOR_GATEWAY_JOINT_GROUP_POSITION_TOLERANCE_DEG` | 无 | `0.01–5` deg；关节组到位容差 |
| `AETHOR_GATEWAY_JOINT_GROUP_SETTLED_DURATION_MS` | 无 | `100–5000` ms；必须连续处于容差内的窗口 |
| `AETHOR_GATEWAY_JOINT_GROUP_COMPLETION_TIMEOUT_MS` | 无 | `500–120000` ms 且大于稳定窗口；总到位超时 |

四项关节组配置必须同时存在或同时缺失；不得只配置速度。不要在当前 Phase 5 未完成状态下自行组合 `supervised + desktop` 配置连接 COM4。真实控制只能从 [Phase 5 监督式控制手册](../../docs/runbooks/phase-05-supervised-control-com4.md) 进入并重新记录现场授权。

`engineering` 是本地开发调试策略，不是生产能力：它不需要前端管理员解锁，但仍由 C# 独占串口、校验单行可打印 ASCII、Dummy 白名单、session、限位、使能、模式、反馈新鲜度和单在途。六轴速度 `0 < speed <= 100` 只来自固件输入范围，绝不是已验证安全速度；FIFO 返回仅记作 `queued`。使用步骤见 [Dummy engineering 直连手册](../../docs/runbooks/dummy-engineering-direct.md)。

## 当前控制边界

- `ActionProgramRunner` 当前只通过 fake `IActionProgramCommandPort` 验证逐点、停止、恢复、并发和超时语义；未注册 DI、未映射 API、未提供真实 `RobotGateway` adapter，也未改变前端运行按钮。它不是可用硬件能力。

- `enable`、`stopAndDisable`、`setMode` 和可选 `jointGroup` 已有类型化端点、能力协商和 fake-serial 证据；默认全部关闭。
- HOME/RESET 端点仅保留稳定契约。固件在处理这两条命令时阻塞到动作结束，生产配置不宣告、不执行。
- 关节组只有在连接有效、反馈新鲜、设备已使能、六轴目标合法、显式速度不超过外部已验证上限、完整到位策略已配置且无在途命令时才可执行。
- FIFO 接受只产生 `deviceQueued` 证据。网关持续读取 `#GETJPOS`，只有六轴最大误差连续处于容差内达到稳定窗口才返回 `completed + feedbackConfirmed`；总超时或查询超时返回 `timedOut` 并锁存联锁。
- 停止链为 `!STOP -> internal fixed zero -> !DISABLE -> #GETENABLE`；只有读回 0 才能显示完成。
- 所有硬件命令等待串口所有权均有界；普通命令超时且零写入时拒绝，STOP 超时返回未确认并锁存安全联锁。任一未知物理结果都会阻断后续普通命令，只允许再次停止，成功去使能或重建 session 才清除。
- 任意 raw 串口写入、RGB、模式 4/5、电流/PID、标定和 reboot 没有公共端点；engineering direct 端点只是受限协议命令，不接受任意字节。
- 如果仍有在途硬件命令，或电机已明确读回 enabled，人工 disconnect 会被拒绝；错误端口造成的 stale/unknown 会话允许释放。进程退出仍执行强制清理，但这不构成物理安全确认。
- 每条命令审计保留规范化请求、SHA-256 请求指纹和最多 32 条实际成功写入 transport 的 payload；高频轮询协议环只用于补充诊断。

## 运行与恢复

- 正常退出会取消轮询/命令并关闭、dispose 唯一 transport。
- HTTP 请求在命令接管前已取消时零审计、零硬件写入；接管后的请求断开不会取消物理 runner。网关继续形成唯一终态，同 ID 查询/恢复不会重复发送。session 断开会先取消轮询/runner 并关闭串口句柄，以打断不响应 token 取消的原生读，再等待任务形成终态并 dispose transport；不在仍打开句柄时无限等待。
- SignalR 事件发布位于 transport 生命周期之外：每次发布与关闭排空均有独立超时。发布器超时后停止事件泵并记录诊断，不继续创建悬挂调用；网关 dispose 始终先释放 transport，再有界等待事件泵。REST 快照仍是权威状态。
- 查询连续三次超时、拔线或 I/O 故障进入 `faulted` 并释放串口，不自动重连。
- SignalR 中断不停止串口所有者；REST 仍是权威状态，前端把旧遥测标为陈旧并显式恢复。
- WebView2 的 SignalR negotiate 只允许已配置 loopback origin，以及 `Authorization`、`X-Requested-With`、`X-SignalR-User-Agent` 和 `X-Aethor-Session` 等明确请求头；不允许任意 origin/header。
- 认证的 `POST /api/v1/host/shutdown` 只在无串口会话或设备已明确 disabled 时返回 202，并在响应完成后停止宿主；状态不明确时返回 409。该端点只供桌面父进程安全退出使用。
- 日志不得记录 session token 或带 `access_token` 的 URL。协议和命令历史均有界。

Phase 4 的不可连接预检与只读证据入口仍保留：`pnpm gateway:preflight`、`pnpm gateway:smoke:offline`。Phase 5 增加 `pnpm gateway:preflight:control`，它只做身份、资源、配置和 Release assembly 检查，不启动网关、不打开串口、不发网络请求；这些预检都不能替代真实控制验收。

Phase 7B 的受监督只读长测入口为 `pnpm gateway:soak:readonly`。先使用 `-ValidateOnly` 验证零进程/零网络/零串口路径；真实运行必须提供精确授权短语、操作者、授权编号、设备 InstanceId 和五项现场确认。脚本强制 `commandPolicy=disabled`，只连接 `dummy-6dof` 并验证三个查询白名单，采集网关 working set/private memory/handle/CPU、关节 sequence 和协议一致性，最后断开、请求宿主 202 并执行 post-cleanup。完整命令和判定边界见 [Phase 7B 只读长测手册](../../docs/runbooks/phase-07b-readonly-soak.md)。`evidenceCollectionPassed=true` 仅代表采集与清理可信，不代表资源阈值、浏览器 heap、故障注入或 Phase 7B 已完成。

2026-08-09 Gate A 已验证 `enable / stopAndDisable / setMode 1–3` 并恢复 mode 2，断开前设备回读 disabled；未发送关节目标。完整本机证据在被 Git 忽略的 `TestResults/phase-05-com4/20260809T060050Z/`，Gate B 仍须重新授权。
