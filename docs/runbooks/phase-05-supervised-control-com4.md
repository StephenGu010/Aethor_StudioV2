# Phase 5 监督式 COM4 控制验收手册

- 状态：`GATE A VALIDATED / GATE B BLOCKED`
- 日期：2026-08-09
- 适用对象：`dummy-6dof`、固件基线 `5b9b602d8013799895c03f288e98ad72f38193be`
- 风险等级：会改变设备状态；运动门另行签字
- 前置基线：Phase 4 只读验收已通过

本手册是 Phase 5 实机控制的唯一执行入口。聊天中的设计确认不等于实机授权。每次运行都必须由现场操作者在物理急停可达、机械臂净空且姿态已确认时逐门签字；任何未确认、超时或异常回包立即停止扩大动作范围。

2026-08-09 已按本边界完成一次 Gate A：使能、停止并去使能、模式 1–3 和恢复模式 2 均由设备回读确认，未发送关节目标，断开前为 `disabled / mode 2`。该结果不能复用为 Gate B 授权，也不能省略后续每次运行的现场签字。

## 1. 永久禁止项

本阶段不得调用 HOME、RESET、模式 4/5、raw command、RGB、PID、电流调节、reboot 或未列出的固件指令。`Homing/Resting` 会阻塞固件协议处理，STOP 可抢占性尚未证明，因此即使 API 路由存在也必须保持 capability 未声明和 UI 禁用。

软件停止不能替代物理急停。不得从 URDF、旧上位机默认值或现场猜测推导速度、到位容差、稳定窗口、超时或安全回位姿态。

## 2. Gate 0：不打开串口的软件与身份门

从仓库根目录创建被 Git 忽略的证据目录，并记录操作者、机械臂姿态、供电状态、物理急停检查、Git SHA、Release assembly SHA-256 和固件提交。不得保存会话令牌。

```powershell
$runId = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$evidenceRoot = Join-Path (Get-Location) "TestResults/phase-05-com4/$runId"
New-Item -ItemType Directory -Force -Path $evidenceRoot | Out-Null
$expectedInstanceId = 'USB\VID_1209&PID_0D32&MI_00\7&2BF1B17E&0&0000'
$env:AETHOR_PREFLIGHT_PORT_NAME = 'COM4'
$env:AETHOR_PREFLIGHT_EXPECTED_INSTANCE_ID = $expectedInstanceId

pnpm gateway:preflight:control |
  Tee-Object -FilePath (Join-Path $evidenceRoot '01-control-preflight.json')
if ($LASTEXITCODE -ne 0) { throw 'Control preflight failed; do not start the gateway.' }

pnpm typecheck
pnpm test
pnpm build
```

预检必须显示 `hardwareAccessAuthorized=false`、`gatewayStarted=false`、`serialPortOpened=false`、`networkRequestSent=false`，且监督策略、desktop token、旧 session token 和四项运动包络均未预先注入。任何失败均终止本次验收。

## 3. Gate A 签字：只验证状态控制，不运动

现场签字文件 `02-gate-a-signoff.md` 必须逐项确认：

1. 操作者持续在场，工作区净空，物理急停可立即触达。
2. COM4 身份与 Gate 0 完全一致，机械臂当前姿态和供电状态已记录。
3. 本门只允许连接、三种只读查询、模式 1–3、一次使能、立即停止并去使能；不允许关节运动。
4. 使能前已通过 `#GETENABLE` 证明电机为 disabled；未知或 enabled 状态不得进入模式/使能步骤。
5. 任一结果不是 `completed + feedbackConfirmed`，立即执行停止链；若停止链未确认 disabled，立即使用物理急停。

缺一项即停止。Gate A 不能授权 Gate B。

## 4. 启动监督式实验网关

只在 Gate A 签字后，在同一 PowerShell 进程生成一次性令牌并启动已验证的 Release assembly。`Development + TOKEN_SOURCE=desktop` 只是当前监督台架的临时能力来源，不代表 Phase 8 WebView2 生产令牌链已经实现。

```powershell
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$tokenBytes = New-Object byte[] 32
$tokenGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $tokenGenerator.GetBytes($tokenBytes) } finally { $tokenGenerator.Dispose() }
$env:AETHOR_GATEWAY_SESSION_TOKEN = -join ($tokenBytes | ForEach-Object { $_.ToString('x2') })
$env:AETHOR_GATEWAY_TOKEN_SOURCE = 'desktop'
$env:AETHOR_GATEWAY_COMMAND_POLICY = 'supervised'
$env:AETHOR_GATEWAY_PORT = '5127'
$env:AETHOR_GATEWAY_DEV_ORIGINS = 'http://127.0.0.1:5174'

# Gate A 必须保持四项运动包络为空，使 jointGroup 不被声明。
Remove-Item Env:AETHOR_GATEWAY_JOINT_GROUP_SPEED_LIMIT_DEG_S -ErrorAction SilentlyContinue
Remove-Item Env:AETHOR_GATEWAY_JOINT_GROUP_POSITION_TOLERANCE_DEG -ErrorAction SilentlyContinue
Remove-Item Env:AETHOR_GATEWAY_JOINT_GROUP_SETTLED_DURATION_MS -ErrorAction SilentlyContinue
Remove-Item Env:AETHOR_GATEWAY_JOINT_GROUP_COMPLETION_TIMEOUT_MS -ErrorAction SilentlyContinue

$gatewayAssembly = Resolve-Path 'services/robot-gateway/src/AethorStudioV2.Api/bin/Release/net10.0/AethorStudioV2.Api.dll'
$projectLocalDotnet = Join-Path (Get-Location) '.tools/dotnet/dotnet.exe'
$dotnetExecutable = if (Test-Path -LiteralPath $projectLocalDotnet) { $projectLocalDotnet } else { (Get-Command dotnet -ErrorAction Stop).Source }
$gatewayProcess = Start-Process -FilePath $dotnetExecutable -ArgumentList @($gatewayAssembly) `
  -WorkingDirectory (Split-Path -Parent $gatewayAssembly) -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $evidenceRoot 'gateway.stdout.log') `
  -RedirectStandardError (Join-Path $evidenceRoot 'gateway.stderr.log')
$headers = @{ 'X-Aethor-Session' = $env:AETHOR_GATEWAY_SESSION_TOKEN }
$baseUrl = 'http://127.0.0.1:5127'
```

连接前读取 capabilities 并保存。必须满足：`commandPolicy=supervised`，只声明 `enable`、`stopAndDisable`、`setMode`，不包含 `jointGroup/home/reset`，`jointGroupSpeedLimitDegS=null` 且 `jointGroupCompletion=null`。控制预检还必须保存 Domain/Application/Infrastructure/API 四个自有 Release 程序集的逐项 SHA-256 与规范化 `releaseArtifactManifestSha256`；单独的 API 入口 DLL 哈希不能代表整套网关实现。

## 5. Gate A 单步执行顺序

每一步只在上一结果和最新 session 已保存后人工继续。每个状态改变请求使用新的 UUID；不得写循环或批量脚本。

1. POST `/api/v1/session/connect`，body 为 `{ "portName":"COM4", "profileId":"dummy-6dof" }`。
2. GET `/api/v1/session`、`/joint-state` 和 `/protocol-frames`；确认 measured/valid 且 `motorState=disabled`。
3. 依次对模式 1、2、3 各执行一次 POST `/api/v1/commands/set-mode`。请求包含新的 `commandId`、当前 `sessionId`、`profileId=dummy-6dof` 和单个 `mode`。每次必须读回相同模式并得到 `completed + feedbackConfirmed`。
4. POST `/api/v1/commands/enable` 一次；只有 `#GETENABLE=1` 才记录使能确认。不要执行其他普通命令。
5. 立即 POST `/api/v1/commands/stop-and-disable`；网关执行 `!STOP → $0,0,0,0,0,0 → !DISABLE → #GETENABLE`。只有最终 `completed + feedbackConfirmed` 和 `motorState=disabled` 才通过。
6. 每条命令完成后立即保存 `/commands/{commandId}`；核对 `request`、`transmittedPayloads`、`transmissionLogTruncated` 与 `result`。结束时再保存 `/commands?limit=50`、`/protocol-frames?limit=200`、`/session` 与 `/joint-state`。协议帧环是补充诊断证据，不能替代命令审计；TX 必须严格落在本门白名单内。
7. 仅在 disabled 已确认后调用 `/session/disconnect`。

结构化请求示例仅用于单步人工执行，不能预先运行：

```powershell
$session = Invoke-RestMethod "$baseUrl/api/v1/session" -Headers $headers
$body = @{
  commandId = [Guid]::NewGuid().ToString()
  sessionId = $session.sessionId
  profileId = 'dummy-6dof'
  mode = 1
} | ConvertTo-Json
Invoke-RestMethod "$baseUrl/api/v1/commands/set-mode" -Method Post -Headers $headers `
  -ContentType 'application/json' -Body $body
```

不要把 success HTTP 状态当作物理成功；只审查响应中的 `status`、`code`、`evidence` 和最新 measured session。

### 5.1 2026-08-09 Gate A 结果

- 用户在确认条件后明确要求发送 `!START`；Codex 无法独立观察物理工作区，证据只陈述用户授权和设备/软件读回。
- COM4 PnP 身份与预检一致；能力仅包含 `enable / stopAndDisable / setMode`，四项运动包络为空。
- `!START` 得到 `ok 1`；停止链得到 `Stopped ok / Disabled ok / ok 0`；模式 1、2、3 均得到匹配回读，最后恢复模式 2。
- 断开前 measured session 为 `disabled / mode 2`；未发送 `>` 关节目标、HOME、RESET 或模式 4/5。
- 断开后 gateway 进程和 5127 listener 均为 0，临时监督配置与 token 已清除。
- 本机忽略证据目录：`TestResults/phase-05-com4/20260809T060050Z/`。
- 当次 256 帧协议环被轮询填满，早期命令 TX 已被覆盖；命令结果和设备回包仍在。后续契约已增加独立的请求快照与实际 TX 审计，本结果不被事后改写。

## 6. Gate B：低风险关节运动的独立门

Gate B 当前为 `BLOCKED`。只有机械/固件负责人提交可追溯并签名的以下四项值，且现场操作者为本次目标重新签字后，才能重新启动网关：

| 配置 | 环境变量 | 当前值 |
|---|---|---|
| 最大关节速度 | `AETHOR_GATEWAY_JOINT_GROUP_SPEED_LIMIT_DEG_S` | `UNVERIFIED` |
| 到位容差 | `AETHOR_GATEWAY_JOINT_GROUP_POSITION_TOLERANCE_DEG` | `UNVERIFIED` |
| 连续稳定窗口 | `AETHOR_GATEWAY_JOINT_GROUP_SETTLED_DURATION_MS` | `UNVERIFIED` |
| 总到位超时 | `AETHOR_GATEWAY_JOINT_GROUP_COMPLETION_TIMEOUT_MS` | `UNVERIFIED` |

四项必须同时配置；缺一项时启动失败或 `jointGroup` 不得出现。目标必须基于 Gate A 新鲜实测姿态定义为经签字的微小增量，并逐轴验证 manifest 限位、机械净空和线缆余量。禁止使用展示位或所谓“安全回位”作为实机目标。

运动时网关先验证 session、反馈、使能、限位和速度；FIFO 接受不等于完成。只有六轴实测误差连续处于容差内达到稳定窗口才返回 `completed + feedbackConfirmed`。总超时、查询超时或不确定结果会锁存安全联锁，下一步动作编排不得继续；必须先执行并确认停止去使能。

Gate B 的目标值和四项包络必须写入当次签字文档，本手册不提供可复制的运动数值。

## 7. 异常处置与清理

- 普通命令出现 `unconfirmed/failed/timedOut/cancelled`：立即调用 stop-and-disable，不得继续下一项。
- stop-and-disable 不是 `completed + feedbackConfirmed`：立即使用物理急停；设备状态由现场操作者处理。在物理状态未处理前不要断开串口或停止网关，以免失去仍可能可用的停止通道。
- 物理状态处理完成后保存原始日志、session、command history 和 protocol frames；遮蔽令牌，把本次验收标记为失败。
- 仅停止本手册创建的 `$gatewayProcess`，不得按名称批量结束其他 `dotnet` 或 `node` 进程。

```powershell
if ($gatewayProcess -and -not $gatewayProcess.HasExited) {
  Stop-Process -Id $gatewayProcess.Id -Force
  $gatewayProcess.WaitForExit(10000) | Out-Null
}
Remove-Item Env:AETHOR_GATEWAY_SESSION_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:AETHOR_GATEWAY_COMMAND_POLICY -ErrorAction SilentlyContinue
Remove-Item Env:AETHOR_GATEWAY_TOKEN_SOURCE -ErrorAction SilentlyContinue
Remove-Item Env:AETHOR_GATEWAY_JOINT_GROUP_SPEED_LIMIT_DEG_S -ErrorAction SilentlyContinue
Remove-Item Env:AETHOR_GATEWAY_JOINT_GROUP_POSITION_TOLERANCE_DEG -ErrorAction SilentlyContinue
Remove-Item Env:AETHOR_GATEWAY_JOINT_GROUP_SETTLED_DURATION_MS -ErrorAction SilentlyContinue
Remove-Item Env:AETHOR_GATEWAY_JOINT_GROUP_COMPLETION_TIMEOUT_MS -ErrorAction SilentlyContinue

pnpm gateway:preflight:control |
  Set-Content -Encoding UTF8 (Join-Path $evidenceRoot '99-post-cleanup-preflight.json')
if ($LASTEXITCODE -ne 0) { throw 'Post-cleanup preflight failed; preserve evidence and mark the run failed.' }
```

完成条件：Gate A 与 Gate B 分别有签字和原始证据、所有未知结果均已按失败处理、最终 disabled 有设备读回、串口和 listener 已释放。Gate A 已满足自身退出条件；Gate B 仍被四参数运动包络和独立授权阻止，因此 Phase 5 必须保持 `IN PROGRESS`，不得创建阶段完成提交。
