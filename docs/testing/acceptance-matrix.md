# 验收矩阵

| 范围 | 自动化/检查 | 实机要求 | 通过标准 |
|---|---|---|---|
| 阶段 0 基线 | TS strict、Vitest、build、Playwright 五路由 | 禁止访问串口 | 三档视口无控制台错误；命令均可复现 |
| Profile/导入 | Schema、单臂/多臂关节分组、限位、内置资产 SHA-256 溯源、ZIP 元数据/膨胀边界、Windows 路径安全、取消/竞态、缺失 mesh | 无 | Dummy 六轴和 Aethor_robo 2×7 轴映射均通过；Aethor_robo 来源/规范化 URDF 与 23 个 STL 映射可复核，provenance、URDF 引用和磁盘资产必须完全一致；分组不得重复或漏掉可控关节；250 MiB 压缩/解包、2,048 文件、1 MiB manifest、8 MiB URDF、64 条诊断均有界；拒绝穿越、ADS/保留名、大小写冲突、URL、重复关节、DOF/限位错误；旧任务不能覆盖新选择 |
| 协议 | formatter/parser、随机分片/粘包、255 字符边界、异常行、FIFO、超时、取消、跨语言 vectors | 先用 fake serial | 与指定固件提交一致；未知帧保留可诊断信息；排除命令不可构造 |
| 状态隔离与 Profile 切换 | feedback/target、showcase/session、命令状态机、全局 Profile 选择、草稿/runtime 清理、连接态切换拦截、首帧目标对齐 | 无 | 展示数据不能产生在线、使能或成功状态；Aethor_robo 与 Dummy 状态不串流；切换后隐藏目标复位；新 Dummy hardware session 首个可信实测帧只对齐目标一次，用户编辑优先且后续反馈不覆盖；Dummy 未 offline、联锁存在或未确认去使能时不能切走 |
| UI | 五工作区组件测试、键盘焦点、视觉截图、关键矩形与文本溢出几何断言 | 无 | 1366×768、1920×1080、2560×1440 无关键裁切/重叠/跳动；`Aethor_robo` 单行名称不越框；关节滚动区、固定预览提示和下发区顺序不重叠；禁用原因可聚焦；无控制台错误 |
| 3D | Dummy 六轴与 Aethor_robo 双七轴 URDF 原点/轴/分组、本体与分组包围盒相机适配、参考网格、拾取/拖动、按需渲染、自适应 DPR、WebGL/资源失败、重复卸载/切换 | 无 | 23 个 Aethor_robo STL 全部加载且 visual/collision 共享 23 份 geometry；目标 collision 不绘制，幽灵材质按受控关节共享，诊断含操纵器为 29 geometry / 22 material；参考网格位于完整整机最低点下方至少 8 cm、覆盖至少 2 倍足迹且边长不少于 6 m；balanced DPR ≤1.75/350.5 万像素，constrained DPR ≤1.2/180 万像素且最低 1；关节只差量更新，连续目标输入不重算相机包围盒，工具窗坐标变化不重绘 3D 场景；空闲实际帧计数收敛，关节/相机/拖拽/模型变化立即恢复并再次停止；整机/左右臂取景可恢复，左右各七轴可独立预览，车轮模型专用；实体与幽灵独立；READY 时 DOM/可访问性树不存在场景失败告警，真实 WebGL/资源失败仍明确降级；初载/窗口变化/重置后模型完整入镜且不受固定雾距遮蔽；一次同源网络中断可恢复但持续失败可见；拖动目标变化而另一 Profile、反馈和硬件请求不变；renderer/controls/model/drag 所有权不累积 |
| 网关 | 单元、集成、fake serial、顶栏/设备页端口选择、错误/占用/打开停滞/拔出端口、重复连接/断开、loopback/token、不合作事件 sink | Phase 4 已按监督手册完成只读连接；控制需对应 runbook | 顶栏枚举不自动连接，只有显式操作打开所选端口，连接端口在两个入口一致；普通打开失败释放临时 transport 后直接回到 offline；打开超时/取消主动 dispose 候选连接、回到 offline 并隔离本进程重试，宿主仍可退出；成功打开后的 stale/unknown/faulted 仍可人工释放，明确 enabled 或在途命令时拒绝普通断开；Aethor_robo 零枚举；单一串口所有者；查询/命令串行化；不自动重连；历史/事件有界；sink 忽略取消也不得阻塞 transport 释放或累积悬挂发布 |
| 硬件命令 | capability、命令 ID/指纹、单在途、有界抢占、安全联锁、engineering 白名单/状态门/速度上限、超时、取消、三入口恢复、乱序终态、审计恢复/导出、SignalR 降级/REST 恢复、停止链、目标/运动包络双重校验 | Gate A 状态控制已验证；engineering 运动需操作者按手册现场执行；supervised Gate B 仍需独立授权、物理急停和低风险运动门 | 默认关闭；engineering 仅 Development + 令牌，终端无需管理员解锁；HOME/RESET/RGB/电流/PID/reboot/多行/任意 raw 零写入；关节组须 connected、fresh measured、enabled、有效 mode、六轴限位与显式 `0 < speed <= 100`，FIFO 只返回 `queued + deviceQueued`；supervised 到位仍须连续实测收敛；同 ID 不重复物理执行；所有串口所有权等待有界；停止响应未知继续锁存；去使能须 `#GETENABLE=0` |
| 动作文档（6A） | Schema/Zod、来源、限位、文件上限、显式保存、持久化恢复、导入冲突、dirty guard、导出、三档 E2E | 禁止访问串口 | 只恢复校验通过的 V1；SHOWCASE/人工/实测不混淆；刷新恢复已保存库；页面零硬件请求且 runner 不存在 |
| 动作执行内核（6B-S） | fake command port、单 owner、逐点确认、弱证据、取消/停止、checkpoint 恢复、并发、超时、dispose | 禁止访问串口 | 无 DI/API/UI/RobotGateway adapter；逐点只消费 `completed + feedbackConfirmed`；到位后才等待；异常至多一次有界停止；未确认停止不显示 Stopped；恢复绑定 revision/session/计划指纹 |
| 动作执行接线（6B-H） | 运行计划 wire contract、真实 adapter、命令审计恢复、断线与未知结果 | Gate B 后监督执行低风险短动作 | 不预灌 FIFO；不以固定 sleep 或 ACK 判断完成；停止后不遗留待发队列；页面和后端均有运行态与冲突命令保护 |
| 示波/终端 | 18 路有界 buffer、重复/乱序/缺口、可见性刷新节流、ECharts 生命周期、过滤、CSV/文本导出、视图清空、direct 白名单与状态门 | Phase 7B 验证真实帧、资源曲线与故障恢复；engineering 发送按独立手册 | 来源和单位字段存在；单路 ≤2400、总计 ≤43200；网关空缓冲不回填 SHOWCASE；离线编辑不产生伪 TX/RX；只有网关返回结果和协议帧才显示真实发送；120s 后真实资源仍有界 |
| 桌面壳（8A） | bridge、参数、令牌、有界日志/性能探针、诊断包、窗口恢复、进程监督、便携包清单、Profile 法律/溯源闭包、生产依赖/SPDX 清单、并发打包门、离线 smoke、实际 WebView2 | 禁止连接串口 | 浏览器不伪造原生能力；诊断包只含说明、清单和最多五份有界脱敏日志，取消/失败不留半成品；性能采样 60 秒 single-flight，只保留规范化工作区、白名单 Web 指标及宿主/WebView2/可空网关的受跟踪聚合值，进程句柄即时释放且异常停止，完整 URL 不落盘；同版本/Runtime 并发打包失败关闭；manifest 与实际文件集合完全相等；两个 Profile NOTICE/provenance 与第三方 SPDX/摘要/法律附件缺失时失败关闭；组件、PURL、关系和缺口计数一致；命令策略关闭；REST/SignalR 成功；正常退出不留桌面/网关进程 |
| 桌面发布（8B） | 实际窗口句柄 DPI/Per-Monitor V2/可见范围、WebView2 Stable-only 前置条件、第三方与模型许可完整性、四档 DPI、多显示器、安装/升级/卸载、签名、受控崩溃恢复 | Windows 真机与独立监督硬件门 | 依赖正文缺口以 `third-party-license-incomplete`、模型条款缺口以 `model-redistribution-incomplete` 失败关闭；仓库补充正文必须绑定精确组件版本、包完整性和不可变上游来源；每档 DPI 必须与 96/120/144/192 实测一致且窗口可见；Runtime 失败先于网关启动且不自动下载；网关崩溃立即阻断且只允许显式离线重启；干净 MSI 候选可修复/升级；用户数据默认保留；退出不留后台进程，COM4 句柄有监督释放证据 |
| Aethor_robo 控制台（A0） | `/console` 路由、旧 `/twin` 重定向、全局 Profile 切换、14 轴独立 store、左右臂 tab、资产加载、三档截图、零网络/零命令 | 禁止访问串口 | 页面只操作两组七轴本地草稿；读取/下发/软件急停固定禁用；永不显示真实连接/反馈/使能；根文档无溢出且模型可见 |

## 实机安全门

任何实机阶段开始前必须记录：操作者、机械臂周围净空、物理急停可达、供电状态、当前姿态、串口标识和测试命令范围。未经用户现场确认，不得自动打开 COM4 或发送运动/使能命令。

每次验收保存命令、时间、环境、预期、实际结果和日志路径。失败项必须保留原始证据，不能只写“已修复”。

## Phase 6A 离线动作编辑证据（2026-08-09）

- `pnpm test`：shared 87、frontend 116、C# 46，共 249 项通过；ActionProgram 覆盖 Schema/Ajv、Zod、限位/DOF/模式/来源、未知版本、1 MiB 文件上限、64 文档/4 MiB 本机库边界、显式保存/revision、冲突、持久化隔离、dirty guard、预览和对象 URL 清理。
- `pnpm typecheck` 与 `pnpm build` 通过；Vite 2617 modules，.NET Release 0 warning/0 error。
- 三档 Edge E2E 39/39 通过；动作工作流覆盖创建、编辑、显式保存、刷新恢复和零 fetch/XHR/WebSocket，请求路径与运行按钮保持禁用。
- 紧凑视口动作页和三档页面边界均无根 document 溢出；五个工作区的安全状态、3D 资源释放与当时的三维预览视觉基线继续通过。
- 未打开 COM4、未启动网关、未发送查询/状态改变/运动命令；控制预检明确为 `serialPortOpened=false/networkRequestSent=false`。
- 该次 Phase 6A 证据采集时 6B 尚未开始；当前新增的 6B-S 也只有 fake-port 软件内核，仍不能证明动作可运行或替代 Phase 5 Gate B/6B-H。

## Phase 7A 有界实时观测证据（2026-08-09）

- `pnpm test`：shared 87、frontend 135、C# 46，共 268 项通过。新增覆盖环形时间/容量淘汰、12000 帧合成长测、来源派生、session 隔离、重复/倒序/缺口、刷新节流、单位分轴、ECharts 单实例释放、CSV/文本导出、协议去重、终端清空和断线解锁撤销。
- 10 分钟 × 20 Hz 合成输入后单路保持 2400 点、18 路保持 43200 点；图表可见刷新 100 ms、隐藏刷新 1000 ms。该结果证明软件容量边界，不是浏览器 heap 或真实 COM4 长测。
- `pnpm typecheck` 和 `pnpm build` 通过；Vite 2623 modules，.NET Release 0 warning/0 error。三档 Edge E2E 39/39 通过。
- 人工 DOM 检查 `/scope`、`/terminal` 无 console warning/error；修复 1366×768 终端主区局部溢出后 main/toolbar/log 均 `scrollWidth === clientWidth`。
- 本次未启动网关或打开 COM4。真实持续采样、帧/审计一致性、拔线/超时/重连和资源曲线归入 7B，Phase 7 保持 `IN PROGRESS`。

## Phase 6B-S 无生产接线执行内核证据（2026-08-10）

- 11/11 fake command-port 回归通过：同一时刻仅一个 run owner，当前点模式/关节组未取得 `completed + feedbackConfirmed` 时不推进；模式确认与关节发送之间的停止竞态同样零关节调用；到位等待只发生在确认之后。
- 操作者停止、弱证据、command await 超时和内部步骤故障均终止序列并至多调用一次有界 stop-and-disable；停止未确认保持失败。dispose 复用同一路径。
- checkpoint 只接受相同 program revision、session、计划 SHA-256 和最后确认点；SHOWCASE、Aethor_robo、错误 DOF/限位和非正速度在 fake port 接管前拒绝。
- 全仓库 398 项测试与 Release build 通过；动作页当前生产构建三档 E2E 3/3 保持运行按钮禁用、零 fetch/XHR/WebSocket。
- API/前端对执行内核零引用；无 DI、运行路由、真实 RobotGateway adapter、串口打开或硬件命令。该证据不能替代 6B-H/Gate B。

## Phase 8A Windows 桌面软件门证据（2026-08-09）

- `pnpm test`：shared 90、frontend 143、gateway 52、desktop 46，共 331 项通过；`pnpm typecheck`、Vite/.NET Release build 与三档 Edge E2E 39/39 通过。
- 自包含 win-x64 包为 `development-dirty`；manifest 校验 646 个文件哈希。包 smoke 证明 gateway ready、session offline、command policy disabled、shutdown 202、进程退出，且 `serialPortOpened=false/hardwareCommandSent=false`。
- 离线网关 smoke 的真实 SignalR OPTIONS 返回 204，并只允许已声明 loopback origin 与所需客户端请求头；token 未进入日志，清理后 preflight 通过。
- 实际 WebView2 运行证明 root 挂载、REST、SignalR negotiate 与 hub 连接；该运行段 console error 0、web exception 0。最小化、最大化/还原、单实例唤起和正常关闭已人工验证；关闭后桌面/网关进程均为 0。
- 8A 当时尚未验证安装/升级/卸载、签名、100/125/150/200% DPI、真实多显示器、网关崩溃恢复或 COM4 句柄；其后完成的软件增量见下一节，Phase 8 仍保持 `IN PROGRESS`。

## Phase 8B DPI/崩溃恢复软件证据（2026-08-09）

- 桌面项目显式使用 `ApplicationHighDpiMode=PerMonitorV2`；四档 DPI 的自定义无边框 resize 命中区分别由 96/120/144/192 DPI 单测验证为 8/10/12/16 px。运行打包 exe 后以 `GetWindowDpiAwarenessContext` 读取到 `PerMonitorV2=true`，正常关闭后进程为 0。
- 网关异常退出会用原生面板阻断 WebView 控制面，显示设备状态未知并禁止自动重连；没有宿主 202 确认时，进程消失也不能让普通关闭成功。原子单向恢复状态只允许 `Normal → GatewayFailed → OfflineRestartRequested`，正常态越权请求失败，并发请求只有一个获准；恢复进程参数固定为 `--offline --web-root <validated absolute path>`，不会携带 gateway path。
- 开发包在 `commandPolicy=disabled`、session offline 且同一 gateway PID 已稳定就绪 5 秒后完成一次子网关崩溃注入。日志确认 `Gateway exited unexpectedly` 与 `only an explicit offline restart is available`，5 秒观察窗内未产生新网关或后续 `web.console/web.exception`；清理后桌面/网关均为 0，未打开串口、未发送硬件命令。
- 桌面单元测试由 46 增至 62 项并通过，其中四项覆盖恢复状态越权、单向性、重复失效和并发单一胜者。Windows 当时处于锁屏，界面工具无法激活窗口，因此该次恢复按钮点击未验证；后续解锁桌面证据见下一节。四档 DPI 目视、多显示器迁移仍未验证。
- WebView2 环境只允许 Stable channel；空/非法版本、Beta/Dev/Canary、Runtime 缺失和 loader 异常均有失败关闭测试。启动顺序在创建 WebView 环境成功后才进入网关启动；Beta-only 包 smoke 证明桌面保持在前置条件失败状态且零 gateway 进程、不自动下载，面板视觉仍归入解锁桌面人工验收。
- 重排后的正常包级生命周期读到 Stable Runtime `151.0.4129.72`，随后 gateway ready、WebView started、DOM `readyState=complete/rootChildren=1`，运行段 `web.exception=0`；正常关闭取得宿主 202，桌面/网关进程均归零。
- 全量回归为 shared 90 + frontend 153 + gateway 52 + desktop 73，共 368 项；Vite、网关与桌面 Release build 通过，0 warning/0 error。
- 实包在网关崩溃后收到普通关闭消息仍保持桌面进程存活，并记录 `Gateway already exited without a host-confirmed safe shutdown; close remains blocked`；测试清理只终止该开发包自身进程。
- 构建门将脏包、干净未签名包和干净已签名包分别限定为 `development-dirty`、`development-unsigned`、`release-candidate`；四项签名参数缺一会在输出变更前失败，脏工作树不得签名。当前无签名脏包通过 646 项哈希和离线 smoke，但只读发布校验器以 11 项问题按预期拒绝，包含 manifest 未签名和七个自有 PE 文件 `NotSigned`；没有串口或硬件命令。
- 重新校准全局视觉标尺：正文 15px、基准页标题 28px，导航/状态标签改用 UI 字体，等宽字体只保留数值与协议。当时的 Dummy 三维预览相机改由实际/目标联合包围盒和视口计算，初载、窗口变化与显式重置均可重新适配，拖动目标时不会自动跳转。浏览器实页和 Edge 45/45 均证明三档根文档无溢出；1920/2560 六轴列表无需滚动，1366 只在列表内部滚动；三张 Win32 基线已更新并二次复验。
- Profile 包回归覆盖压缩包读取前拒绝、中央目录声明膨胀、2,048 项上限、Windows 大小写冲突、64 条诊断上限、取消和旧结果竞态；设备页三档边界继续通过。该证据只证明本地结构校验，不证明 STL 内容完整或 C# 安装成功。
- ADR-0008 已锁定 MSI、Major Upgrade、默认保留 `%LOCALAPPDATA%\Aethor Studio V2`、禁止安装器强杀设备进程等边界。MSI 编译器治理、Publisher/证书、WebView2 离线 Runtime、两个干净版本的安装/修复/升级/卸载仍未关闭。

## Phase 8B 代理与恢复点击证据（2026-08-10）

- 本机存在 `HTTP_PROXY/HTTPS_PROXY=http://127.0.0.1:7877` 且没有 `NO_PROXY`。修复前三个已监听候选均在桌面健康检查超时；桌面生命周期客户端固定 `UseProxy=false` 后，只启动一个候选并取得 `/health/ready` 200，5 秒后仍为一个子网关。
- 终止精确开发包子网关后，桌面保持运行、原生阻断面板显示“设备状态未知”和“不会自动重连”，5 秒内网关仍为 0。真实点击“以离线模式重新启动”后旧 PID 退出，只出现一个带 `--offline --web-root` 的新桌面，网关为 0；清理后桌面/API 和固定 5127 listener 均为 0。
- 同一代理条件下的正常窗口关闭实际收到 host shutdown 202，并记录 `Gateway process stopped and released`；桌面/API 最终均为 0。
- 新增 proxy-free/redirect-free loopback handler 回归；当前四档 DPI 目视、多显示器、MSI 与正式签名仍不在该证据范围内。

## Phase 8B 模型分发与 DPI 采证增量（2026-08-10）

- 旧 674 文件包缺少顶层 Aethor_robo 法律入口，新 package smoke 在网关启动前以缺少 `Legal/aethor-robo-dual-7dof-NOTICE.md` 失败；release verifier 同时报告 NOTICE 与 provenance 两项 `legal-asset-missing`。
- 重建包为 676 个实际文件/675 项 manifest；`Legal/` 包含 Dummy NOTICE、Aethor_robo NOTICE 与 Aethor_robo provenance，哈希闭包和离线网关 smoke 通过。开发脏包仍因资格和七个未签名自有文件被 11 项问题拒绝，不再包含法律缺项。
- `collect-dpi-evidence.ps1` 由实际 HWND 读取 `GetDpiForWindow`、Per-Monitor V2 context、显示器工作区与窗口范围。本机 96 DPI 实测通过：1600×940 正常窗口完全位于 1920×1032 工作区，网关进程为 0；传入错误的 120 DPI 时失败并有界清理桌面/API 进程。
- 最终软件回归为 contracts 91 + frontend 172 + gateway 68 + desktop 74，共 405/405；Web 2630 modules、两个 .NET Release build 0 warning/0 error，三档生产 E2E 60/60。125/150/200%、真实多显示器与目视仍需对应 Windows 环境。

## Phase 8B 第三方生产依赖清单增量（2026-08-10）

- 第三方清单生成器对 pnpm 生产图去重、NuGet/runtime pack `.deps.json` 合并、文件型 LicenseRef、宿主路径不泄漏、确定性输出和缺失文本判定有独立 Node 回归；生成文档通过 SPDX 官方 2.3 JSON Schema。整仓为 406/406，完整三档生产 E2E 60/60。
- 当前开发包为 697 个实际文件/696 项 manifest；disabled 与显式 engineering 两种离线 smoke 验证 92 个组件（87 npm、5 NuGet/runtime pack）、6 个锁定上游正文、0 个依赖文本缺口、2 个模型条款缺口、shutdown 202、进程退出、零串口/零硬件命令。
- 只读发布 verifier 不再报告 `third-party-license-incomplete`，按预期以 `model-redistribution-incomplete` 列出两个内置 Profile；连同脏工作树、开发资格和七个未签名文件共 12 项问题拒绝当前包。该门证明工程记录和失败关闭，不是模型法律审核完成证据。
- 双 Profile 增量后包内 54 个 Web 文件与当前 `dist/` 逐项哈希一致；整仓 411/411、三档 E2E 63/63。当前包离线 smoke 继续通过，发布 verifier 以 12 项资格/签名/许可问题拒绝且 `filesystemMutationPerformed=false`；实际 96 DPI 采证继续为 Per-Monitor V2、零网关。

## Phase 8B Desktop 串口目录、会话 owner 与诊断探针增量（2026-08-11）

- 失败复现由桌面日志闭环：壳创建随机 gateway `64050`，生产 Web 却请求固定 `5127`；后者的 CORS 错误是错误目的地的结果。有效 Desktop bootstrap 现覆盖 `.env.local`，离线 null 也不回退；production/e2e 清空固定配置，打包扫描本机开发 URL/令牌并失败关闭。
- 顶栏与设备页的端口状态、选择和错误由单一 runtime owner 持有；并发 `refreshSerialPortCatalog` 合并为一个 `listSerialPorts` 调用。40 项针对性前端回归包含 single-flight、显式选择/连接、错误端口释放、断开重置和 bootstrap 权威性。
- UUID `X-Aethor-Operation` 关联前端 `frontend.serial.catalog.started/completed/failed` 与网关 Event 1006/1007/1002；终态只记录 duration/result count/failure category。ASP.NET 成功请求噪声降到 Warning，产品事件和宿主生命周期保留。
- 顶栏与设备页的连接/断开由一个 shared owner 仲裁，相同意图 single-flight、冲突意图零第二请求；前端 `frontend.serial.session.*` 与网关 Event 1008/1009/1010 使用同一 operationId，并共享 busy/error 状态。
- 该串口目录/会话探针增量当时的自动化门为 contracts 93/93、frontend 193/193、gateway 83/83、desktop 84/84、legal inventory 6/6，共 459/459；strict TypeScript、2642-module production build 与三档生产 E2E 63/63 通过。根 `pnpm test` / `pnpm build` 已在旧网关和当前桌面同时运行时通过，唯一 `.run-*` artifacts path 全部自动清理，显式覆盖输出根以退出码 2 拒绝。带 Dummy bootstrap 的 Desktop 新会话固定从 `Dummy` 启动，确保唯一 coordinator 在用户操作前只读枚举；浏览器 Profile 恢复不受影响。`Runtime.consoleAPICalled` 探针解析器拒绝普通 console、扩展字段、非法终态和超界输入。
- 697 文件开发包的 disabled/engineering smoke 均通过 serial OPTIONS、只读枚举 COM1/COM4，以及不支持 Profile connect 的 400/operationId 关联检查；验证在 transport 创建前返回，日志无 `serial.opened`。实际工程桌面还得到前端/网关 operationId 一致、`ResultCount=2`、零 Web 错误。session 保持 offline，shutdown 202，进程退出，`serialPortOpened=false / hardwareCommandSent=false`。该证据不表示 COM4 可安全打开，也不解决旧 5127 session 的 `disconnecting / motor unknown` 状态。
- 277 字符深 staging 路径复现 Windows 清理失败；短名 `.stg-*` / `.dn` 后同一独立输出打包成功，旧失败 staging 经父目录与名称双重校验后清理。
- 3D DPR 纯函数覆盖普通、高 DPI 大画布、constrained 和非法输入；三档生产 E2E 对实际画布断言 DPR 1–1.75 且 framebuffer ≤350.5 万像素，同时继续证明空闲帧收敛、交互恢复与零硬件请求。
- Desktop 性能探针覆盖六值工作区分类、非可信来源/未知路由降级、白名单归一化、秘密/未知字段丢弃、缺失/重复/越界/非整数、不可能 heap/聚合关系，以及重复 PID、快照后进程退出、进程身份重叠和 256 项上限。新标准包已取得 `workspace=console` 与 `workspace=terminal` 实样本；旧包三次控制台/终端短周期往返保持 5 个 WebView2 进程且两类工作集各自有界，浏览器三次往返的实时元素和 Canvas 数也精确返回基线。该短时样本证明采集、归一化、路由释放和落盘链有效，不作为 Phase 7B 长测或泄漏阈值验收。
- 最新自动化门为 contracts 93/93、frontend 197/197、gateway 88/88、desktop 110/110、legal inventory 6/6，共 494/494；2643-module production Web 和两个隔离 .NET Release build 通过，0 warning/0 error。网关新增打开总超时、调用方取消和底层同步 Open 忽略取消三类回归：请求在 1 秒测试门内收束，候选连接唯一 dispose、session offline、host shutdown 可接受，第二次打开不创建 transport；配置范围 `100–30000 ms` 失败关闭。重建 `development-dirty` 包仍为 697 个实际文件/696 项 manifest，disabled 与 engineering offline smoke 均验证 COM1/COM4 目录、session offline、shutdown 202、进程退出和零硬件写入。最终工程会话从该包启动后只读返回 2 个端口，运行段 `serial.opened/connect/hardware command/Web error=0`。实采阶段操作者此前对被旧进程占用的 COM4 发起一次连接，`Open()` 返回 AccessDenied；真实打开停滞/取消路径没有再次触碰 COM4，仍以 fake transport 边界测试为证据。

## Phase 8A 诊断包增量（2026-08-11）

- `DesktopBridgeV1` 新增 `exportDiagnostics`，浏览器能力固定为 false；原生导出以 120 秒为界并维持同动作 single-flight。设备页覆盖不可用、导出中、完成、取消/失败状态，只有宿主明确返回 true 才显示完成。
- 导出器覆盖固定条目和顺序、单文件/总量边界、重复或未知日志、已有目标保护、显式覆盖、取消、异常清理、令牌多种表示与用户目录遮蔽，以及 manifest 字节数和 SHA-256。日志快照与应用写入共用锁，轮转不会产生半份快照；目标目录内临时文件完成后才原子移动。
- 当前整仓为 contracts 93/93、frontend 201/201、gateway 88/88、desktop 118/118、legal inventory 6/6，共 506/506；strict TypeScript、2643-module production Web 和两个隔离 .NET Release build 通过，三档生产 E2E 63/63。浏览器三档布局检查确认诊断卡片无溢出或重叠，且按钮按预期禁用。
- `development-dirty` Windows 包重建为 697 个实际文件/696 项 manifest。disabled 与 engineering offline smoke 均完成 gateway ready、串口目录预检、session offline、shutdown 202 和进程退出；本次系统仅枚举到 COM1，未打开串口或发送硬件命令。自动化已覆盖原生保存成功、取消和失败边界，本条不冒充人工点击系统保存对话框的目视验收。

## Phase 5/7 串口资源压力增量（2026-08-10）

- fake transport 正常连接/有效轮询/断开由 3 次提高到 32 次；每个 transport 恰好 open/close/dispose 一次。
- 32 次读取忽略 cancellation 的关闭循环在 10 秒总门内回到 offline；阻塞写入即使忽略 cancellation，关闭仍先释放句柄并在 1 秒门内结束轮询，没有残留 owner。
- 连续 64 个完整 `#GETJPOS → #GETMODE → #GETENABLE` 周期后关节序号持续推进，TX 均属于查询白名单，协议历史严格保持 64 条配置上限，随后唯一关闭和释放。
- 聚焦只读网关 14/14、gateway 71/71、整仓 414/414、strict TypeScript 与完整 Release build 通过；Web 2639 modules、两个 .NET build 0 warning/0 error。该证据没有打开 COM4，不证明真实 Windows 串口驱动长测、拔线、浏览器 heap 或网关工作集；这些仍属于 Phase 7B。

## Phase 7B 只读采证工具软件门（2026-08-10）

- `soak-readonly.ps1 -ValidateOnly` 返回 gateway/network/serial/hardware command/filesystem mutation 全部 false，且没有创建 `TestResults/phase-07b-readonly-soak` 运行目录。
- 缺固定授权短语时，即使其余五项 switch 已提供，也在证据目录和进程创建前退出；Aethor gateway process 与 5127 listener 保持 0。
- 静态安全门锁定 Dummy、三个查询白名单、60–14400 秒持续时间、1–10 秒采样、`commandPolicy=disabled`、空 `supportedCommands`、精确自有 PID 清理，并拒绝 `/commands/`、raw SerialPort、WriteAsync、supervised、taskkill 和跨 shell 强杀。
- 工具固定输出 `resourceAcceptanceEvaluated=false / browserHeapCaptured=false / hardwareFaultInjectionPerformed=false / phase7bCompleted=false`；软件门通过不能标成实机长测完成。
- OperationalScriptSafetyTests 5/5、整仓 contracts 91 + frontend 177 + gateway 72 + desktop 74 + legal inventory 1，共 415/415、strict TypeScript 和完整 Release build 通过；Web 2639 modules、两个 .NET build 0 warning/0 error。真实运行路径未执行。

## Phase 5 软件门与 Gate A 证据（2026-08-09）

- `pnpm test`：shared 85、frontend 96、C# 46，共 227 项通过；新增前端覆盖三入口统一终态、顶部 STOP 响应丢失、乱序结果水位、SignalR 降级/REST 恢复、陈旧实测姿态保留、跨路由全局告警、审计有界恢复、session 切换、联锁重建/清除、终态后重取和 JSON 导出资源清理；C# 覆盖接管前取消零写入、接管后断开仍可恢复唯一终态，以及 shutdown 等待 runner 后释放 transport。
- `pnpm typecheck`：共享契约与严格前端 TypeScript 通过。
- `pnpm build`：Vite/Profile 与 .NET Release 通过，C# 0 warning/0 error。
- 三档 Edge E2E 36/36 通过；另人工检查 `/twin` 与 `/devices`：1366×768、1920×1080、2560×1440 无页面级横向溢出，控制台无 error/warning；后端缺席时所有硬件按钮保持禁用并显示原因。
- `gateway:preflight:control` 对已核对的 COM4 身份返回通过，同时声明 `hardwareAccessAuthorized=false`、`gatewayStarted=false`、`serialPortOpened=false`、`networkRequestSent=false`，且四项运动包络均未注入。
- Gate A 在 COM4 上完成一次使能、停止去使能、模式 1–3 和恢复模式 2；6 条命令结果均为 `completed + feedbackConfirmed`，0 条关节运动目标，断开前 measured/valid、disabled、mode 2。
- 清理后 gateway 进程、5127 listener、监督配置与令牌均不存在；证据位于被 Git 忽略的 `TestResults/phase-05-com4/20260809T060050Z/`。
- 当次 256 帧协议环被轮询填满，早期原始命令 TX 被覆盖。命令审计现已独立保存请求快照和实际成功写入 transport 的 payload；该改进不追写旧证据。
- Gate B 未执行；四参数运动包络、低风险目标和独立现场授权仍是退出门。
