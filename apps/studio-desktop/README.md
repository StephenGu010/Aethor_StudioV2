# Aethor Studio Desktop

`AethorStudioV2.Desktop` 是 Windows WinForms/WebView2 壳，负责单实例、原生窗口、随机 loopback 网关、每次启动令牌、应用数据路径和子进程生命周期。它不拥有机器人领域状态、不解析串口协议，也没有 raw 命令通道。

## 构建与测试

从仓库根目录执行：

```powershell
pnpm desktop:restore
pnpm desktop:build
pnpm desktop:test
pnpm desktop:legal:test
```

生成自包含 win-x64 便携包：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File apps/studio-desktop/build-windows.ps1
```

包内网关离线 smoke 与 WebView2 Stable Runtime 前置条件失败 smoke：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File apps/studio-desktop/smoke-packaged.ps1 `
  -PackageRoot artifacts/windows/AethorStudioV2-0.1.0-win-x64
powershell -NoProfile -ExecutionPolicy Bypass -File apps/studio-desktop/smoke-webview-prerequisite.ps1 `
  -PackageRoot artifacts/windows/AethorStudioV2-0.1.0-win-x64
```

本机开发包还可执行显式 engineering/offline smoke；它只读取 capability/session 并正常关闭网关，不枚举或打开串口：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File apps/studio-desktop/smoke-packaged.ps1 `
  -PackageRoot artifacts/windows/AethorStudioV2-0.1.0-win-x64 `
  -EngineeringOffline
```

采集当前显示器上的真实窗口 DPI、Per-Monitor V2 上下文、工作区与恢复位置证据：

```powershell
pnpm desktop:dpi:evidence `
  -PackageRoot artifacts/windows/AethorStudioV2-0.1.0-win-x64 `
  -ExpectedDpi 96
```

`-ExpectedDpi` 按 100/125/150/200% 分别使用 96/120/144/192；脚本只以 `--offline` 启动桌面，不创建网关，默认采证后正常关闭。`-KeepOpen` 仅用于操作者继续目视检查，使用后由操作者关闭该离线窗口。

构建默认拒绝脏工作树。本地开发检查可以增加 `-AllowDirty`，但产物会标记 `development-dirty`；干净但未签名的产物标记 `development-unsigned`。只有干净工作树中完成七个自有 PE 文件签名、可信时间戳和发布者复验的产物才标记 `release-candidate`。签名参数必须一次性完整提供，且签名后的文件先于 manifest 计算 SHA-256：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File apps/studio-desktop/build-windows.ps1 `
  -SignToolPath <signtool.exe> `
  -CertificateThumbprint <40-character-sha1-thumbprint> `
  -ExpectedPublisherSubject <exact-certificate-subject> `
  -TimestampUrl <https-rfc3161-url>
```

时间戳步骤会产生网络请求；构建和校验没有串口或硬件命令能力。输出目录必须位于仓库根目录内，拒绝把项目产物写到外部路径。同一版本和 Runtime 的打包使用独占文件锁，第二个并发构建会在修改现有包之前失败；.NET publish 的中间输出位于本次短名 `.stg-*` staging 与 `.dn` artifacts 目录内并在生成 manifest 前删除，避免 Windows 长路径清理失败，也不复用可能被旧运行进程锁定的常规 `bin/Release`。包 smoke 要求 manifest 路径唯一、长度与 SHA-256 匹配，且包内不能存在未声明文件。

`Legal/` 必须同时包含两个 Profile 的 NOTICE、Aethor_robo 机器可读 provenance、`MODEL-REDISTRIBUTION-STATUS.json`，以及从实际 pnpm 生产图和桌面/网关 `.deps.json` 生成的 SPDX 2.3 清单、机器可读完整性摘要和第三方许可文本。发布包遗漏正文的依赖只能使用 [精确版本许可来源清单](legal/README.md)补齐：组件版本、锁文件/包哈希、不可变上游 revision/blob、上游正文哈希与本地正文哈希全部校验，构建期间不联网。当前 92 个组件的依赖正文缺口已归零，但 Dummy 与 Aethor_robo 的完整再分发条款仍缺失，因此 `dependencyLicenseTextReady=true / modelRedistributionReady=false / releaseReady=false`；正式候选校验器返回 `model-redistribution-incomplete`。包 smoke 与发布候选校验命令见 [Phase 8 桌面 smoke](../../docs/runbooks/phase-08-desktop-smoke.md)。

## 启动参数

| 参数 | 语义 |
|---|---|
| `--offline` | 不启动网关，只加载离线 UI；不能与 `--gateway-path` 同用 |
| `--engineering` | 显式启动本机 Development engineering 网关；不能与 `--offline` 同用，启动本身仍不打开串口 |
| `--web-root <path>` | 指定包内 Web 根目录；相对路径基于 exe 目录 |
| `--gateway-path <path>` | 指定网关 exe；相对路径基于 exe 目录 |
| `--gateway-timeout-seconds <1..60>` | 网关 ready 超时 |

未知、重复或缺参选项会在启动前拒绝。

本机 Dummy 调试快捷方式使用同一桌面包和 `--engineering` 参数，不维护第二份 Web 资源：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File apps/studio-desktop/create-engineering-shortcut.ps1 `
  -PackageRoot artifacts/windows/AethorStudioV2-0.1.0-win-x64
```

脚本只在当前用户桌面创建或更新 `Aethor Studio V2.lnk`，目标为包内桌面 exe，图标来自同一已嵌入的圆角星环图标。该入口属于本机 Development 调试，不构成 Gate B、监督运动或正式发布候选证据。

## 生命周期与数据

- 默认数据根为 `%LOCALAPPDATA%\Aethor Studio V2`，包含 `Logs/WebView2/RobotProfiles/CrashDumps/Temp`、布局版本和窗口位置。
- 日志默认每文件 5 MiB、保留 4 个轮转文件；令牌和 `access_token` 会被遮蔽。
- “设备与模型”页可通过 `DesktopBridgeV1.exportDiagnostics` 导出诊断 ZIP。包内固定为说明、manifest 和最多五份日志快照，每份不超过 6 MiB、总日志不超过 30 MiB；导出再次遮蔽令牌和用户目录，不包含终端/协议历史、命令审计、关节目标、Profile 或模型文件。浏览器模式固定不可用，取消或失败不留目标半成品。
- 无参数启动固定为 `Production + desktop token + commandPolicy=disabled`；显式 `--engineering` 才使用 `Development + development token + commandPolicy=engineering`。两种模式都只监听随机 loopback；带 Dummy gateway 的新桌面会话进入 `Dummy` 后只读枚举 Windows 端口目录，但不会自动选择、连接或打开 COM4。
- 桌面对其自有子网关的健康检查与安全关闭使用独立直连 HTTP 客户端，固定绕过用户/系统代理并拒绝重定向；`HTTP_PROXY/HTTPS_PROXY` 不能劫持 loopback 生命周期请求。
- 正常关闭要求网关无串口会话或设备已明确 disabled；否则拒绝关闭并保持界面可见。从未取得串口句柄的打开失败会先释放临时 transport 并恢复 offline，因此不会把桌面困在设备状态未知的退出门。收到宿主 202 后等待子网关退出，超时仅终止该桌面拥有的精确进程树；Job Object 负责父进程异常退出时回收子进程，不遗留后台网关或 loopback listener。
- 桌面进程显式使用 Per-Monitor V2 DPI；自定义缩放命中区按当前 `DeviceDpi` 计算，窗口跨显示器变化写入有界诊断日志。
- 网关意外退出会用原生阻断面板覆盖工作区，明确显示设备状态未知；系统不自动重启网关、不自动连接串口。恢复策略是并发安全的单向状态机，只有观察到意外退出后才能接受一次“以离线模式重新启动”，新进程强制携带 `--offline`；没有宿主 202 确认时，普通关闭同样失败关闭。
- 桌面启动只接受 WebView2 Stable Runtime；先完成离线版本探测和 WebView 创建，成功后才允许启动机器人网关。缺失、非法版本或 Beta/Dev/Canary 覆盖会显示原生前置条件面板，提供受安全关闭门保护的退出按钮，且不自动下载 Runtime。
- WebView2 只加载 `http://localhost` 虚拟主机；外部导航、新窗口、权限和拖放均拒绝。
- 有效 Desktop bootstrap 始终压过 `.env.local`；production bundle 不含固定网关 URL 或令牌。Desktop bootstrap 声明 Dummy gateway 时，新会话固定从 `Dummy` 启动；顶部与设备页共享 single-flight 串口目录，枚举只读且不会自动打开端口。
- 串口目录使用前端 `AETHOR_PROBE_V1` 和网关 Event 1006/1007/1002 关联开始/终态、耗时和结果数；显式连接/断开由跨顶栏和设备页的 single-flight owner 合并，并使用 Event 1008/1009/1010 关联终态。Desktop 只从 `Runtime.consoleAPICalled` 接收通过严格字段白名单的 probe，普通 console 内容不会进入 `web.probe`。默认日志和定位流程见 `docs/runbooks/diagnostics.md`。
- 页面导航成功后，Desktop 每 60 秒 single-flight 读取一次 WebView2 `Performance.getMetrics`，并使用 WebView2 Environment 的进程快照聚合本次可见的浏览器进程工作集。`AETHOR_PERF_V1` 只保留规范化工作区 `console/scope/terminal/devices/actions/unknown`、JS heap、DOM/布局计数、可见性、桌面宿主、WebView2 进程数/工作集、可空网关工作集及三者合计；所有 `Process` 句柄读取后立即释放。工作区只从可信 `http://localhost/index.html#/...` 映射，不保存完整 URL、查询参数或片段。协议不可用、进程组不可观测或样本非法时探针停止，避免重复错误和诊断开销；它不记录 PID、进程路径/命令行、CDP 原文、页面内容、URL、令牌或设备数据。WebView2 官方快照排除 crashpad，因此合计字段是受跟踪进程值，不等同 OS 完整进程树。

Phase 8A 便携开发包、诊断包和 Phase 8B 的 Per-Monitor V2/安全崩溃恢复软件增量已验证，包括代理环境下唯一网关就绪、真实恢复按钮点击和强制离线新进程。诊断包原生文件对话框仍待人工目视。正式 MSI、代码签名、升级/卸载、四档 DPI 目视矩阵、多显示器和监督硬件回归仍未完成；安装边界见 [ADR-0008](../../docs/decisions/0008-windows-installer-and-user-data.md)。
