# Aethor Robot Gateway

`services/robot-gateway` 是 Phase 4 的 .NET 10 只读硬件网关。它独占一个串口会话，只允许读取 Dummy 状态；当前没有使能、停止、回零、复位、模式切换、关节下发或 raw command API。

## 分层与所有权

```text
AethorStudioV2.Api
  -> AethorStudioV2.Application
       -> AethorStudioV2.Domain
       <- AethorStudioV2.Infrastructure
```

- `Domain`：V1 wire DTO、Dummy ASCII 查询/响应语义和有界行解码，不依赖 HTTP 或串口。
- `Application`：`ReadOnlyRobotGateway` 是 session、SerialPort transport、轮询任务、最新状态和有界诊断历史的唯一所有者。
- `Infrastructure`：Windows 端口枚举与 `System.IO.Ports.SerialPort` adapter；写入边界再次拒绝除三个查询以外的任何 payload。
- `Api`：loopback REST、SignalR、会话令牌、CORS、结构化控制台日志和进程退出清理。
- `Tests`：跨语言 vectors、fake serial、生命周期、故障、安全与 HTTP/SignalR 认证。

默认轮询顺序固定为 `#GETJPOS`、`#GETMODE`、`#GETENABLE`，周期 500 ms、单次查询超时 2 s。连续三次超时或传输故障会将 session 置为 `faulted` 并释放串口；不会自动重连。

## 运行要求

- Windows 10/11。
- `.NET SDK 10.0.302`。`global.json` 固定该 feature band；`dotnet.ps1` 优先使用未提交的 `.tools/dotnet/dotnet.exe`，否则使用 PATH 中的 SDK。
- Node.js 24.x 与 pnpm 11.16+，用于根级统一命令。

从仓库根执行：

```powershell
pnpm gateway:restore
pnpm gateway:build
pnpm gateway:test
```

需要核对 wrapper 实际选中的 SDK/runtime 时，可直接透传任意 `dotnet` 参数：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File services/robot-gateway/dotnet.ps1 --info
```

## 不可连接预检

`gateway:preflight` 只读取 Windows PnP、Aethor gateway 进程和指定 loopback 端口的 listener，输出 `aethor.phase4.preflight.v1` JSON；脚本没有 `SerialPort` 实例或 HTTP client，不能打开 COM4。

```powershell
$env:AETHOR_PREFLIGHT_PORT_NAME = 'COM4'
$env:AETHOR_PREFLIGHT_EXPECTED_INSTANCE_ID = '<operator-verified Windows PnP instance ID>'
pnpm gateway:preflight
```

身份不匹配、PnP 状态异常、网关进程残留或 listener 占用时返回 exit code 2。硬件 Instance ID 通过进程环境而非 package-runner 参数传递，避免 ID 中的 `&` 被 `cmd.exe` 解释。完整现场流程只执行 [Phase 4 监督只读 COM4 验收手册](../../docs/runbooks/phase-04-supervised-readonly-com4.md)。

## 本地开发启动

为每次开发会话生成一个至少 32 字符的随机令牌，不要提交到仓库：

```powershell
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$env:AETHOR_GATEWAY_SESSION_TOKEN = '<32-256 printable ASCII session token>'
$env:AETHOR_GATEWAY_TOKEN_SOURCE = 'development'
pnpm gateway:dev
```

默认监听 `http://127.0.0.1:5127` 与 IPv6 loopback，不监听 LAN。可选配置：

| 环境变量 | 默认值 | 规则 |
|---|---|---|
| `AETHOR_GATEWAY_PORT` | `5127` | 1024–65535；仍只绑定 loopback |
| `AETHOR_GATEWAY_SESSION_TOKEN` | 无 | 必填，32–256 个可打印 ASCII 字符 |
| `AETHOR_GATEWAY_TOKEN_SOURCE` | `development` | `development` 或 `desktop`；非 Development 环境必须为 `desktop` |
| `AETHOR_GATEWAY_DEV_ORIGINS` | `http://127.0.0.1:5173;http://localhost:5173` | 分号分隔，仅允许无 path 的 loopback HTTP(S) origin |

前端复制 `apps/studio-web/.env.example` 为被忽略的 `.env.local`，并让 URL、令牌与网关进程一致。若 Vite 临时使用 5174，必须同时把该 origin 加入 `AETHOR_GATEWAY_DEV_ORIGINS`。

启动网关不会枚举或打开串口；前端设备页加载时只调用枚举和 REST 快照。只有操作者完成监督手册的现场授权门并调用“只读连接”后，网关才会打开端口并开始三个查询。Phase 4 在 COM4 实机门通过前不得把该动作写入自动启动流程。

## 公共接口

- 无认证健康检查：`GET /health/live`、`GET /health/ready`。
- 认证 REST：`/api/v1/*`，header 为 `X-Aethor-Session`。
- 认证 SignalR：`/hubs/robot-v1`，使用 Bearer token；WebSocket 升级可使用 SignalR 的 `access_token` transport 参数。
- 完整 DTO、端点、事件与失败语义见 [`shared/contracts/robot-gateway-v1.md`](../../shared/contracts/robot-gateway-v1.md)。

REST 快照是权威状态。SignalR 使用容量 128 的有界事件队列，拥塞时丢弃最旧事件；客户端必须在断线后把遥测标记为可能陈旧，并通过 REST 手动恢复。协议历史最多保留 256 帧，API 单次查询 `limit` 为 1–500，实际返回不会超过现存历史。

## 运行与恢复

- 正常退出：终止 `pnpm gateway:dev`；host 生命周期会取消轮询、关闭并 dispose 串口。
- 手动断开：调用 `POST /api/v1/session/disconnect`；重复断开是安全的，并返回 `offline` 快照。
- 端口占用/拒绝访问：连接返回 HTTP 503，session 为 `faulted`；先关闭占用程序，再由操作者重新点击连接。
- 拔线、I/O 错误或连续超时：网关停止轮询、释放 transport、返回 `faulted`；没有后台自动重连。
- SignalR 中断：串口轮询继续，REST 快照仍权威；前端显示遥测警告。
- 日志：JSON 写入当前进程控制台，不持久化原始令牌。认证失败只记录 method/path，禁止把令牌或带 `access_token` 的 URL 复制到日志或 handoff。

Phase 8 的桌面壳将负责生成 `desktop` 令牌并守护网关进程；当前开发流程不宣称桌面级进程回收已完成。
