# Aethor Studio V2 多机器人阶段路线图

## 交付原则

每个阶段只在退出条件全部通过后标记 `DONE`，并产出一份真实 handoff 和一个本地阶段完成提交。完成阶段在 fetch 确认远端未领先或分叉后普通 push 到 `origin` 对应分支；`IN PROGRESS`、`BLOCKED` 和普通 checkpoint 不自动 push。下一阶段开始前必须阅读本路线图、公共上下文、上一阶段 handoff 和相关权威接口文档，并分别记录对 Dummy 与 Aethor_robo 的影响。

## 双产品线边界

- Dummy：一台六轴机械臂，继续沿用阶段 0–8；动作编排、示波和生产 C# 网关目前为 Dummy 专属。串口终端外壳已共用，但真实 TX/RX 仍只有 Dummy runtime。
- Aethor_robo：一台空间机器人，控制对象只有左、右两个七轴机械臂；当前 Profile 不包含独立动量轮链路。可追溯固件基线已存在，但正式入口 `aethor-text-v1` 与 Studio 候选 `aethor-arm-ascii-v1` 不同；完成协议决策和独立 adapter 前，不接入 Dummy 网关，不声明连接、反馈、使能、停止或下发能力。
- 共享 UI、Profile Schema、Three.js 场景或桌面壳的阶段，handoff 必须同步 Aethor_robo 影响；协议和实机阶段必须明确写出“不适用”或独立验收状态，不能静默复制 Dummy 假设。

| 阶段 | 状态 | 目标 | 核心交付物 | 退出门槛 |
|---|---|---|---|---|
| 0 基线与目录治理 | DONE | 以 D 盘为唯一工作副本，完成规范目录迁移和可复现基线 | `apps/services/shared/docs`；统一脚本；更新链接；基线报告 | typecheck、unit、build、4 路由 E2E 通过；C 盘副本未被修改；无串口访问 |
| 1 协议、契约与安全状态机 | DONE | 把固件事实转为可测试的协议/会话契约 | parser/formatter、命令白名单、状态机、fake serial、Schema | 77 项共享契约测试与 33 项前端测试通过；模式仅 1–3；未打开 COM4 |
| 2 UI 字体、比例与信息架构 | DONE | 修复字号、密度和空间比例，形成展示级工业控制台 | token、响应式布局、状态组件、五工作区信息架构、视觉基线 | 113 项单元测试与三档视口 21 项 E2E 通过；无关键裁切、重叠和跳动 |
| 3 Dummy 六轴三维预览基础 | DONE | 实现类似 Robot Viewer 的关节直接操作，仅 FK 预览 | 关节拾取、约束拖动、轴/限位反馈、实体/幽灵隔离 | 六关节 URDF 原点/轴/限位、拖动零发送、故障降级与重复挂载资源证据通过 |
| 4 C# 基础与只读 COM4 | DONE | 建立 .NET 10 网关，只枚举/连接/读取真实状态 | 分层服务、串口生命周期、REST/SignalR、会话令牌 | fake serial 集成测试通过；监督下手动连接 COM4；无运动命令 |
| 5 安全硬件控制 | IN PROGRESS | 接入使能、停止、受约束模式 1–3 和整组关节下发；HOME/RESET 按固件证据降级 | v1.4 契约、命令仲裁、受限 engineering direct、目标校验、实测到位、前端能力门、监督 runbook | 软件门与 Gate A 已通过；engineering 六轴运动区分网关入队与 transport 写入并由操作者控制，supervised Gate B 未执行，任何失败不显示成功 |
| 6 动作编排与单点示教 | IN PROGRESS | 版本化动作 JSON、点位编辑/采集和逐点执行 | 6A editor 已验证；6B-S 无生产接线执行内核已验证；6B-H 硬件接线未开始 | 6A/6B-S 零硬件路径；6B-H 不用固定 sleep 冒充完成，暂停/停止语义与固件能力一致 |
| 7 实时示波、终端与故障恢复 | IN PROGRESS | 将静态工具升级为有界实时观测工作台 | 7A 软件门已验证；7B 真实网关长测未开始 | 来源/单位准确；内存有界；断线和陈旧反馈可见且不可下发 |
| 8 WebView2、发布与最终交接 | IN PROGRESS | 完成 Windows 桌面壳、打包、DPI 和最终验收 | 8A 桌面壳/便携包已验证；8B 安装签名/DPI/恢复/最终 handoff 未完成 | 三档分辨率与 Windows DPI 通过；安装/升级/卸载演练；最终页面打开 |

## Aethor_robo 并行接入阶段

| 阶段 | 状态 | 目标 | 当前事实 | 退出门槛 |
|---|---|---|---|---|
| A0 模型接入与双臂控制台 | DONE | 规范化整机资源，并以左右两组七轴提供可选/可拖动本地 FK 预览 | A0-R1 已换入部署版模型：17 links、16 joints、17 STL；原 14 关节名、左右分组、协议索引、轴向与 Profile 零位保持稳定，独立动量轮链路排除；逐资产 SHA-256 溯源门、Profile 切换、共享 geometry、按需渲染、整机/双臂取景和资源恢复继续有效；`/console` 无硬件发送路径 | contracts 124 + frontend 243 软件回归、三档 63/63 视觉/交互与资源释放回归通过；模型档案和 handoff 落盘；阶段提交/远端一致 |
| A1 固件与协议契约 | IN PROGRESS | 定义独立的七轴组命令、反馈、停止、能力和错误语义 | A1-U0/U1/U2/T0/H0/H1-S 软件门已完成；固件提交可追溯，但正式 `aethor-text-v1` 与主机候选协议不一致，生产 adapter 和真实会话尚未实现 | 选定并版本化正式协议；固件与主机消费同一 vectors；parser/formatter/状态机通过；不得复制 Dummy 协议 |
| A1-U0 上位机候选契约 | DONE | 固化任意子集/顺序的 ID→关节投影、异常诊断和非阻塞串口所有权设计 | `AethorArmMotorFrameV1` Schema/类型、领域 reducer、缺失链灰显、候选协议与测试均已落盘；零串口路径 | contracts 98、frontend 222、strict typecheck/build 通过；默认仍为本地预览且命令禁用 |
| A1-U1 双工运行时软件门 | DONE | 建立唯一持续 reader、有界优先 writer、背压/关闭探针与双 Profile 终端入口 | `SerialDuplexScheduler` 与 fake transport 测试已落盘；Aethor 终端只做候选校验且 TX 禁用；生产 DI 未接线 | 定向并发/容量/拔线测试、前端 Profile 隔离、两档实页无溢出；零串口路径 |
| A1-U2 Dummy 生产迁移 | DONE | 用新运行时替换 Dummy `serialIoGate`，使 direct terminal 有界入队后立即返回 | `DummySerialSession` 已成为唯一 reader/decoder owner；direct 按 request ID 产生 queued→sent/失败类状态，结构化问答保留 response fence | 零双 reader、P0 抢占、连续终端发送、结构化响应/审计兼容和全量回归通过 |
| A1-T0 数字孪生实时内核 | DONE | 在固件 adapter 前完成双臂高频遥测到 Three.js 的有界投影 | 单一 ingest 接缝；每臂最新帧优先；双臂原子提交；50 Hz 模型提交上限；逐关节 250 ms 显示新鲜度；入口/模型/合并/拒绝指标 | 100 帧突发只产生一次模型提交；旧序号、旧 boot 和会话身份串线被拒绝；目标草稿不被反馈覆盖；断流保留末姿态并灰显 |
| A1-H0 主机协议 codec 软件门 | DONE | 在不接串口的前提下冻结主机侧 ASCII/CRC/行解码和跨语言向量 | 共享 TypeScript codec、独立 C# Domain codec、CCITT-FALSE 向量、512-byte 解码器和终端 CRC 校验已落盘；无 DI/adapter/TX | 标准 `123456789 → 29B1`、TS/C# 同向量、碎包/粘包/CRLF/非法字段/超长输入和三档终端 UI 通过 |
| A1-H1-S 主机会话软件核心 | DONE | 在零串口边界实现 request/session/boot、只读快照投影和非阻塞高频投递 | 未注册生产 DI 的 `AethorArmSerialSession`、严格递增 request ID、latest-only pull、GET_JPOS/TEL 同一 ID 投影和资源探针已通过 fake transport | gateway 145、contracts 125、前端 coordinator/reducer 13；乱序响应、慢消费者、重启、超时、孤立回包、等待者释放和唯一 close 均通过；零串口路径 |
| A1-H1-F 固件证据与只读生产适配 | BLOCKED | 对齐正式固件协议，完成启动协调器、心跳、REST/SignalR 和监督只读实机 | 固件基线 `db0818b` 可追溯，正式协议为 `aethor-text-v1`；Studio 仅有 `aethor-arm-ascii-v1` 主机核心且未注册生产 DI，Profile capability 全 false | 正式协议决策落盘；固件与主机 vectors 对齐；实际字段/吞吐冻结；fake production adapter、观测、重启/断开释放和只读监督实机验收通过 |
| A2 只读网关与观测 | NOT STARTED | 人工连接、双臂反馈、协议日志和有界示波 | 没有串口/传输/反馈契约 | fake transport、loopback/token、只读监督 runbook 和实机授权验收通过 |
| A3 安全控制与动作编排 | NOT STARTED | 独立双臂整组下发、停止、到位确认和版本化动作程序 | 当前文档与 6B-S 执行内核均只支持 Dummy 六轴 | 可信限位/速度/完成/停止语义、逐臂命令仲裁、监督低风险实机门全部关闭 |

## A0 完成结果

- `aethor-robo-dual-7dof` 已换入 `Aethor_Layout_deployed/` 的规范化 URDF 与 17 个本体/双臂 STL；双七轴分组、原 14 关节映射和逐资产 SHA-256 溯源门保持有效。六个独立动量轮 link/joint/mesh 已排除；来源目录仍缺完整 BSD 条款，不把完整性验证冒充为分发授权。
- 当前退出门为 contracts 124 + frontend 243 + gateway 129 + desktop 118 + legal inventory 6，共 620/620；strict TypeScript、Web 2658 modules、隔离 gateway Release 与 desktop Release 构建通过，0 warning/0 error；三档生产 E2E 63/63 通过。
- E2E 覆盖双 Profile 隔离、左右七轴本地编辑、零硬件路径、三档无关键溢出、同源资产一次恢复、17 份 geometry 共享、按需帧收敛及重复挂载资源释放。本轮没有新启动或访问网关，没有枚举或打开串口，也没有发送硬件命令；既有未知 COM4 会话保持原样。
- A1-U0 已完成上位机候选契约：任意子集/顺序按 ID 1–7 映射，重复和范围外 ID 保留诊断，完整发现快照中的缺失链从首个不确定关节起灰显。该入口尚未接入运行时网关，不会产生连接、反馈、使能、停止或下发能力。
- A1-U2 已完成 Dummy 生产迁移：`DummySerialSession + SerialDuplexScheduler` 统一拥有物理读写，旧 `serialIoGate` 已删除。`/terminal` 可连续提交多个 direct 请求，HTTP 入队与物理写入分阶段显示；结构化响应、审计、P0 抢占和资源关闭保持独立证据。Aethor TX 仍固定禁用。
- A1-T0 已把 adapter 到 React/Three.js 之间的实时内核落盘：左右臂各只保留最新待提交帧，20 ms 窗口内原子更新一次；入口按 controller/arm/boot/sequence 隔离，逐关节在总年龄达到 250 ms 时保留最后角度并转为 stale。该阈值只属于显示层，不是硬件使能判据。
- A1-H0 已完成主机软件 codec 门：TypeScript 与 C# 独立实现共同消费语言无关向量，严格校验 CRC、请求号、operation、字段唯一性和 512-byte 行边界；Aethor 终端快捷命令生成真实 CRC，但发送仍禁用。
- A1-H1-S 已完成未注册生产 DI 的 `aethor-arm-ascii-v1` 主机会话软件核心：request ID 乱序关联、HELLO/boot/session 身份、GET_JPOS/TEL 同一投影、高频 latest-only 投递和关闭释放均有 fake transport 证据。2026-08-17 已取得固件基线 `db0818b`，但其正式入口是 `aethor-text-v1`，旧 CRC 协议只用于回归；A1-H1-F 因正式协议尚未对齐、生产启动/心跳/REST/SignalR 和真实串口证据缺失继续保持 `BLOCKED`，A1 总体仍为 `IN PROGRESS`。

## Phase 4 验收结果

- 2026-08-09 在现场授权下只连接 COM4 一次，只发送 `#GETJPOS/#GETMODE/#GETENABLE`，取得 6 个有限关节角、模式 2 和未使能状态；没有运动或状态改变命令。
- 断开返回 offline，运行日志记录资源释放且无再次打开；post-cleanup 无网关进程和 5127 listener。直接 OS 句柄检查因 `handle.exe` 未安装而不可用，限制已写入 Phase 4 handoff。
- 原采证执行器因 Windows PowerShell 数组包装误判失败；原始证据保留，离线归一化验证 6 个真实帧通过，仓库脚本和回归测试已修正。Phase 5 必须重新取得硬件授权。

## Phase 5 当前结果

- RobotGatewayV1 当前为 1.4：保留结构化命令、稳定结果/证据码、有界命令审计和 SignalR 终态，并将 Development engineering direct 拆为 `queued + gatewayAccepted` 与 `sent + transportWritten` 两阶段人工确认语义。
- C# 已实现单在途、幂等、超时、停止抢占、目标/限位/速度/状态双重校验；关节组只有在配置速度、到位容差、连续稳定窗口和总超时后才声明能力，并以实测六轴误差持续收敛返回完成。前端同步显示并校验该完整包络。
- Gate A 已在 COM4 上验证使能、停止去使能、模式 1–3 和恢复模式 2，6 条命令结果均为 `completed + feedbackConfirmed`；未发送关节目标，断开前为 measured/valid、disabled、mode 2，清理后 gateway 进程和 5127 listener 均为 0。
- 实机运行暴露协议环会被高频轮询覆盖早期命令 TX；命令审计已增加有界请求快照、请求指纹和实际成功写入 transport 的 payload。旧 Gate A 证据不追写，后续按命令即时采证。
- 三个前端命令入口已统一终态/REST 审计恢复语义；全局软件急停响应丢失会锁存未知结果。成功 STOP 使用 session 级时间水位抵抗迟到乱序终态和截断历史。
- 串口防堵软件门已补齐：普通命令与 STOP 获取串口所有权均受 `CommandTimeout` 限制；STOP 未取得所有权会返回未确认，人工断开拒绝遗留在途硬件命令，宿主清理先关闭句柄解除不响应 token 的原生读写再等待任务终态。打开阶段另有默认 5 秒总超时；超时或请求取消会主动 dispose 候选连接、恢复 offline 并隔离本 Gateway 后续打开，防止无法取消的原生 Open 任务因重复点击累积。fake transport 现覆盖打开停滞/取消、32 次正常循环、32 次忽略读取取消的关闭循环、阻塞写入关闭顺序和 64 个完整轮询周期；该门仍不替代 Phase 5 Gate B 或 Phase 7B 的真实驱动故障注入。
- 实时事件发布也已从 transport 生命周期解耦：单次 sink 发布和关闭排空均有界；不合作 sink 超时后停止事件泵，网关仍先释放串口并退出，REST 快照继续作为权威恢复源。
- SignalR 故障会立即把 Dummy measured session/joint 降为 stale；重连后只有 REST capabilities/session/joint/protocol 恢复成功才重新信任实时数据。五个工作区共享不可忽略的 Dummy 全局告警，普通控制持续锁定；Aethor_robo 控制台仍保持 `MODEL ONLY`，不会把 Dummy 状态解释为本机反馈。
- `gateway:preflight:control` 和 [Phase 5 监督式控制手册](runbooks/phase-05-supervised-control-com4.md) 已更新为 `GATE A VALIDATED / GATE B BLOCKED`。
- 全量 shared 85 + frontend 96 + C# 46，共 227 项测试通过；strict TypeScript、Vite/.NET Release 构建和三档 Edge E2E 36/36 通过，C# 0 warning/0 error。
- Gate B 未授权、未执行，Phase 5 不能标记 DONE，也不创建阶段完成提交。
- 固件 HOME/RESET 在协议线程中阻塞到动作结束，可能阻止及时 STOP；两项在生产 capabilities 中默认排除。关节组在取得可追溯的完整四参数运动包络前默认排除。
- 2026-08-10 最新软件回归为 contracts 91 + frontend 182 + gateway 72 + desktop 74 + legal inventory 1，共 420/420；strict TypeScript、Web/.NET Release build 与三档生产 E2E 63/63 通过。新增全局手动串口入口、跨入口 active port 同步和新 session 首个可信实测帧的一次性目标基准对齐；交付前只启动 `commandPolicy=disabled` 本机网关，session offline，COM1/COM4 可见但均未打开。

## Phase 6 当前结果

- 按 [ADR-0005](decisions/0005-offline-action-document-boundary.md) 拆为 Phase 6A 离线文档、Phase 6B-S 反馈确认式软件内核、Phase 6B-E engineering 人工运行与 Phase 6B-H 监督实机接线；两种执行模型的完成证据保持分离。
- Phase 6A 已实现 `ActionProgramV1` Schema/类型/示例、程序与点位编辑、顺序调整、来源真实的单点采集、目标草稿预览、350 ms 自动保存、导入导出和损坏存储隔离。`#GETJPOS` 六轴有限值在采集、保存、预览和 6B-S port 交接中保持原值，不应用 Profile/URDF 范围；新建程序默认 20 deg/s、循环关闭并保存循环偏好。
- Phase 6B-E 已接入 `/actions`、REST、SignalR 与 C# 网关：只有 engineering + 新鲜 Dummy 会话/反馈 + enabled + mode 一致时可提交不可变 revision；逐点以 `sent + transportWritten` 推进，默认 20 deg/s，可循环，有限运行/停止分别显示 `finishedUnconfirmed/stoppedUnconfirmed`。
- 6B-E 的循环、估算节拍、串口写入和停止均由 C# `EngineeringActionProgramRuntime` 持有；前端不创建第二套 runner。停止、终端 STOP/DISABLE、断开和 dispose 会取消未来点位。
- Phase 6B-S 已实现 C# Application 独立 owner：非 SHOWCASE Dummy 计划逐点执行，模式与关节组均只接受 `completed + feedbackConfirmed`；到位后才等待；命令异常/超时/停止只进入一次有界 stop-and-disable；同 revision/session/计划指纹的 checkpoint 才能从最后确认点后恢复。当前只有 fake port，未注册 DI、API 或 UI。
- Phase 6B-H 仍为 `NOT STARTED`，依赖 Phase 5 Gate B；反馈确认式 `ActionProgramRunner` 仍无生产 adapter/checkpoint 接线，engineering 人工运行不能替代它。
- Phase 6 总体仍为 `IN PROGRESS`，不创建 `phase(06)` 完成提交。

## Phase 7 当前结果

- 按 [ADR-0006](decisions/0006-live-observability-boundary.md) 拆为 7A 软件门和 7B 实机长测；只读观测不依赖 Gate B 运动包络，但真实串口仍需新鲜现场授权。
- 7A 已实现 18 路、每路 4800 点/120 秒的有界历史，默认 60 秒窗口；采集与 10 Hz/1 Hz 可见性刷新分离，ECharts 实例跨数据更新复用。
- 网关模式不再因缓冲为空而回退 SHOWCASE；示波/终端显示 measured/waiting/stale/idle 的真实状态。终端日志限 256 帧、去重，清空只影响当前视图。
- 终端不再使用管理员/专家解锁。`engineering` 网关下可直接发送 Dummy 单行白名单；C# 仍独占串口并二次校验 session、状态、模式、六轴有限数和显式速度，不应用旧 Profile/URDF 角度范围。HOME/RESET、RGB、电流/PID、reboot、多行及任意 raw 均拒绝。
- engineering direct 按人工模式呈现：HTTP 受理显示 `QUEUED · GATEWAY ACCEPTED`，物理写入显示 `SENT · MANUAL CONFIRM / transportWritten`；请求不等待或解释 FIFO/`ok`，也不写成设备接收或实测到位。后台唯一 reader 继续轮询，查询超时不自动断开；正式 `supervised` Gate B 仍依赖四参数运动包络和独立实机验收。
- 错误 COM 口造成 `stale/unknown/faulted` 时允许人工释放会话；只有明确 `motor=enabled` 或存在在途命令时拒绝普通断开。
- 当前软件回归为 contracts 95 + frontend 211 + gateway 103 + desktop 118 + legal inventory 6，共 533/533；strict TypeScript、2644-module Web、Gateway/Desktop Release build 0 warning/0 error，三档生产 E2E 63/63。engineering 人工运动现能识别“`#GETJPOS` 持续回包但角度冻结”，只把关节反馈降为 stale，连续人工目标不被锁定，角度重新变化后恢复 valid。本次自动验证未打开 COM4、未发送任何硬件命令；既有 disabled/engineering 包 smoke 记录不冒充本次新代码的打包复验。
- 当前 10 分钟 × 40 Hz 合成长测达到单路 4800、总 86400 点上限；早期 20 Hz 验证数据仍保留在 Phase 7 历史记录中。全量回归数量以最新 handoff 和变更记录为准。
- 7B 干净只读基线工具已就绪：显式授权与五项现场确认缺一即在进程/证据目录创建前失败；`-ValidateOnly` 已证明零网络、零进程、零串口、零文件变更。真实路径固定 command policy disabled、Dummy 与三个查询白名单，并有界记录 sequence、协议、working set/private memory/handle/CPU 和最终释放。该工具尚未连接 COM4，且固定声明资源阈值、浏览器 heap、故障注入和 Phase 7B 完成均未评估。
- 7B 未授权、未执行；真实采样/资源曲线、拔线和恢复证据缺失，Phase 7 不能标记 DONE，也不创建阶段完成提交。

## Phase 8 当前结果

- 按 [ADR-0007](decisions/0007-desktop-process-and-bridge-boundary.md) 拆为 8A 桌面软件门与 8B 正式发布门；8A 不依赖 COM4 或 Gate B，可在命令关闭的离线边界独立推进。
- 8A 已实现 WinForms/WebView2 自定义壳、单实例、严格 `DesktopBridgeV1`、随机 loopback 端口/令牌、网关健康监督、Job Object 回收、有界日志、窗口恢复和自包含 win-x64 便携包。
- 实际 WebView2 验证发现并修复 bridge 初始化顺序与 SignalR CORS 请求头遗漏；修复后 REST、negotiate 与 hub 连接成功，运行段无 console error/web exception，正常退出后桌面和网关进程均为 0。
- 全量 shared 90 + frontend 143 + gateway 52 + desktop 46，共 331 项测试通过；strict typecheck、Vite/.NET Release build 与三档 Edge E2E 39/39 通过。包 smoke 校验 646 个文件哈希且保持零串口/零硬件命令。
- 8B 软件增量已固定 `PerMonitorV2` 和 WebView2 Stable-only 前置条件。WebView2 缺失或非 Stable 时在网关启动前失败关闭，原生面板不联网下载并可安全退出。桌面对自有 loopback 网关的 readiness/shutdown 固定绕过代理；在本机代理存在且无 `NO_PROXY` 时，单一候选已取得 ready。网关崩溃会阻断工作区，真实恢复按钮点击已验证旧实例退出、唯一 `--offline` 桌面启动且零网关；没有宿主 202 时普通关闭继续拒绝。命令关闭/offline 注入证明确认零串口/零硬件命令。`.aethor-robot` 预览也已加入 ZIP 膨胀、条目、文本资源、Windows 路径和旧任务取消边界。
- 当前包的 `Legal/` 已集中携带 Dummy/Aethor_robo NOTICE、Aethor_robo provenance、独立模型再分发状态，并从真实生产依赖生成 SPDX 2.3 清单。92 个组件（87 npm、5 NuGet/runtime pack）的正文由包根法律文件或 6 个精确版本/包哈希/上游 revision/blob/双 SHA-256 绑定的仓库记录闭合；697 个实际文件/696 项 manifest 的开发包在 disabled 与显式 engineering 两种离线 smoke 下均通过，依赖缺口为 0、模型缺口为 2、`releaseReady=false`，发布 verifier 以 `model-redistribution-incomplete` 拒绝，不能标作正式候选。实际 DPI 采集脚本以 `--offline` 从窗口句柄验证 awareness、DPI、显示器工作区与恢复可见范围；本机 96 DPI 通过且零网关，120/144/192 与真实多显示器仍待对应环境验收。
- 最新增量把串口目录、连接和断开统一为跨顶栏/设备页 single-flight owner，并用 operationId 关联前端与网关 Event 1006–1010；相同意图合并，冲突意图不会创建第二个请求。Desktop 新会话在 bootstrap 声明 Dummy gateway 时强制从 `Dummy` 启动。3D 继续 demand render，并新增按画布面积的 350/180 万像素预算；Desktop 每 60 秒 single-flight 记录规范化工作区、白名单化 JS heap/DOM/layout，以及宿主、WebView2 进程组、可空网关和三者受跟踪工作集。三次控制台/终端短周期往返保持 5 个 WebView2 进程，工作集与浏览器实时元素/Canvas 数按路由回到各自基线；新包已实采 `workspace=console/terminal`，但不替代 Phase 7B 长测。操作者随后尝试连接被旧网关占用的 COM4，`Open()` 在取得句柄前 AccessDenied、无 `serial.opened` 或硬件命令，却暴露 faulted 伪会话阻塞退出；现在普通打开失败释放临时 transport 后直接恢复 offline，已打开会话的安全门不变。后续又为同步 Open 增加默认 5 秒总超时：超时/取消主动 dispose 候选连接、恢复 offline 并隔离同进程重试。当前回归 494/494，重建标准包的 disabled/engineering smoke 均通过；最终工程会话只读取得 2 个端口且无连接、写入或 Web 错误。旧 5127 gateway 未被终止，真实占用/停滞路径没有再次操作 COM4。
- ADR-0008 已锁定 MSI、Major Upgrade 与默认保留独立应用数据根；第三方许可缺口处置、MSI 工具治理、Publisher/证书、WebView2 离线 Runtime、安装/修复/升级/卸载、四档 DPI/多显示器目视、7B/8B 监督硬件回归和最终 handoff 仍未完成，因此 Phase 8 不标记 DONE、不创建阶段完成提交。

## 阶段依赖

```text
0 → 1 → 4 → 5 Gate B ─────────→ 6B-H ───┐
         ├────────→ 7A → 7B ────────────┼→ 8B final
         └────────→ 8A desktop software ─┤
    └→ 2 → 3 → 6A → 6B-S ──────────────┘
```

Phase 6A、Phase 6B-S、Phase 7A 和 Phase 8A 可在各自零硬件写入边界内独立推进；6B-S 不得注册到生产运行时。Phase 7B 只读实机长测需要新鲜授权但不依赖运动 Gate B。8B 最终发布门不能用 8A 便携开发包替代。任何真实动作仍必须严格经过 Phase 4/5、Gate B 和 6B-H。详细执行任务见 [阶段提示词](prompts/README.md)，验收证据结构见 [验收矩阵](testing/acceptance-matrix.md)。
