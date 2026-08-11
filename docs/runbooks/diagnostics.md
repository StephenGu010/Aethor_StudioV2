# Aethor Studio V2 诊断与日志探针

## 目的与边界

本手册定义 Desktop、WebView 前端和 Robot Gateway 的统一诊断语义。探针用于回答“请求由谁发起、走到哪一层、耗时多久、以什么结果结束”，不替代设备反馈、命令审计或物理安全确认。

默认日志位于 `%LOCALAPPDATA%\Aethor Studio V2\Logs\desktop.log`，单文件上限 5 MiB，保留 4 个轮转文件。Desktop 会登记并遮蔽短期 session token；探针禁止记录 token、请求头、原始 TX/RX、完整动作内容或关节目标。协议证据和命令审计仍由各自有界结构拥有。

## 导出诊断包

Windows 桌面版可在“设备与模型”的资源来源卡片中选择“导出诊断包”。浏览器版没有本地文件对话框和桌面日志所有权，因此入口会说明不可用，不会模拟导出结果。

桌面版弹出系统保存对话框后，会在同一时刻截取当前日志及最多四份轮转日志，并生成一个 ZIP：

```text
README.txt
manifest.json
logs/desktop.log
logs/desktop.log.1
logs/desktop.log.2
logs/desktop.log.3
logs/desktop.log.4
```

不存在的轮转文件不会创建空占位。每份日志最多 6 MiB，全部日志最多 30 MiB；超出边界、文件名不在清单内或出现重复项时，导出直接失败。`manifest.json` 使用 `aethor.diagnostics.bundle.v1`，列出产品版本、桌面运行模式、OS/.NET/进程架构和每个日志条目的字节数、SHA-256。可先核对 manifest，再按 operationId 查找同一次前端、网关和桌面事件。

导出会在已有日志遮蔽基础上再次处理 session token、`access_token`、Bearer、`X-Aethor-Session`、网关令牌环境变量和当前用户目录的原文或 JSON 转义形式。诊断包不包含串口终端/协议历史、命令审计、关节目标、Profile、URDF、mesh 或用户选择的保存路径。导出在目标目录中先写唯一临时文件，完成后再移动到目标名；取消或失败会清理该临时文件，已有目标文件只有在原生对话框明确确认后才覆盖。

诊断 ZIP 适合交给开发人员定位软件链路，但不会替代设备状态记录或实机验收记录。提交前先确认时间窗，避免把无关历史一并发送；诊断包和展开内容都不应提交到 Git。

## 稳定字段

| 字段 | 规则 |
|---|---|
| `eventId` / `EventId` | 稳定机器标识；禁止把异常文本拼进标识 |
| `operationId` | 前端生成 UUID，经 `X-Aethor-Operation` 传到 loopback 网关；缺失或非法时网关退回本次 HTTP trace id |
| `outcome` | 仅 `started / completed / failed` |
| `durationMs` | 终态耗时；前端保留 0.1 ms，网关记录整数 ms |
| `resultCount` | 枚举结果数量，不记录端口名或 PnP 身份 |
| `failureCategory` | 有界分类，如 `timeout / transport / authentication / validation / conflict / dependency / cancelled / unexpected / unknown` |

性能样本使用独立前缀 `AETHOR_PERF_V1` 和固定事件 `desktop.runtime.performance.sampled`。字段仅包含 `sequence`、规范化 `workspace`、`visibility`、`jsHeapUsedMiB/jsHeapTotalMiB`、`documents/nodes`、`layoutCount/recalcStyleCount`、`desktopWorkingSetMiB`、`webViewProcessCount/webViewWorkingSetMiB`、可空 `gatewayWorkingSetMiB` 与 `trackedWorkingSetMiB`；这些值都经过枚举、有限数、整数关系、聚合一致性和上限校验。`workspace` 只可能是 `console/scope/terminal/devices/actions/unknown`，用于比较不同工作区的资源趋势。

## 当前探针链

### 串口目录

1. 前端输出 `frontend.serial.catalog.started`；顶部串口控件和设备页通过同一 single-flight owner 请求，不能并发重复枚举。
2. HTTP 仅向 Desktop bootstrap 指定的随机 loopback origin 发送，携带 `X-Aethor-Session` 与 `X-Aethor-Operation`。
3. 网关输出 Event 1006 `serial.catalog.started`。
4. 成功输出 Event 1007 `serial.catalog.completed`，含同一 OperationId、ResultCount 和 DurationMs；失败输出 Event 1002 `serial.catalog.failed`，含同一 OperationId、DurationMs 和 FailureCategory。
5. 前端输出对应 `frontend.serial.catalog.completed/failed`，Zustand 目录状态进入 `ready/error`。枚举只读取 OS 端口目录，不打开串口。

Desktop 通过 `Runtime.consoleAPICalled` 接收前端 `console.info`，只把通过字段白名单、UUID、终态语义、数值范围和长度验证的 `AETHOR_PROBE_V1` 写入 `web.probe`；普通 console、扩展字段或疑似 secret 载荷全部拒绝。`web.console` 继续只承载浏览器网络/错误日志。ASP.NET 通用成功请求、路由和 CORS 噪声被压到 Warning；`AethorStudioV2.*` 稳定事件和 Hosting 生命周期仍保留。

### 串口连接与断开

顶栏和设备页通过同一 `serialSessionOperations` owner 执行显式连接与断开：

1. 同一 gateway、同一 Profile/端口的并发连接共享一个 Promise 和一个物理请求；并发断开同理。已有连接动作与断开动作冲突时，后到意图在前端失败关闭，不创建第二个网关请求。
2. 前端输出 `frontend.serial.session.connect|disconnect.started`，并把同一 UUID 放入 `X-Aethor-Operation`。
3. 网关 Event 1008 `serial.session.started` 记录 `Operation=connect|disconnect`；它不记录端口名或请求正文。
4. 成功输出 Event 1009 `serial.session.completed`，含连接终态与耗时；验证、冲突、依赖、取消或意外失败输出 Event 1010 `serial.session.failed`，含有界 FailureCategory。
5. 前端输出对应 `completed/failed`，共享 runtime 状态从 `connecting/disconnecting` 收束到 `idle/error`，两个入口同步解除或显示失败。自动重连仍不存在。

连接探针只证明软件请求路径与终态。只有 `serial.opened` 及相应 session/反馈证据才能证明端口被打开；探针本身不能证明设备身份、电机状态或机械动作安全。package smoke 使用不支持的 Profile 在 `ValidateConnectRequest` 阶段取得 400 与完整关联链，并强制断言日志中没有 `serial.opened`。

既有资源/会话探针继续使用 `serial.opened`、`serial.closed`、`serial.open.failed`、`serial.open.timeout`、`serial.open.cancelled`、`serial.query.timeout`、`serial.polling.faulted`、`serial.close.failed`、`events.publish.timeout`、`events.publish.failed`、`events.shutdown.timeout` 和 `events.shutdown.abandoned`。这些事件可包含 session/port 上下文，但不得据此推断电机状态或命令完成。`serial.open.timeout/cancelled` 表示候选连接没有成为 active transport；网关已开始释放候选资源并隔离本进程后续打开尝试，操作者应关闭并重启该 Gateway，不应连续点击连接。

### WebView2 性能样本

1. 包内页面成功导航后立即采一条，随后每 60 秒最多一条；上一次 CDP 请求未终结时不并发创建第二次采样。
2. Desktop 只从 `Performance.getMetrics` 提取固定六项 Web 指标，并添加当前宿主工作集和可见性。当前 `CoreWebView2.Source` 只经可信打包入口与已知路由白名单归一化为工作区枚举；完整 URL、查询参数和片段不进入样本。随后从 `CoreWebView2Environment.GetProcessInfos()` 取得同一 user-data folder 的官方进程快照，按唯一 PID 读取并立即释放句柄，只留下可观测 WebView2 数量和聚合工作集；若本桌面拥有子网关，再追加该网关工作集和三者合计。WebView2 快照排除 crashpad，`trackedWorkingSetMiB` 因此不是完整 OS 进程树总量。
3. PID、进程路径/命令行、未知 CDP 指标、CDP 原文、URL、DOM/脚本文本、令牌和设备数据不会写入日志。快照后已经退出的 WebView2 utility 进程会从本次聚合中省略；一个 WebView2 进程都无法读取、预期网关不可读、缺字段、重复字段、不可能的 heap/聚合关系、非整数/超界计数或协议异常都会停止后续采样，只写有界错误类别，避免探针自身形成日志风暴。
4. 单条或短时样本只用于定位趋势。没有经过预先定义的基线时长、场景、采样窗口和阈值，不能据此声称浏览器内存、流畅度或 Phase 7B 已验收。

## 定位步骤

```powershell
$log = Join-Path $env:LOCALAPPDATA 'Aethor Studio V2\Logs\desktop.log'
Select-String -LiteralPath $log -Pattern 'serial.catalog|serial.session|AETHOR_PROBE_V1|AETHOR_PERF_V1|Gateway ready|web.exception|web.console'
```

- 只有前端 `started`：检查 bootstrap 是否存在、请求 URL 是否等于同次 `Gateway ready on loopback port ...`，以及 CSP/浏览器网络错误。
- 前端与网关 `started` 存在但无终态：按 operationId 检查进程退出或请求超时；不要通过第二个串口工具探测句柄。
- 网关 `completed` 但前端 `failed`：优先检查响应 Schema/契约版本。
- `ResultCount=0`：这是合法空目录，不是已连接状态；用 Windows 设备管理信息另行确认驱动。
- Desktop 已出现 `Gateway ready` 但完全没有前端 `serial.catalog.started`：先确认启动 Profile。带 Dummy 网关的桌面新会话必须从 `Dummy` 启动并挂载唯一 coordinator；浏览器展示模式仍可恢复自己的 `sessionStorage` Profile。不要用固定 5127 或第二个串口进程绕过该门。
- `serial.session.started` 无终态：按 operationId 检查请求取消、进程退出和串口 I/O 所有权；不要增加重试或用第二个串口工具探测句柄。
- 前端出现两个相同 session `started`：检查是否绕过了 `serialSessionOperations` owner；顶栏和设备页不应直接调用 `gateway.connect/disconnect`。
- `serial.session.failed FailureCategory=conflict`：先读取 REST session 与命令审计确认当前 owner；不得把冲突当成已断开或自动重连。
- `serial.open.timeout`：原生打开超过 `AETHOR_GATEWAY_SERIAL_OPEN_TIMEOUT_MS`。保留同一 operationId、Gateway PID 和时间窗，正常关闭并重启该 Gateway；不要在原进程中换端口反复尝试，也不要启动第二个串口工具。如果重启后仍复现，再检查驱动、设备管理器状态和是否存在其他 owner。
- `serial.open.cancelled`：请求在打开过程中被取消，物理句柄取得状态不可由 HTTP 终态推断。当前 Gateway 同样要求重启；不要把页面重试当成清理证据。
- 出现 5127 而 Desktop 本次声明了其他随机端口：生产 Web 被开发配置污染；构建应立即失败，禁止通过放宽 CORS 掩盖。
- 没有 `AETHOR_PERF_V1`：确认本地页面已导航成功且日志中没有 `Performance probe unavailable` / `Performance sampling stopped`。不要通过打开远程调试端口绕过；该端口不属于产品诊断契约。
- heap、node/layout 或受跟踪工作集持续增长：先按 Profile、路由、窗口可见性、`webViewProcessCount` 和相同 sequence 时间窗复现，再对照 `sceneResourceTracker`、ECharts dispose 与路由卸载证据。`webViewProcessCount` 同步变化时先区分进程创建/退出与单进程增长；单次峰值不等于泄漏，禁止用手工 GC 或重启掩盖趋势。

复现后保留最短相关时间窗、operationId、事件序列和软件版本。不得把整份包含设备身份或协议内容的日志提交到 Git。

## 构建或测试被运行中网关占用

根 `pnpm test`、`pnpm build` 以及窄入口 `pnpm gateway:test` / `pnpm desktop:test` 都必须使用 `artifacts/validation/dotnet/.run-*` 的单次隔离输出，并在结束后自动清理。常规 `bin/Release` 被运行进程锁定时，不应再影响这些验证入口。

```powershell
pnpm test
pnpm build
Get-ChildItem artifacts/validation/dotnet -Directory -Filter '.run-*'
```

- 最后一条应无输出；存在残留时先记录精确目录、父路径、相关 dotnet/testhost PID 和失败日志，不要递归清理不明目录。
- `dotnet-isolated.ps1` 拒绝外部 `--artifacts-path` / `-p:ArtifactsPath`；不得绕过所有权校验。
- 不要为了通过测试终止未知网关、关闭未知串口会话或覆盖常规 Release 文件。实机运行手册需要持久产物时，另行显式执行 `pnpm gateway:build`；该命令与验证入口的所有权不同。
