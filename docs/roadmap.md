# Aethor Studio V2 多机器人阶段路线图

## 交付原则

每个阶段只在退出条件全部通过后标记 `DONE`，并产出一份真实 handoff 和一个本地阶段完成提交。完成阶段在 fetch 确认远端未领先或分叉后普通 push 到 `origin` 对应分支；`IN PROGRESS`、`BLOCKED` 和普通 checkpoint 不自动 push。下一阶段开始前必须阅读本路线图、公共上下文、上一阶段 handoff 和相关权威接口文档，并分别记录对 Dummy 与 Aethor_robo 的影响。

## 双产品线边界

- Dummy：一台六轴机械臂，继续沿用阶段 0–8；动作编排、示波、串口终端和 C# 网关目前均为 Dummy 专属。
- Aethor_robo：一台空间机器人，控制对象只有左、右两个七轴机械臂；六个车轮只进入模型展示。固件与统一指令集未完成前，不接入 Dummy 网关，不声明连接、反馈、使能、停止或下发能力。
- 共享 UI、Profile Schema、Three.js 场景或桌面壳的阶段，handoff 必须同步 Aethor_robo 影响；协议和实机阶段必须明确写出“不适用”或独立验收状态，不能静默复制 Dummy 假设。

| 阶段 | 状态 | 目标 | 核心交付物 | 退出门槛 |
|---|---|---|---|---|
| 0 基线与目录治理 | DONE | 以 D 盘为唯一工作副本，完成规范目录迁移和可复现基线 | `apps/services/shared/docs`；统一脚本；更新链接；基线报告 | typecheck、unit、build、4 路由 E2E 通过；C 盘副本未被修改；无串口访问 |
| 1 协议、契约与安全状态机 | DONE | 把固件事实转为可测试的协议/会话契约 | parser/formatter、命令白名单、状态机、fake serial、Schema | 77 项共享契约测试与 33 项前端测试通过；模式仅 1–3；未打开 COM4 |
| 2 UI 字体、比例与信息架构 | DONE | 修复字号、密度和空间比例，形成展示级工业控制台 | token、响应式布局、状态组件、五工作区信息架构、视觉基线 | 113 项单元测试与三档视口 21 项 E2E 通过；无关键裁切、重叠和跳动 |
| 3 Dummy 六轴三维预览基础 | DONE | 实现类似 Robot Viewer 的关节直接操作，仅 FK 预览 | 关节拾取、约束拖动、轴/限位反馈、实体/幽灵隔离 | 六关节 URDF 原点/轴/限位、拖动零发送、故障降级与重复挂载资源证据通过 |
| 4 C# 基础与只读 COM4 | DONE | 建立 .NET 10 网关，只枚举/连接/读取真实状态 | 分层服务、串口生命周期、REST/SignalR、会话令牌 | fake serial 集成测试通过；监督下手动连接 COM4；无运动命令 |
| 5 安全硬件控制 | IN PROGRESS | 接入使能、停止、受约束模式 1–3 和整组关节下发；HOME/RESET 按固件证据降级 | v1.2 契约、命令仲裁、受限 engineering direct、目标校验、实测到位、前端能力门、监督 runbook | 软件门与 Gate A 已通过；engineering 仅供 Development 人工调试，关节 FIFO 只表示 queued；Gate B 未执行，任何失败不显示成功 |
| 6 动作编排与单点示教 | IN PROGRESS | 版本化动作 JSON、点位编辑/采集和逐点执行 | 6A editor 已验证；6B-S 无生产接线执行内核已验证；6B-H 硬件接线未开始 | 6A/6B-S 零硬件路径；6B-H 不用固定 sleep 冒充完成，暂停/停止语义与固件能力一致 |
| 7 实时示波、终端与故障恢复 | IN PROGRESS | 将静态工具升级为有界实时观测工作台 | 7A 软件门已验证；7B 真实网关长测未开始 | 来源/单位准确；内存有界；断线和陈旧反馈可见且不可下发 |
| 8 WebView2、发布与最终交接 | IN PROGRESS | 完成 Windows 桌面壳、打包、DPI 和最终验收 | 8A 桌面壳/便携包已验证；8B 安装签名/DPI/恢复/最终 handoff 未完成 | 三档分辨率与 Windows DPI 通过；安装/升级/卸载演练；最终页面打开 |

## Aethor_robo 并行接入阶段

| 阶段 | 状态 | 目标 | 当前事实 | 退出门槛 |
|---|---|---|---|---|
| A0 模型接入与双臂控制台 | DONE | 规范化整机资源，并以左右两组七轴提供可选/可拖动本地 FK 预览 | 23 links、22 joints、23 STL 已迁移；逐资产 SHA-256 溯源门、全局 Dummy/Aethor_robo Profile 切换、geometry/幽灵材质去重、目标 collision 零绘制、差量关节更新、按需渲染、相机按需重算、14 个臂关节分组、整机/双臂取景和一次同源资产中断恢复已完成；`/console` 无硬件发送路径 | 439 项软件回归、三档 63/63 视觉/交互、空闲帧收敛与资源释放回归通过；模型和 handoff 落盘；阶段提交/远端一致 |
| A1 固件与协议契约 | BLOCKED | 定义独立的七轴组命令、反馈、停止、能力和错误语义 | 硬件与固件尚未完成；adapter 为 `aethor-robo-pending` | 固件提交与指令集可追溯；parser/formatter/vectors/状态机通过；不得复制 Dummy 协议 |
| A2 只读网关与观测 | NOT STARTED | 人工连接、双臂反馈、协议日志和有界示波 | 没有串口/传输/反馈契约 | fake transport、loopback/token、只读监督 runbook 和实机授权验收通过 |
| A3 安全控制与动作编排 | NOT STARTED | 独立双臂整组下发、停止、到位确认和版本化动作程序 | 当前文档与 6B-S 执行内核均只支持 Dummy 六轴 | 可信限位/速度/完成/停止语义、逐臂命令仲裁、监督低风险实机门全部关闭 |

## A0 完成结果

- `aethor-robo-dual-7dof` 的规范化 URDF、23 个 STL、双七轴分组和逐资产 SHA-256 溯源门已落盘；来源包缺少完整 BSD 条款的限制继续保留，不把完整性验证冒充为分发授权。
- 当前退出门为 contracts 93 + frontend 184 + gateway 82 + desktop 79 + legal inventory 1，共 439/439；strict TypeScript、Web 2639 modules、隔离 gateway Release 与 desktop Release 构建通过，0 warning/0 error；三档生产 E2E 63/63 通过。
- E2E 覆盖双 Profile 隔离、左右七轴本地编辑、零硬件路径、三档无关键溢出、同源资产一次恢复、23 份 geometry 共享、按需帧收敛及重复挂载资源释放。本轮没有新启动或访问网关，没有枚举或打开串口，也没有发送硬件命令；既有未知 COM4 会话保持原样。
- A1 继续因固件和独立七轴协议证据缺失保持 `BLOCKED`；A0 完成不会为 Aethor_robo 声明连接、反馈、使能、停止或下发能力。

## Phase 4 验收结果

- 2026-08-09 在现场授权下只连接 COM4 一次，只发送 `#GETJPOS/#GETMODE/#GETENABLE`，取得 6 个有限关节角、模式 2 和未使能状态；没有运动或状态改变命令。
- 断开返回 offline，运行日志记录资源释放且无再次打开；post-cleanup 无网关进程和 5127 listener。直接 OS 句柄检查因 `handle.exe` 未安装而不可用，限制已写入 Phase 4 handoff。
- 原采证执行器因 Windows PowerShell 数组包装误判失败；原始证据保留，离线归一化验证 6 个真实帧通过，仓库脚本和回归测试已修正。Phase 5 必须重新取得硬件授权。

## Phase 5 当前结果

- RobotGatewayV1 升级到 1.2：保留结构化命令、稳定结果/证据码、有界命令审计和 SignalR 终态，并新增仅 Development + 本机令牌可声明的受限 `engineering` direct capability。
- C# 已实现单在途、幂等、超时、停止抢占、目标/限位/速度/状态双重校验；关节组只有在配置速度、到位容差、连续稳定窗口和总超时后才声明能力，并以实测六轴误差持续收敛返回完成。前端同步显示并校验该完整包络。
- Gate A 已在 COM4 上验证使能、停止去使能、模式 1–3 和恢复模式 2，6 条命令结果均为 `completed + feedbackConfirmed`；未发送关节目标，断开前为 measured/valid、disabled、mode 2，清理后 gateway 进程和 5127 listener 均为 0。
- 实机运行暴露协议环会被高频轮询覆盖早期命令 TX；命令审计已增加有界请求快照、请求指纹和实际成功写入 transport 的 payload。旧 Gate A 证据不追写，后续按命令即时采证。
- 三个前端命令入口已统一终态/REST 审计恢复语义；全局软件急停响应丢失会锁存未知结果。成功 STOP 使用 session 级时间水位抵抗迟到乱序终态和截断历史。
- 串口防堵软件门已补齐：普通命令与 STOP 获取串口所有权均受 `CommandTimeout` 限制；STOP 未取得所有权会返回未确认，人工断开拒绝遗留在途硬件命令，宿主清理先关闭句柄解除不响应 token 的原生读写再等待任务终态。fake transport 现覆盖 32 次正常循环、32 次忽略读取取消的关闭循环、阻塞写入关闭顺序和 64 个完整轮询周期；该门仍不替代 Phase 5 Gate B 或 Phase 7B 的真实驱动故障注入。
- 实时事件发布也已从 transport 生命周期解耦：单次 sink 发布和关闭排空均有界；不合作 sink 超时后停止事件泵，网关仍先释放串口并退出，REST 快照继续作为权威恢复源。
- SignalR 故障会立即把 Dummy measured session/joint 降为 stale；重连后只有 REST capabilities/session/joint/protocol 恢复成功才重新信任实时数据。五个工作区共享不可忽略的 Dummy 全局告警，普通控制持续锁定；Aethor_robo 控制台仍保持 `MODEL ONLY`，不会把 Dummy 状态解释为本机反馈。
- `gateway:preflight:control` 和 [Phase 5 监督式控制手册](runbooks/phase-05-supervised-control-com4.md) 已更新为 `GATE A VALIDATED / GATE B BLOCKED`。
- 全量 shared 85 + frontend 96 + C# 46，共 227 项测试通过；strict TypeScript、Vite/.NET Release 构建和三档 Edge E2E 36/36 通过，C# 0 warning/0 error。
- Gate B 未授权、未执行，Phase 5 不能标记 DONE，也不创建阶段完成提交。
- 固件 HOME/RESET 在协议线程中阻塞到动作结束，可能阻止及时 STOP；两项在生产 capabilities 中默认排除。关节组在取得可追溯的完整四参数运动包络前默认排除。
- 2026-08-10 最新软件回归为 contracts 91 + frontend 182 + gateway 72 + desktop 74 + legal inventory 1，共 420/420；strict TypeScript、Web/.NET Release build 与三档生产 E2E 63/63 通过。新增全局手动串口入口、跨入口 active port 同步和新 session 首个可信实测帧的一次性目标基准对齐；交付前只启动 `commandPolicy=disabled` 本机网关，session offline，COM1/COM4 可见但均未打开。

## Phase 6 当前结果

- 按 [ADR-0005](decisions/0005-offline-action-document-boundary.md) 拆为 Phase 6A 离线文档、Phase 6B-S 无生产接线执行内核与 Phase 6B-H 实机接线；Gate B 的外部阻塞不再冻结纯软件语义验证，但不能被 6A/6B-S 绕过。
- Phase 6A 已实现 `ActionProgramV1` Schema/类型/示例、程序与点位编辑、顺序调整、来源真实的单点采集、目标草稿预览、显式本机保存、导入导出、dirty guard 和损坏存储隔离。
- `/actions` 没有 `RobotGatewayV1` 命令调用、串口写入、运行队列或定时完成路径；运行按钮固定为 `PHASE 6B LOCKED`。
- 全量 shared 87 + frontend 116 + C# 46，共 249 项测试通过；strict typecheck、Vite/.NET Release build 和三档 Edge E2E 39/39 通过。
- Phase 6B-S 已实现 C# Application 独立 owner：非 SHOWCASE Dummy 计划逐点执行，模式与关节组均只接受 `completed + feedbackConfirmed`；到位后才等待；命令异常/超时/停止只进入一次有界 stop-and-disable；同 revision/session/计划指纹的 checkpoint 才能从最后确认点后恢复。当前只有 fake port，未注册 DI、API 或 UI。
- Phase 6B-H 仍为 `NOT STARTED`，依赖 Phase 5 Gate B；真实 adapter、运行计划 wire contract、API、审计恢复和监督实机执行均不存在。
- Phase 6 总体仍为 `IN PROGRESS`，不创建 `phase(06)` 完成提交。

## Phase 7 当前结果

- 按 [ADR-0006](decisions/0006-live-observability-boundary.md) 拆为 7A 软件门和 7B 实机长测；只读观测不依赖 Gate B 运动包络，但真实串口仍需新鲜现场授权。
- 7A 已实现 18 路、每路 2400 点/120 秒的有界历史，默认 60 秒窗口；采集与 10 Hz/1 Hz 可见性刷新分离，ECharts 实例跨数据更新复用。
- 网关模式不再因缓冲为空而回退 SHOWCASE；示波/终端显示 measured/waiting/stale/idle 的真实状态。终端日志限 256 帧、去重，清空只影响当前视图。
- 终端不再使用管理员/专家解锁。`engineering` 网关下可直接发送 Dummy 单行白名单；C# 仍独占串口并二次校验 session、状态、模式、六轴限位和显式速度。HOME/RESET、RGB、电流/PID、reboot、多行及任意 raw 均拒绝。
- engineering 关节组只有固件 FIFO 入队证据，结果必须显示 `queued / deviceQueued`，不能写成到位、完成或安全；正式 `supervised` Gate B 仍依赖可追溯四参数运动包络和独立实机验收。
- 错误 COM 口造成 `stale/unknown/faulted` 时允许人工释放会话；只有明确 `motor=enabled` 或存在在途命令时拒绝普通断开。
- 当前软件回归为 contracts 93 + frontend 182 + gateway 79 + desktop 74 + legal inventory 1，共 429/429；strict TypeScript、Web/.NET Release build 0 warning/0 error，三档生产 E2E 63/63。E2E 使用固定无网关 mode，不继承本机 `.env.local`；`pnpm dev:engineering` 已实跑验证 v1.2 engineering/offline，页面仅枚举 COM1/COM4。本次未打开 COM4、未发送任何硬件命令。
- 10 分钟 × 20 Hz 合成长测达到单路 2400、总 43200 点上限；全量 shared 87 + frontend 135 + C# 46 共 268 项、build 与三档 E2E 39/39 通过。
- 7B 干净只读基线工具已就绪：显式授权与五项现场确认缺一即在进程/证据目录创建前失败；`-ValidateOnly` 已证明零网络、零进程、零串口、零文件变更。真实路径固定 command policy disabled、Dummy 与三个查询白名单，并有界记录 sequence、协议、working set/private memory/handle/CPU 和最终释放。该工具尚未连接 COM4，且固定声明资源阈值、浏览器 heap、故障注入和 Phase 7B 完成均未评估。
- 7B 未授权、未执行；真实采样/资源曲线、拔线和恢复证据缺失，Phase 7 不能标记 DONE，也不创建阶段完成提交。

## Phase 8 当前结果

- 按 [ADR-0007](decisions/0007-desktop-process-and-bridge-boundary.md) 拆为 8A 桌面软件门与 8B 正式发布门；8A 不依赖 COM4 或 Gate B，可在命令关闭的离线边界独立推进。
- 8A 已实现 WinForms/WebView2 自定义壳、单实例、严格 `DesktopBridgeV1`、随机 loopback 端口/令牌、网关健康监督、Job Object 回收、有界日志、窗口恢复和自包含 win-x64 便携包。
- 实际 WebView2 验证发现并修复 bridge 初始化顺序与 SignalR CORS 请求头遗漏；修复后 REST、negotiate 与 hub 连接成功，运行段无 console error/web exception，正常退出后桌面和网关进程均为 0。
- 全量 shared 90 + frontend 143 + gateway 52 + desktop 46，共 331 项测试通过；strict typecheck、Vite/.NET Release build 与三档 Edge E2E 39/39 通过。包 smoke 校验 646 个文件哈希且保持零串口/零硬件命令。
- 8B 软件增量已固定 `PerMonitorV2` 和 WebView2 Stable-only 前置条件。WebView2 缺失或非 Stable 时在网关启动前失败关闭，原生面板不联网下载并可安全退出。桌面对自有 loopback 网关的 readiness/shutdown 固定绕过代理；在本机代理存在且无 `NO_PROXY` 时，单一候选已取得 ready。网关崩溃会阻断工作区，真实恢复按钮点击已验证旧实例退出、唯一 `--offline` 桌面启动且零网关；没有宿主 202 时普通关闭继续拒绝。命令关闭/offline 注入证明确认零串口/零硬件命令。`.aethor-robot` 预览也已加入 ZIP 膨胀、条目、文本资源、Windows 路径和旧任务取消边界。
- 当前包的 `Legal/` 已集中闭合 Dummy/Aethor_robo NOTICE 与 Aethor_robo provenance，并从真实生产依赖生成 SPDX 2.3 清单：93 个组件（88 npm、5 NuGet/runtime pack）及对应包内法律文本均进入 manifest。重建包为 688 个实际文件/687 项 manifest 并通过离线 smoke；6 个组件仍缺包内许可正文，发布 verifier 以 `third-party-license-incomplete` 明确拒绝，不能标作正式候选。实际 DPI 采集脚本以 `--offline` 从窗口句柄验证 awareness、DPI、显示器工作区与恢复可见范围；本机 96 DPI 通过且零网关，120/144/192 与真实多显示器仍待对应环境验收。
- ADR-0008 已锁定 MSI、Major Upgrade 与默认保留独立应用数据根；第三方许可缺口处置、MSI 工具治理、Publisher/证书、WebView2 离线 Runtime、安装/修复/升级/卸载、四档 DPI/多显示器目视、7B/8B 监督硬件回归和最终 handoff 仍未完成，因此 Phase 8 不标记 DONE、不创建阶段完成提交。

## 阶段依赖

```text
0 → 1 → 4 → 5 Gate B ─────────→ 6B-H ───┐
         ├────────→ 7A → 7B ────────────┼→ 8B final
         └────────→ 8A desktop software ─┤
    └→ 2 → 3 → 6A → 6B-S ──────────────┘
```

Phase 6A、Phase 6B-S、Phase 7A 和 Phase 8A 可在各自零硬件写入边界内独立推进；6B-S 不得注册到生产运行时。Phase 7B 只读实机长测需要新鲜授权但不依赖运动 Gate B。8B 最终发布门不能用 8A 便携开发包替代。任何真实动作仍必须严格经过 Phase 4/5、Gate B 和 6B-H。详细执行任务见 [阶段提示词](prompts/README.md)，验收证据结构见 [验收矩阵](testing/acceptance-matrix.md)。
