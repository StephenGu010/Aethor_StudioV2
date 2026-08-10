# Phase 8 交接（IN PROGRESS）

## 当前结论

Phase 8A Windows 桌面软件门已实现并验证。Phase 8B 又完成了 Per-Monitor V2 运行时契约、代理无关的 loopback 生命周期、受控网关崩溃恢复、第三方生产依赖/SPDX 清单，以及发布签名的失败关闭流水线：崩溃后原生面板阻断工作区，不自动重启/重连；真实点击恢复按钮只启动唯一离线桌面，不创建网关。便携包只有在干净工作树、第三方法律摘要 `releaseReady=true`、七个自有 PE 文件签名、发布者和可信时间戳全部复验后才可能通过候选校验。当前 92 个组件中 6 个缺少包内许可正文，候选发布保持阻断。安装格式与数据保留已由 ADR-0008 锁定为 MSI + 独立 `%LOCALAPPDATA%` 数据根，但法律缺口处置、真实 Publisher/证书签名、安装器工具治理、四档 DPI 目视、升级/卸载和监督硬件回归尚未完成，因此 Phase 8 仍为 `IN PROGRESS`，不得创建 `phase-08-final.md` 或阶段完成提交。

## 交付物

- `apps/studio-desktop/src/AethorStudioV2.Desktop`：桌面壳实现。
- `apps/studio-desktop/tests/AethorStudioV2.Desktop.Tests`：当前 74 项桌面边界测试。
- `apps/studio-desktop/build-windows.ps1`：带同版本/Runtime 独占锁的自包含 Windows 包和逐文件 SHA-256 清单。
- `apps/studio-desktop/smoke-packaged.ps1`：manifest 闭包、离线网关和安全退出 smoke。
- `apps/studio-desktop/smoke-webview-prerequisite.ps1`：Stable-only 前置条件失败、原生面板和网关未启动 smoke。
- `apps/studio-desktop/verify-release-candidate.ps1`：只读发布候选 manifest、Git、文件哈希和 Authenticode 门。
- `apps/studio-desktop/collect-dpi-evidence.ps1`：离线启动实际窗口并采集 DPI awareness、窗口/工作区和进程清理证据。
- `apps/studio-desktop/scripts/third-party-inventory.mjs`：从 pnpm 生产图与发布 `.deps.json` 生成 SPDX 2.3、缺口摘要和法律附件。
- `apps/studio-desktop/scripts/third-party-inventory.test.mjs`：清单去重、确定性、LicenseRef、缺口和宿主路径隔离回归。
- `apps/studio-desktop/scripts/build-app-icon.ps1` 与 `assets/`：从既有星环 PNG 确定性生成透明圆角预览和 16–256 px 多尺寸 ICO，桌面 exe 直接嵌入该图标。
- `apps/studio-desktop/create-engineering-shortcut.ps1`：只在当前用户桌面创建指向当前包的 `Aethor Studio V2.lnk`，显式携带 `--engineering`，不复制 Web 或网关。
- `shared/contracts/desktop-bridge-v1.md`：桌面 bootstrap 与桥接契约。
- `docs/decisions/0007-desktop-process-and-bridge-boundary.md`：所有权与安全决策。
- `docs/decisions/0008-windows-installer-and-user-data.md`：MSI、Major Upgrade、数据保留、签名与工具治理边界。
- `docs/runbooks/phase-08-desktop-smoke.md`：构建、运行、诊断与清理入口。

## 关键设计

- 父进程持有窗口、一次性令牌、网关进程和应用数据路径；C# 网关仍持有唯一机器人 session 与 transport。
- WebView2 在 `http://localhost` 虚拟主机中加载包内页面，启动脚本在应用代码前注入冻结的 `DesktopBootstrapV1`。
- WebView2 只允许 Stable Runtime；探测和环境创建位于网关启动之前，失败时不下载、不启动网关，并保留原生安全关闭入口。
- 前端 bridge 只允许四种窗口动作；同动作在途请求合并。非关闭动作 2 秒超时，关闭动作 10 秒超时，以覆盖网关最多 8 秒的安全退出。
- 正常关闭调用认证的 `POST /api/v1/host/shutdown`。离线或明确 disabled 才接受；无法确认时失败关闭。
- 无参数桌面继续启动 Production/disabled 网关；`--engineering` 是显式 Development 本机调试模式，仍不自动打开串口，也不改变 release smoke 必须验证 disabled/offline 的要求。
- readiness 与 host shutdown 使用 proxy-free、redirect-free 的专用 loopback HTTP 客户端，不继承操作者的代理路径。
- 发布构建默认拒绝脏工作树；`-AllowDirty` 只生成 `development-dirty`，干净未签名构建只能生成 `development-unsigned`。四项签名输入缺一即在输出变更前失败；脏工作树禁止签名。七个自有文件签名并复验发布者/时间戳后才生成 `release-candidate`，随后才计算 manifest 哈希。
- 同一版本和 Runtime 的构建持有输出目录文件锁；并发构建在修改现有包前失败。最终提升使用目标已存在即失败的目录移动，避免 PowerShell 把暂存目录嵌套进已有包。包 smoke 同时拒绝重复/逃逸路径、长度或哈希不符、未声明文件和文件数不一致。
- 第三方清单只以 `pnpm licenses list --prod` 和桌面/网关实际 `.deps.json` 为事实输入；NuGet 法律文件从发布时已还原的精确包版本复制。开发 smoke 验证结构与缺口真值，发布 verifier 对 `releaseReady=false` 失败关闭，不因存在 SPDX 表达式就推断版权/许可正文完整。

## 验证证据（2026-08-09）

| 检查 | 结果 |
|---|---|
| `pnpm typecheck` | shared 与严格前端 TypeScript 通过 |
| 当前软件回归 | contracts 93 + frontend 184 + gateway 82 + desktop 79 + legal inventory 1，共 439 项通过 |
| `pnpm build` | Vite 2639 modules；gateway 隔离 Release 与 desktop Release 通过 |
| `pnpm test:e2e` | Edge 三档视口 63/63；包含双 Profile、布局与零硬件请求断言 |
| 离线网关 smoke | CORS/SignalR OPTIONS 204，命令关闭，session offline，token 无泄漏，清理后 preflight 通过 |
| 便携包 smoke | 688 个 manifest 文件哈希通过；disabled 与显式 engineering 两种 offline smoke 均为网关 ready、shutdown 202、进程退出、零串口/零硬件命令 |
| WebView2 前置 smoke | Beta-only 覆盖触发 Stable-only 失败状态；桌面保持运行；gateway 未启动；零串口/零硬件命令；面板视觉待解锁桌面复核 |
| 重排后正常桌面生命周期 | Stable Runtime `151.0.4129.72` → gateway ready → WebView started → DOM complete/rootChildren=1；web exception 0；正常关闭后桌面/API 为 0 |
| 发布资格门 | 部分签名参数在输出变更前失败；当前无签名脏包被只读校验器以 12 项问题拒绝，包含 6 个许可正文缺口，七个自有签名均为 `NotSigned`；零网络/零串口/零硬件命令 |
| 实际 WebView2 | root 挂载成功；REST、SignalR negotiate 与 hub 连接成功；该运行段 console error=0、web exception=0 |
| 正常退出 | `AethorStudioV2.Desktop` 与 `AethorStudioV2.Api` 均为 0 |
| DPI 软件门 | 打包进程运行时 `PerMonitorV2=true`；96/120/144/192 DPI resize 命中区单测通过 |
| 网关崩溃注入 | 同一 gateway PID 就绪并稳定 5 秒后终止；原生阻断日志出现；后续 5 秒无新 gateway、无 WebView 重试错误；普通关闭消息被拒绝且桌面保持运行；原子状态机只在失败后接受一次离线重启请求；清理后桌面/API 为 0；零串口/零硬件命令 |
| UI / 3D 比例复核 | 正文 15px、1920 页标题 28px、2560 页标题 30px；导航/状态改用 UI 字体；三档无根溢出，1920/2560 六轴完整可见，1366 仅关节列表局部滚动；相机按模型联合包围盒、FOV 和视口自适配，初载与重置断言通过；更新后的 Edge 63/63 与三张控制台基线通过 |
| Profile 包资源门 | ZIP 读取前压缩大小、中央目录声明解包总量、2,048 项、1 MiB manifest、8 MiB URDF、64 条诊断、Windows 路径冲突与取消/旧结果竞态均有回归；只声明结构有效，不展开 STL、不安装 |

## 增量验证（2026-08-10）

- `pnpm test`：contracts 91 + frontend 168 + gateway 54 + desktop 74，共 387 项通过。
- `pnpm build`：Web 2629 modules、复制 37 项 Profile 资源；gateway/desktop Release 均为 0 warning/0 error。
- 当前 `development-dirty` 包共 674 个文件；`smoke-packaged.ps1` 校验 673 项 manifest 哈希，确认 gateway ready、session offline、command policy disabled、shutdown accepted、gateway exited，且 `serialPortOpened=false / hardwareCommandSent=false`。
- 代理保持为 `127.0.0.1:7877` 且不设置 `NO_PROXY`：修复后当前桌面只产生一个网关候选，`/health/ready` 返回 200。真实崩溃/按钮恢复流程确认旧桌面退出、唯一离线桌面启动、零网关，最终进程与 5127 listener 均为 0。
- 同一代理条件下复验正常关闭：唯一候选收到 `POST /api/v1/host/shutdown`，返回 202；桌面记录网关已释放，随后桌面/API 均为 0。
- 桌面实页曾在模型可见时仍向 Windows 可访问性树暴露 `WEBGL INITIALIZATION FAILED`。根因是 R3F `Canvas fallback` 被渲染成原生 `canvas` 子节点；现已移除该伪告警，并由单元测试与三档生产构建 E2E 断言 READY 状态不存在场景失败节点。`test:e2e` 同时改为先重建当前 Web，旧 `dist` 不再能产生误导验收。
- 外层命令超时后，旧打包子进程仍可能继续；第二次构建曾与其并发，`Move-Item` 把 673 文件的暂存包嵌套进已有包，导致实际 1348 文件而旧 smoke 仍通过。修复后受污染包在网关启动前被拒绝；持锁时第二个构建立即失败且不删除现有包/不留暂存目录。重建包为 674 个实际文件（673 个 manifest 条目 + manifest），闭包 smoke、离线生命周期和当前 Web 语义均通过。
- 网关事件 sink 现有单次发布与关闭排空超时；fake sink 完全忽略 cancellation 时，网关仍先释放 transport 并在有界窗口内结束 dispose。该门防止桌面正常关闭被 SignalR 发布永久拖住，但不替代 Phase 8B 的真实 COM4 句柄与驱动故障验收。
- 该修复后的整仓回归为 contracts 91 + frontend 168 + gateway 68 + desktop 74，共 401 项；Web 2629 modules，两个 .NET Release 构建 0 warning/0 error。当前 `development-dirty` 包仍为 674 个实际文件/673 项 manifest，闭包 smoke 保持 offline、command policy disabled、shutdown 202、零串口/零硬件命令。
- Aethor_robo 三维场景已改为按需渲染；完整三档生产 E2E 60/60 证明空闲帧收敛、交互恢复、视觉基线不变及资源所有权不累积。该轮 674 文件包已包含对应 Web 构建；其后的法律闭包重建见下一项。
- 模型分发闭包已补齐：构建把 Dummy NOTICE、Aethor_robo NOTICE 与 Aethor_robo `provenance.json` 集中复制到 `Legal/`。新 smoke/release verifier 用旧包证明缺项时在网关启动前失败；重建包为 676 个实际文件/675 项 manifest，离线 smoke 通过，未签名开发包仍被 11 项发布资格问题拒绝但不再包含 `legal-asset-missing`。
- 新增实际 DPI 采集脚本；Windows PowerShell 5.1 兼容性问题在首跑中暴露并修复。本机 96 DPI/100% 实测 `PerMonitorV2=true`，窗口 1600×940 完全位于 1920×1032 工作区，零网关。故意要求 120 DPI 时按预期失败并清理桌面进程；125/150/200% 和真实多显示器仍未验证。
- 该增量最终门为 contracts 91 + frontend 172 + gateway 68 + desktop 74，共 405/405；Web 2630 modules、37 项 Profile 资源，gateway/desktop Release 0 warning/0 error，完整三档生产 E2E 60/60。
- 第三方清单单测与 SPDX 官方 2.3 JSON Schema 校验通过；整仓为 contracts 91 + frontend 172 + gateway 68 + desktop 74 + legal inventory 1，共 406/406，完整三档生产 E2E 60/60。重建 `development-dirty` 包为 688 个实际文件/687 项 manifest。离线 smoke 验证 93 个组件、6 个缺失文本、gateway ready、session offline、command policy disabled、shutdown 202 和零串口/零硬件命令。release verifier 按预期返回 `third-party-license-incomplete`，明确列出 SignalR、React Three Fiber、react-remove-scroll-bar、tr46、urdf-loader 与 System.IO.Ports。
- 双 Profile 增量完成后，整仓为 contracts 91 + frontend 177 + gateway 68 + desktop 74 + legal inventory 1，共 411/411；Web 2639 modules、37 项 Profile 资源，完整三档生产 E2E 63/63。重新生成的 `development-dirty` 包仍为 688 个实际文件/687 项 manifest，包内 `web/` 与当前 `dist/` 的 54 个文件逐项长度和 SHA-256 完全一致。离线 smoke 再次确认 gateway ready、session offline、command policy disabled、shutdown 202、零串口/零硬件命令；只读发布 verifier 以脏工作树、资格、签名和 6 个许可正文缺口共 12 项问题按预期拒绝，且不修改文件系统、不联网。
- 当前包重新执行实际 96 DPI 采证：`PerMonitorV2=true`，1600×940 窗口完整位于 1920×1032 工作区，`gatewayProcessCount=0`。这只覆盖 100% 缩放；125/150/200% 与真实多显示器仍未验证。
- Desktop/Web 对齐增量加入显式 engineering 启动参数、同源圆角应用图标和工程快捷方式脚本；desktop Debug/Release 79/79 通过。隔离 publish 在旧进程仍锁定常规 Release 目录时成功生成 689 文件/688 manifest 的 `development-dirty` 包，55 个 `web/` 文件来自当前 2639-module production build；disabled 与显式 engineering 两种 offline smoke 都校验 92 个组件、6 个缺失许可正文、shutdown 202、进程退出、零串口与零硬件命令。只读 release verifier 仍以 12 项资格问题按预期拒绝该开发包。桌面 `Aethor Studio V2.lnk` 已创建并指向该包的 `--engineering`，但尚未启动；旧未知 COM4 会话的精确清理和工程桌面实启仍等待物理安全确认，因此本项不写成 Phase 8 完成证据。

实际运行发现并修复两类跨层问题：

1. bridge 单例在 class 初始化前创建，生产 WebView2 路径触发 `TypeError: ... is not a constructor`；已调整初始化顺序并增加 bootstrap-before-import 回归测试。
2. SignalR negotiate 使用 `X-Requested-With` 与 `X-SignalR-User-Agent`，原 CORS 白名单遗漏；已补入精确白名单和真实 OPTIONS smoke，未放宽任意 origin/header。
3. 默认 DPI 行为没有显式工程契约；已固定 `PerMonitorV2` 并用运行时窗口上下文验证。网关崩溃原先只写日志，工作区仍可见；现改为原生阻断面板和显式离线重启。进一步修复了“网关进程消失即允许关闭”的错误语义，只有宿主 202 才能作为正常安全关闭证据；恢复入口又收敛为原子单向状态机，正常态和重复/并发请求均不能绕过失效门。
4. WebView2 原先在网关之后初始化，Runtime 缺失时会保留无可用 UI 的网关进程；现改为 Stable-only 探测和 WebView 创建成功后才启动网关。无边框窗口的前置条件失败面板新增原生安全关闭按钮，避免只能依赖 Alt+F4。

## 安全记录

- Phase 8A 打包、smoke 和实际桌面检查均保持 `commandPolicy=disabled`。
- 离线 smoke 只枚举 COM4，不连接；`serialPortOpened=false`、`hardwareCommandSent=false`。
- 2026-08-09T13:15:51Z 控制预检再次通过，COM4 身份匹配且无 gateway/listener；结果仍声明 `hardwareAccessAuthorized=false / serialPortOpened=false / networkRequestSent=false`。用户提出的本次 `!START` 请求尚未取得新的完整现场确认，因此未打开 COM4、未发送命令。
- 2026-08-09 的崩溃注入只终止 `commandPolicy=disabled` 且 session offline 的当前包子网关；没有自动恢复网关或串口。当时 Windows 锁屏，因此界面恢复按钮未验证。
- 2026-08-09 再次启动同一 `development-dirty` 离线包尝试恢复按钮验收时，Windows 仍只返回锁屏界面；按自动化安全规则未输入、未解锁。随后仅终止精确包根下的桌面 PID 与子网关 PID，复核两者为 0；没有串口或硬件命令。
- 2026-08-10 在解锁桌面复验时发现本机 `HTTP_PROXY/HTTPS_PROXY` 存在而无 `NO_PROXY`，默认 `HttpClient` 使三个已监听候选均健康检查超时。监督器改为 proxy-free loopback client 后，单个候选取得 200 并稳定；终止精确子 PID 后 5 秒内无新网关，原生阻断面板可见。真实点击恢复按钮后旧桌面退出，只启动一个携带 `--offline --web-root` 的新桌面，网关为 0；正常清理后桌面/API 均为 0。未打开 COM4、未发送硬件命令。

## Phase 8B 待办

1. 为 6 个缺少包内正文的组件取得与锁定版本对应的权威许可文本或书面法律处置，并补齐两个模型的再分发条款；只有摘要变为 `releaseReady=true` 才继续正式候选。
2. 按 ADR-0008 关闭 MSI 工具治理、Publisher/证书与 WebView2 离线 Runtime 决策；实现安装、修复、升级、降级拒绝和卸载，默认保留用户数据。
3. 由发布负责人提供真实 Publisher、代码签名证书和 RFC 3161 服务，执行已实现的签名/复验门；从两个不同三段版本的干净提交生成候选。
4. 在 Windows 100/125/150/200% DPI 与真实多显示器上验证标题栏命中、字体、窗口恢复和五工作区。
5. 在独立现场授权下完成 7B/8B 只读长测、拔线和关闭句柄证据；Gate B 仍需独立运动授权。
6. 完成上述退出门后生成 `docs/handoffs/phase-08-final.md`、本地 `phase(08)` 提交并由用户决定是否 push。
