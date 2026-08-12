# Phase 8 Windows 桌面壳与恢复验证手册

本手册验证软件包、WebView2、loopback 网关、Per-Monitor V2、受控崩溃恢复和进程清理。它不得连接 COM4，也不得开启 `supervised` 命令策略；安装/签名的正式演练仍在 Phase 8B 独立执行。

标准 smoke 必须使用无参数桌面或直接启动包内 `commandPolicy=disabled` 网关，不能携带 `--engineering`。工程快捷方式只供 [Dummy engineering 直连手册](dummy-engineering-direct.md) 的本机人工调试，不是 release smoke 或发布资格证据。

## 1. 前置条件

- Windows x64、WebView2 Runtime、Node.js 24、pnpm 11.16+、.NET SDK 10.0.302。
- 工作树清洁但未提供签名参数时只生成 `development-unsigned`；仅本地开发检查可以显式使用 `-AllowDirty`，产物必须标记 `development-dirty`。只有干净工作树中完成签名和可信时间戳复验的包才可标记 `release-candidate`。
- 运行前确认没有遗留 `AethorStudioV2.Desktop`、`AethorStudioV2.Api` 或目标 gateway listener。

## 2. 自动化

从仓库根目录执行：

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm desktop:legal:test

powershell -NoProfile -ExecutionPolicy Bypass -File apps/studio-desktop/build-windows.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File apps/studio-desktop/smoke-packaged.ps1 -PackageRoot artifacts/windows/AethorStudioV2-0.1.0-win-x64
powershell -NoProfile -ExecutionPolicy Bypass -File apps/studio-desktop/smoke-webview-prerequisite.ps1 -PackageRoot artifacts/windows/AethorStudioV2-0.1.0-win-x64
pnpm desktop:dpi:evidence -PackageRoot artifacts/windows/AethorStudioV2-0.1.0-win-x64 -ExpectedDpi 96
```

正式候选必须由发布负责人提供真实证书信息，四项签名参数缺一即在构建前失败：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File apps/studio-desktop/build-windows.ps1 `
  -SignToolPath <signtool.exe> `
  -CertificateThumbprint <40-character-sha1-thumbprint> `
  -ExpectedPublisherSubject <exact-certificate-subject> `
  -TimestampUrl <https-rfc3161-url>

powershell -NoProfile -ExecutionPolicy Bypass -File apps/studio-desktop/verify-release-candidate.ps1 `
  -PackageRoot artifacts/windows/AethorStudioV2-0.1.0-win-x64 `
  -ExpectedPublisherSubject <exact-certificate-subject>
```

签名仅覆盖清单声明的七个 Aethor 自有 exe/dll；第三方 runtime 文件由外层 MSI 签名覆盖。构建会先逐个执行 SignTool，再验证发布者与时间戳，最后计算 manifest 哈希。时间戳是本节唯一允许的构建网络请求；所有脚本均不得打开串口或发送硬件命令。

开发中的脏工作树只允许将构建命令改为：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File apps/studio-desktop/build-windows.ps1 -AllowDirty
```

通过条件：

- 发布清单中的每个文件存在且 SHA-256 匹配。
- `Legal/` 中的 Dummy NOTICE、Aethor_robo NOTICE/provenance 和 `MODEL-REDISTRIBUTION-STATUS.json` 必须存在且进入 manifest；模型随包分发时不能丢失来源、能力限制或不完整许可条款的告警。
- `Legal/THIRD-PARTY-INVENTORY.spdx.json` 必须为 SPDX 2.3，依赖组件、PURL 与 `DEPENDS_ON` 关系唯一；`THIRD-PARTY-SUMMARY.json` 必须绑定同一版本、Git commit 和构建时间，并与 npm/NuGet 组件数、缺失文本数、6 个精确版本许可来源、模型状态及所有法律附件一致。
- 仓库补充正文必须同时匹配 exact ecosystem/name/version、声明许可证、包完整性、HTTPS 上游、40 位不可变 revision/blob、上游正文 SHA-256 和本地正文 SHA-256；重复、陈旧、哈希变化、路径穿越、symlink 逃逸或 Profile 漏项均在打包前失败。构建不下载法律材料。
- 开发 smoke 允许 `releaseReady=false`，但必须分别报告依赖和模型缺口；发布候选校验器对依赖正文缺口返回 `third-party-license-incomplete`，对模型条款缺口返回 `model-redistribution-incomplete`。不得用 SPDX 声明、签名或依赖完整性覆盖模型条款。
- manifest 路径必须唯一，文件长度和 SHA-256 必须匹配；除 `release-manifest.json` 本身外，包内实际文件集合必须与 manifest 完全相等，不接受未声明文件或嵌套 `.stg-*` / `.dn` 中间目录。
- 同一版本和 Runtime 的并发打包必须失败关闭；第二个构建不能删除现有包，也不能留下暂存目录。
- `development-dirty`、`development-unsigned` 与 `release-candidate` 必须严格对应脏工作树、干净未签名、干净已签名三种状态；发布校验器只接受最后一种。
- 网关只监听随机 loopback 端口，`commandPolicy=disabled`，session 为 `offline`。
- 桌面 readiness/shutdown 客户端固定直连 loopback；即使存在 `HTTP_PROXY/HTTPS_PROXY` 且没有 `NO_PROXY`，也只能出现一个就绪候选，不能因代理产生健康检查超时重试。
- smoke 不打开串口、不发送硬件命令；关闭端点返回 202 后网关退出。
- WebView2 前置 smoke 以进程级 Beta-only 覆盖证明 Stable-only 策略在网关启动前失败；桌面保持在前置条件失败状态，且 `gatewayStarted=false`。脚本不修改系统 Runtime、不下载组件，只清理精确包路径下本次桌面 PID；面板视觉与原生按钮仍需在解锁桌面人工复核。

## 3. 实际窗口检查

1. 启动包根目录的 `AethorStudioV2.Desktop.exe`。
2. 确认标题栏显示 `Aethor Studio V2 / WINDOWS DESKTOP`，最小化、最大化/还原、拖动和关闭可用。
3. 确认五个工作区可进入，顶部仍诚实显示 `SERIAL OFFLINE / MOTOR UNKNOWN / FEEDBACK UNAVAILABLE`。
4. 确认软件急停、读取当前和整组关节下发因命令策略关闭而禁用；不得选择或连接 COM4。
5. 再次启动同一 exe，确认只保留一个窗口并唤起现有实例。
6. 正常关闭，确认桌面和网关进程均为 0。

## 4. DPI 与网关崩溃恢复

1. 在每档缩放下运行 `collect-dpi-evidence.ps1`，按 100/125/150/200% 分别传入 `-ExpectedDpi 96/120/144/192`。工具从实际窗口句柄读取 `GetDpiForWindow`、Per-Monitor V2 awareness context、显示器工作区和恢复后可见范围；不接受项目属性或截图替代运行时证据。默认以 `--offline` 启动并关闭，网关进程数必须为 0；需继续目视时显式增加 `-KeepOpen`。
2. 在 100%/125%/150%/200% 下分别检查标题栏按钮命中、启动失败面板、五个工作区、字体 fallback、最小窗口和 1366×768 紧凑布局。跨两个不同 DPI 显示器拖动并重启，再次运行采集脚本，确认窗口仍在目标显示器可视区域。
3. 只有在日志已经出现 `Gateway ready` 与 `WebView started`、同一子 PID 稳定越过启动窗口、`commandPolicy=disabled`、session 为 offline 且确认没有串口打开后，才可在任务管理器中结束当前桌面实例的唯一子网关进程。启动阶段允许最多 3 个有界候选尝试；就绪前出现替代 PID 是启动重试，不能冒充运行时自动恢复缺陷或通过证据。
4. 确认工作区立即被原生面板覆盖，文字包含“设备状态未知”和“不会自动重连”；不得出现新的网关进程或串口会话。
5. 尝试普通关闭，确认桌面保持打开并记录 `without a host-confirmed safe shutdown; close remains blocked`；进程已经消失不能替代宿主 202 确认。
6. 选择“以离线模式重新启动”，确认旧桌面退出后只出现一个新桌面进程、没有网关子进程，页面明确为离线展示模式。
7. 若桌面被锁定、窗口无法捕获或按钮无法操作，停止界面验收并记录为未验证，不得用日志代替点击结果。

## 5. 日志诊断

默认日志：

```text
%LOCALAPPDATA%\Aethor Studio V2\Logs\desktop.log
```

若由受容器化桌面工具启动，路径可能位于启动器的 LocalCache 映射内，以启动失败面板显示的实际日志目录为准。

检查项：

- `web.runtime` 应显示 `readyState=complete` 且 `rootChildren=1`。
- 不应出现 `web.exception` 或新的 `web.console` error。
- SignalR 应先通过 `/hubs/robot-v1/negotiate`，随后建立 `/hubs/robot-v1`。
- CORS 只允许 `http://localhost` 与明确的 `Authorization / X-Requested-With / X-SignalR-User-Agent / X-Aethor-Session / X-Aethor-Operation` 请求头。
- `smoke-packaged.ps1 -EngineeringOffline` 必须先通过 serial catalog OPTIONS，再只读枚举本机端口；结果必须保持 `serialPortOpened=false / hardwareCommandSent=false`。
- package smoke 还必须用不支持的 Profile 调用 connect validation boundary：HTTP 400、Event 1008/1010 operationId 一致、FailureCategory 为 validation，且日志没有 `serial.opened`。这不是端口连接测试。
- 实际 Desktop UI 触发枚举时，应同时出现前端 `AETHOR_PROBE_V1` 与网关 `serial.catalog.started/completed`，operationId 一致；独立 package smoke 不启动 WebView，因此只断言网关事件。诊断方法见 [统一探针手册](diagnostics.md)。
- 日志不得包含 session token 或 `access_token=`。
- 就绪后的崩溃注入必须出现 `Gateway exited unexpectedly` 和 `only an explicit offline restart is available`；之后不得出现新的 `Gateway ready` 或 `web.console/web.exception` 重试噪声，除非操作者重新启动了正常模式的新桌面 session。

## 6. 失败与清理

- 启动失败：记录面板信息和日志，不反复启动；确认包内 `web` 与 `gateway` 目录完整。
- 网关未就绪：桌面壳应显示失败面板或离线 bootstrap，不能自动连接串口。
- 关闭被拒绝：说明网关曾取得串口所有权且当前 disabled 状态不满足；保持窗口打开，按硬件 runbook 处理，不能强行把物理结果写成成功。从未打开成功的端口必须已经恢复 offline，若仍阻塞关闭则记录 `serial.open.failed`、session 快照和宿主 shutdown 结果并按缺陷处理。
- 仅在确认目标进程来自当前测试包后才做进程清理；清理后重新运行只读 preflight，不能用第二个串口程序探测句柄。

## 7. 尚未覆盖

当前证据证明签名流水线、并发打包、第三方清单、精确来源绑定和双模型法律门的失败关闭行为，不证明真实证书签名或模型法律审核成功。现有 `development-dirty` 包共 698 个文件，manifest 闭包校验 697 项；包内 `web/` 来自当前 2644-module production build，包含全局 Dummy/Aethor_robo Profile 切换、自适应 3D 像素预算和 Dummy 实时轮询/终端显示更新。engineering 离线 smoke 验证 92 个第三方组件（87 npm、5 NuGet/runtime pack）、6 个锁定上游正文、0 个依赖正文缺口、2 个模型条款缺口、session validation 探针 400/关联成功、shutdown 202、进程退出、零串口和零硬件命令。标准包还实际取得带 `workspace=console/terminal` 的新口径 `AETHOR_PERF_V1` 样本；三次控制台/终端短周期往返的 WebView2 进程数保持 5，工作集按页面回到各自范围，浏览器实时元素和 Canvas 数也精确回到基线。该短时记录仅验证探针、路由和资源释放链，不构成长期资源阈值。打开失败生命周期修复后，当前包另完成一次不连接串口的原生正常关闭，桌面、自有 Gateway 与 WebView2 进程树均归零；随后重开的工程会话只读取得 2 个端口且无连接或写入。真实占用端口失败路径没有再次触碰 COM4，只由 fake transport 回归覆盖。只读发布校验器因脏工作树、开发资格、未签名和 `model-redistribution-incomplete` 共 12 项问题拒绝该包，不再报告依赖正文缺口。当前构建通过短名 staging 内隔离 `.NET artifacts-path`，不复用被运行中旧网关锁定的常规 Release 输出。2026-08-10 的实际 96 DPI 采集仍读到 `PerMonitorV2=true`，窗口完全位于工作区且零网关；该单档证据不能替代 125/150/200% 与真实多显示器。代理环境中的恢复按钮点击已得到唯一 `--offline` 新桌面、零网关。模型条款、安装、升级、卸载、其余三档 DPI 目视、真实多显示器、COM4 句柄释放或硬件动作安全仍未验证。MSI 与用户数据边界见 [ADR-0008](../decisions/0008-windows-installer-and-user-data.md)；实机项仍需相应监督门。
