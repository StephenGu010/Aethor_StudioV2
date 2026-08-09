# Phase 4 监督只读 COM4 验收手册

- 状态：`VALIDATED 2026-08-09 / REUSABLE`
- 安全等级：只读硬件查询；仍要求现场操作者和物理急停
- 适用 Profile：`dummy-6dof`
- 允许的设备查询类型：`#GETJPOS`、`#GETMODE`、`#GETENABLE`
- 明确禁止：使能、停止、去使能、回零、复位、模式切换、raw command、关节运动、动力学和轨迹规划

本手册是 COM4 监督只读验收的唯一执行入口。默认路径只做枚举和离线检查；只有完成“现场授权门”后，才允许调用一次 `/api/v1/session/connect`。2026-08-09 的 Phase 4 验收已通过；后续复验仍必须重新授权，任何异常立即进入清理并把当次复验标记为失败。

## 1. 建立证据目录

从仓库根启动 PowerShell。证据只写入已忽略的 `TestResults/`，不得提交令牌、原始日志或机器状态文件。

```powershell
$runId = [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$evidenceRoot = Join-Path (Get-Location) "TestResults/phase-04-com4/$runId"
New-Item -ItemType Directory -Force -Path $evidenceRoot | Out-Null
$expectedInstanceId = 'USB\VID_1209&PID_0D32&MI_00\7&2BF1B17E&0&0000'
```

记录操作者姓名/代号、Windows 版本、机械臂供电状态和当前姿态说明，但不要记录会话令牌。

## 2. 执行不可连接的只读预检

`preflight-readonly.ps1` 只读取 Windows PnP、进程和 TCP listener；它没有 `SerialPort` 实例，也不调用网关 HTTP API。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File services/robot-gateway/preflight-readonly.ps1 `
  -PortName COM4 `
  -ExpectedInstanceId $expectedInstanceId `
  -GatewayPort 5127 |
  Tee-Object -FilePath (Join-Path $evidenceRoot '01-preflight.json')

if ($LASTEXITCODE -ne 0) { throw 'Phase 4 preflight failed; do not start or connect the gateway.' }
```

通过条件：输出 `passed=true`、`serialPortOpened=false`、`networkRequestSent=false`；COM4 只有一个 PnP 身份、状态为 `OK`、Instance ID 完全匹配；没有残留 Aethor gateway 进程或 5127 listener。

脚本不能证明没有第三方程序占用 COM4。若怀疑端口被其他程序占用，停止验收并人工关闭对应程序；不得通过反复连接探测占用状态。

也可使用根级命令。硬件身份通过当前进程环境传递，避免 `&` 被 package runner 的 `cmd.exe` 参数层误解析：

```powershell
$env:AETHOR_PREFLIGHT_PORT_NAME = 'COM4'
$env:AETHOR_PREFLIGHT_EXPECTED_INSTANCE_ID = $expectedInstanceId
pnpm gateway:preflight
```

## 3. 复现软件门

仍不启动网关、不打开 COM4：

```powershell
pnpm typecheck
pnpm test
pnpm build
```

任何失败都终止本次实机验收。自动化和 fake serial 不能替代真实硬件证据。

在进入本手册第 4 节前，可独立复验离线启动、认证、枚举、失败关闭和精确清理。该命令自行启动并停止一个 Release gateway，只读取端口目录，不调用 `/session/connect`；完成后仍需重新执行第 2 节预检：

```powershell
$env:AETHOR_PREFLIGHT_PORT_NAME = 'COM4'
$env:AETHOR_PREFLIGHT_EXPECTED_INSTANCE_ID = $expectedInstanceId
pnpm gateway:smoke:offline
```

离线 smoke 通过不能代替第 5–7 节的现场监督证据，也不能把 COM4 枚举提升为已连接。

## 4. 启动离线网关

在当前验收终端生成一次性开发令牌，并用项目选择的 .NET runtime 启动第 3 节已构建的 Release gateway assembly。令牌只保存在进程环境，不写入命令输出、参数或证据文件；stdout/stderr 分开保存。直接持有 gateway 进程对象可以避免 package runner 产生多层进程树，使清理目标唯一且可审计。

```powershell
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$tokenBytes = New-Object byte[] 32
$tokenGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $tokenGenerator.GetBytes($tokenBytes)
}
finally {
  $tokenGenerator.Dispose()
}
$env:AETHOR_GATEWAY_SESSION_TOKEN = -join ($tokenBytes | ForEach-Object { $_.ToString('x2') })
$env:AETHOR_GATEWAY_TOKEN_SOURCE = 'development'
$env:AETHOR_GATEWAY_PORT = '5127'
$env:AETHOR_GATEWAY_DEV_ORIGINS = 'http://127.0.0.1:5174'
$gatewayStdout = Join-Path $evidenceRoot 'gateway.stdout.log'
$gatewayStderr = Join-Path $evidenceRoot 'gateway.stderr.log'
$gatewayAssembly = Resolve-Path 'services/robot-gateway/src/AethorStudioV2.Api/bin/Release/net10.0/AethorStudioV2.Api.dll'
$projectLocalDotnet = Join-Path (Get-Location) '.tools/dotnet/dotnet.exe'
$dotnetExecutable = if (Test-Path -LiteralPath $projectLocalDotnet) {
  $projectLocalDotnet
}
else {
  (Get-Command dotnet -ErrorAction Stop).Source
}
$gatewayProcess = Start-Process `
  -FilePath $dotnetExecutable `
  -ArgumentList @($gatewayAssembly) `
  -WorkingDirectory (Split-Path -Parent $gatewayAssembly) `
  -RedirectStandardOutput $gatewayStdout `
  -RedirectStandardError $gatewayStderr `
  -WindowStyle Hidden `
  -PassThru
```

启动本身不得枚举或打开串口。不要复制包含 `access_token` 的 URL。若 gateway 在离线检查前退出，保存两个日志文件并终止验收。

同一验收终端保有相同的进程级令牌，只执行离线 API 检查：

```powershell
$headers = @{ 'X-Aethor-Session' = $env:AETHOR_GATEWAY_SESSION_TOKEN }
$baseUrl = 'http://127.0.0.1:5127'

$capabilities = Invoke-RestMethod "$baseUrl/api/v1/gateway/capabilities" -Headers $headers
$portsResponse = Invoke-RestMethod "$baseUrl/api/v1/serial/ports" -Headers $headers
[object[]]$ports = @(
  if ($portsResponse.PSObject.Properties.Name -contains 'value') {
    $portsResponse.value
  }
  else {
    $portsResponse
  }
)
$sessionBefore = Invoke-RestMethod "$baseUrl/api/v1/session" -Headers $headers

[ordered]@{
  capabilities = $capabilities
  ports = $ports
  session = $sessionBefore
} | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 (Join-Path $evidenceRoot '02-offline-gateway.json')
```

通过条件：`hardwareCommands=false`；端口列表包含 COM4，但 session 仍为 `offline`，反馈不得为 `valid` 或 `measured`。

## 5. 现场授权门

以下每项必须由现场操作者重新确认并写入 `03-operator-signoff.md`；旧聊天记录或先前验收不能复用。

1. 操作者在场并负责立即中止；机械臂周围净空。
2. 物理急停可立即触达；供电状态和当前姿态已确认安全。
3. COM4 PnP 身份与本次预检完全一致。
4. 明确授权网关只轮询三种查询类型，不发送任何状态改变或运动命令。
5. 同意异常时立即断开并停止网关，保留原始失败证据。

任一项缺失时到此结束。不得调用连接端点，也不得用“只是查询”代替现场授权。

## 6. 执行唯一只读连接动作

只有现场授权门完整通过后执行。网关以固定顺序轮询三种查询；连接窗口限制为 10 秒，完成采样后无论成功或失败都在 `finally` 中断开。

```powershell
$connectBody = @{ portName = 'COM4'; profileId = 'dummy-6dof' } | ConvertTo-Json
$connectedAtUtc = [DateTimeOffset]::UtcNow

try {
  Invoke-RestMethod "$baseUrl/api/v1/session/connect" `
    -Method Post -Headers $headers -ContentType 'application/json' -Body $connectBody | Out-Null

  $deadline = [DateTimeOffset]::UtcNow.AddSeconds(10)
  do {
    $session = Invoke-RestMethod "$baseUrl/api/v1/session" -Headers $headers
    if ($session.connectionState -eq 'faulted') { throw 'Gateway entered faulted state.' }
  } while ($session.validity -ne 'valid' -and [DateTimeOffset]::UtcNow -lt $deadline)

  if ($session.validity -ne 'valid') { throw 'No valid read-only snapshot within 10 seconds.' }

  $jointState = Invoke-RestMethod "$baseUrl/api/v1/joint-state" -Headers $headers
  $protocolFramesResponse = Invoke-RestMethod "$baseUrl/api/v1/protocol-frames?limit=120" -Headers $headers
  [object[]]$protocolFrames = @(
    if ($protocolFramesResponse.PSObject.Properties.Name -contains 'value') {
      $protocolFramesResponse.value
    }
    else {
      $protocolFramesResponse
    }
  )

  [ordered]@{
    connectedAtUtc = $connectedAtUtc.ToString('O')
    capturedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    session = $session
    jointState = $jointState
    protocolFrames = $protocolFrames
  } | ConvertTo-Json -Depth 12 | Set-Content -Encoding UTF8 (Join-Path $evidenceRoot '04-readonly-capture.json')
}
finally {
  $disconnectResult = Invoke-RestMethod "$baseUrl/api/v1/session/disconnect" -Method Post -Headers $headers
  $disconnectResult | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 (Join-Path $evidenceRoot '05-disconnect.json')
}
```

Windows PowerShell 5.1 可能把顶层 JSON 数组表示成带 `value/Count` 的适配对象，直接序列化会污染证据；再用 `@(Invoke-RestMethod ...)` 包裹也不能可靠修复。必须像上面一样先检查 `value` 并归一化为显式 `[object[]]`，后续验证和保存都只使用归一化变量。

## 7. 验证结果与清理

通过条件必须同时满足：

- TX 原始帧只包含 `#GETJPOS`、`#GETMODE`、`#GETENABLE`，没有第四种 payload。
- 至少取得一组六个有限关节角、合法模式 1–3 和使能值 0/1；RX 来源为 `measured`，快照为 `valid`。
- 超时、乱码、未知帧或设备错误均没有被标记为成功；若出现则保持失败证据。
- `05-disconnect.json` 为 `offline`，断开后不再产生新的查询帧；没有自动重连。
- 停止本次 gateway 进程后，重新运行第 2 节预检，确认无 gateway 进程和 5127 listener，并保存为 `06-post-cleanup.json`。

完成 API 断开后，停止本次启动的精确 gateway 进程并等待退出；不要按进程名称批量终止其他 `dotnet` 或 `node` 进程：

```powershell
if ($gatewayProcess -and -not $gatewayProcess.HasExited) {
  Stop-Process -Id $gatewayProcess.Id -Force
  $gatewayProcess.WaitForExit(10000) | Out-Null
}

powershell -NoProfile -ExecutionPolicy Bypass `
  -File services/robot-gateway/preflight-readonly.ps1 `
  -PortName COM4 `
  -ExpectedInstanceId $expectedInstanceId `
  -GatewayPort 5127 |
  Set-Content -Encoding UTF8 (Join-Path $evidenceRoot '06-post-cleanup.json')

if ($LASTEXITCODE -ne 0) { throw 'Post-cleanup preflight failed; preserve evidence and mark this supervised run failed.' }
```

如果 `handle.exe` 已由现场环境受控安装，可额外使用只读 handle 查询证明没有 Aethor 进程持有 COM4；不得为了证明释放而用第二个程序重新打开串口。没有该工具时，必须记录“真实句柄直接观测不可用”，不能把 PnP 可见性冒充为句柄释放证据。

## 8. 异常恢复

任一异常立即执行：

1. 调用 `/api/v1/session/disconnect`；若 API 不可达，终止 gateway 进程。
2. 确认 session 不再轮询，停止网关并运行 post-cleanup 预检。
3. 保存网关控制台日志、协议帧和错误时间；删除或遮蔽任何令牌。
4. 将当次监督复验标记为失败，不得放宽白名单、延长无限等待或据此扩大硬件权限。

2026-08-09 的首次验收在全部条件取得真实证据后更新了 handoff、路线图和变更记录。后续复验只追加新的运行记录，不重复创建 Phase 4 完成提交；自动流程始终禁止 push。
