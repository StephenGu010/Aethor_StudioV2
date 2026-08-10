# Phase 7B Dummy 只读长测采证手册

- 状态：`TOOLING VERIFIED / HARDWARE SOAK NOT STARTED`
- 适用对象：`dummy-6dof`
- 串口协议：`dummy-ascii-v1`
- 唯一允许 TX：`#GETJPOS`、`#GETMODE`、`#GETENABLE`
- 明确排除：使能、停止、模式写入、关节运动、HOME、RESET、raw 串口、Aethor_robo

本手册只负责 Phase 7B 的干净只读基线采集。脚本会打开指定 Dummy 串口，因此必须由现场操作者在本次运行重新确认；历史 Gate A、旧截图或“机械臂就在旁边”都不能自动复用为授权。采证工具不会发送软件停止，物理急停仍由现场操作者负责。

## 1. 软件零硬件校验

从仓库根构建 Release 网关，然后先运行 validation-only。该路径不枚举设备、不启动网关、不发网络请求、不创建证据目录，也不打开串口：

```powershell
pnpm gateway:build

pnpm gateway:soak:readonly `
  -PortName COM4 `
  -ExpectedInstanceId '<current PNPDeviceID>' `
  -ValidateOnly
```

输出必须同时为：

```text
operation=validation-only
gatewayStarted=false
serialPortOpened=false
networkRequestSent=false
hardwareCommandSent=false
filesystemMutationPerformed=false
```

## 2. 本次现场授权

运行前由操作者逐项确认并记录：

- 工作区无人、无散落工具或线缆干涉；
- 物理急停可立即触达；
- Dummy 机械臂静止；
- 预期电机处于 disabled；脚本连接后还会以 `#GETENABLE=0` 再次验证；
- 当前 PnP `InstanceId` 与不可连接预检完全一致；
- 本次范围只允许三个查询，不允许任何状态改变或运动；
- 采集时长和授权编号已写入现场记录。

先执行不可连接预检：

```powershell
pnpm gateway:preflight `
  -PortName COM4 `
  -ExpectedInstanceId '<current PNPDeviceID>'
```

预检必须为 `operation=enumeration-only`、`passed=true`、`serialPortOpened=false`、`networkRequestSent=false`，且没有既有网关进程或 5127 listener。

## 3. 启动干净只读基线

默认持续 600 秒、每 5 秒采样一次；允许范围为 60–14400 秒、1–10 秒。实际时长由本次现场授权决定，不从旧项目推断资源阈值。

```powershell
pnpm gateway:soak:readonly `
  -PortName COM4 `
  -ExpectedInstanceId '<current PNPDeviceID>' `
  -Operator '<operator>' `
  -AuthorizationId '<site-record-id>' `
  -AuthorizationPhrase 'AUTHORIZE DUMMY READ-ONLY SOAK' `
  -WorkspaceClear `
  -PhysicalEmergencyStopReachable `
  -RobotStationary `
  -MotorDisabledExpected `
  -AcknowledgeReadOnlyQueries `
  -DurationSeconds 600 `
  -SampleIntervalSeconds 5
```

缺少固定授权短语或任一确认项时，脚本必须在创建证据目录和启动进程之前失败。脚本强制：

- `AETHOR_GATEWAY_COMMAND_POLICY=disabled`；
- 清除全部关节运动包络环境变量；
- capability 必须没有 `supportedCommands`；
- Profile 必须为 `dummy-6dof`；
- 初始和持续状态必须为 `connected / measured / valid / disabled / mode 1–3`；
- 六个关节角必须有限，sequence 在相邻采样间递增；
- 任一 TX 不属于三个查询，或出现协议 error frame，立即失败；
- 不自动重连、不自动重试硬件会话。

## 4. 证据与判定语义

证据写入被 Git 忽略的：

```text
TestResults/phase-07b-readonly-soak/<UTC-run-id>/
```

主要文件：

- `01-preflight.json`：连接前设备身份、进程和 listener；
- `03-capabilities-and-ports.json`：只读 capability 与端口枚举；
- `04-initial-measured-state.json`：首次可信 disabled 状态；
- `samples.ndjson`：UTC、session、六轴值、sequence、协议计数、网关 working set/private memory/handle/CPU；
- `05-final-snapshots.json`：结束前 session、joint 和有界协议帧；
- `06-disconnect.json`：明确 offline；
- `07-post-cleanup.json`：进程、listener 与端口身份复核；
- `summary.json`：首尾/峰值资源、采样率、协议错误和清理结果。

`evidenceCollectionPassed=true` 只说明脚本完成了可信采集、白名单检查和资源清理，不代表 Phase 7B 完成。摘要固定保留：

```text
resourceAcceptanceEvaluated=false
browserHeapCaptured=false
hardwareFaultInjectionPerformed=false
phase7bCompleted=false
```

在没有真实基线前不设置 working set、private memory 或 handle 的武断阈值；必须由工程负责人审阅曲线和多次重复结果后锁定验收线。

## 5. 失败与清理

- session 变为 stale/faulted、读到 enabled、关节值非法、sequence 不前进、协议 error 或非法 TX：立即停止采样并进入 finally 清理；不发 STOP。
- 正常清理顺序为 `POST session/disconnect → POST host/shutdown → 等待自有 gateway PID 退出`。
- 若宿主未在 10 秒内退出，只允许终止本次脚本创建的精确 PID；随后仍必须运行不可连接 post-cleanup。
- `summary.json` 缺失、`evidenceCollectionPassed=false`、最终不是 offline/202、进程或 listener 残留、日志泄露 token，均视为失败；保留原始证据，不覆盖重跑。
- 若物理状态与只读反馈冲突，立即使用物理急停并停止软件验收；不得把软件 disconnect 写成物理安全成功。

## 6. 仍需独立完成

干净后端基线通过后，Phase 7B 仍需在新的现场授权下完成：

1. 桌面/WebView2 实际页面的 heap、WebView2 子进程工作集和 UI 刷新流畅度采集；
2. 受控拔线或等价故障注入，验证 stale/faulted、REST/SignalR、无自动重连与 COM4 释放；
3. 至少一次重复运行的资源曲线比较和工程阈值签字；
4. 最终 post-cleanup 进程、5127 listener、串口 owner 为 0。

这些证据齐全前，Phase 7 保持 `IN PROGRESS`，不得创建或推送 `phase(07)` 完成提交。
