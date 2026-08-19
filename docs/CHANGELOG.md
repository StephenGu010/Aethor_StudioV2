# 变更记录

## 2026-08-19 - Dummy 手动示教与 Engineering 动作运行（Phase 6 IN PROGRESS）

- 修正设备角链路：`ActionProgramV1`、自动保存、导入导出、目标预览、Three.js 实体/幽灵模型和两个 C# runner 都不再应用旧 Profile/URDF 角度范围。`#GETJPOS` 的六个有限值按 J1–J6 原样采集和交接；错误轴数与 `NaN/Infinity` 仍失败关闭。
- 动作页取消未保存退出与点位删除确认，改为 350 ms 防抖自动保存；新建默认 20 deg/s，加入循环开关、实测点只读编辑、当前 revision 深快照和明确的运行/停止状态。
- 新增 `ActionProgramRunStartRequestV1/ActionProgramRunSnapshotV1`、三个 REST 端点和 `actionProgramRunSnapshot` SignalR 事件。C# `EngineeringActionProgramRuntime` 独占点位顺序、估算节拍、循环和停止；每点只在 direct 达到 `sent + transportWritten` 后推进，不等待 FIFO、最终 `ok` 或到位。单次结束和停止分别为 `finishedUnconfirmed/stoppedUnconfirmed`，物理完成标志恒为 false。
- 结构化停止、终端 `!STOP/!DISABLE`、断开和 runtime dispose 会先取消未来点位。停止链即使 `!STOP` 写入失败仍尝试 `!DISABLE` 并释放 owner；并发开始返回 409，非法 wire 请求返回 400，不会覆盖活动快照。运行事件时间严格递增，前端按 session/时间拒绝旧通知。
- 停止现在会从串口调度器原子撤销尚未写出的当前点位；若 writer 已经取得该点位，则等待该次不可撤销写入收束后再排入 `!STOP → !DISABLE`，不会让旧运动点残留在停止链之后。客户端复用 `runId` 时，网关仍为每次执行生成独立 nonce，避免 direct 幂等缓存把旧的 `transportWritten` 当成本轮新写入。
- Dummy 运动数值统一采用 ECMAScript `Number::toString` 的最短往返规范，TS/C# 对 `1e-16`、`1e-5`、高精度小数和 `1e20` 生成相同文本，并在接管串口前验证固件每项 64 bytes/最多 63 ASCII 字符。engineering 路径保留六个有限设备角原值且不应用旧关节范围；supervised 路径仍保留既有硬件限位门。
- HTTP JSON 绑定拒绝缺少构造字段、未知字段和数字枚举；停止与有限运行终态竞争时返回 409 而不是 500。动作事件发布改为单在途、只保留最新待发快照；跨运行时间戳即使系统 UTC 回拨也保持单调。前端不会让晚到的空 REST 快照擦除已观察到的活动运行，session 更换仍会完整清理。
- 原 `ActionProgramRunner` 继续保留为未接线的 `feedbackConfirmed` 监督内核，未用固定等待弱化；Aethor_robo 仍不进入 Dummy 动作契约。
- 最终全量验证：contracts 131、frontend 255、gateway 177、desktop 118、legal inventory 6，共 687/687；三档 Playwright 63/63；strict TypeScript、2658-module Web、Gateway/Desktop Release build 均通过，.NET 0 warning / 0 error。重新生成的 development-dirty 桌面包为 701 个文件，engineering offline smoke 验证 manifest 700 项、网关 ready、session offline、正常退出，只枚举到 COM1，`serialPortOpened=false/hardwareCommandSent=false`；桌面快捷方式已更新到该包并显式携带 `--engineering`。本轮没有打开 COM4，也没有发送查询、状态改变或运动命令。

## 2026-08-17 - Aethor_robo 固件 PRD 快照与协议基线同步（DONE）

- 将用户提供的 18 份固件 PRD、阶段计划和 handoff 作为非权威参考快照收录到 `docs/references/aethor-robo-firmware-prd/`，保留原始文件 SHA-256；入库副本清理一处个人桌面绝对路径，并把两处行尾空格等价改为 `<br>`，原始本地文件未修改。
- 只读检查外部固件提交 `db0818b15eb3c2bc7cdde5b34a548c6e69f47a9f`，确认当前正式 Type-C USB CDC 协议为 `aethor-text-v1`，而 `aethor-arm-ascii-v1` 只作为迁移前回归资产。固件仓库未被修改、提交或推送。
- 同步候选协议状态、A1/A1-H1-F 路线图、文档索引和 Aethor_robo 当前交接。Studio 的 Profile adapter 与硬件 capability 保持不变；本次不实现新 codec、生产 adapter、串口连接或硬件动作。

## 2026-08-14 - Dummy 连续动作后的契约告警与瞬态写超时恢复（DONE）

- 从桌面有界日志还原现场链路：三次 engineering 关节组均已到达 `transportWritten`；第二、三次动作后 `#GETJPOS` 出现查询超时，随后 Windows 串口写入返回原生错误 121 并使会话进入 faulted。查询超时产生的错误 `ProtocolFrame` 没有关联号，但旧 C# JSON 仍写出 `correlationId: null`，与公共契约“可选字符串”不一致，前端因此显示泛化 `GATEWAY WARNING`。
- `ProtocolFrame.CorrelationId` 现在只在有值时序列化。只读 Dummy 查询显式标记为可重试：`#GETJPOS/#GETMODE/#GETENABLE` 遇到一次 `TimeoutException` 或 Windows 错误 121 时延迟 100 ms 后重试一次；动作、使能、停止、模式和任意终端写入绝不自动重发。probe 新增 `RetriedWrites`，诊断事件为 `serial.scheduler.write.retry`，不记录 payload。
- Gateway 150/150 通过，覆盖空关联号 wire shape、错误 121 恢复、生产轮询接线和动作写入不重试；整仓 contracts 125 + frontend 246 + gateway 150 + desktop 118 + legal 6，共 645/645。Web 2658 modules 与 Gateway/Desktop Release 构建通过，0 warning/error；隔离验证明确 `serialPortOpened=false / hardwareCommandSent=false`。真实 COM4 连续三次动作复验尚未执行。

## 2026-08-13 - A1-H1-S Aethor_robo 主机会话软件核心（DONE）

- 新增未注册生产 DI 的 `AethorArmSerialSession`：复用唯一持续 reader 与有界优先 writer，以会话内严格递增 request ID 关联乱序 RSP/ERR；终端 REQ 只等待 physical write，不等待回包或持有 writer。
- HELLO 严格验证 product/protocol/DOF/controller/arm/session/boot/firmware/modes/stream 上限。重复握手取消旧 pending，boot_id 变化清空身份与全部在途请求；超时后的迟到响应进入有界 orphan 诊断，退休 request ID 不可复用。
- GET_JPOS 与 TEL JOINT_STATE 统一投影到 `AethorArmMotorFrameV1`。Schema 增加可选的冲突与范围外 ID 证据；缺失 q_deg 槽位不使用、冲突值不应用、ID >7 不伪造角度样本。
- 高频遥测经过容量一的 latest-only pull 槽，未来唯一事件泵主动取帧；慢或失效下游会合并旧帧，既不阻塞协议 parser，也不进入串口 dispose 链。probe 统计 projected/published/coalesced/rejected、pending、correlated/orphan、timeout 与 boot reset，正常遥测不逐帧写日志。
- C# Gateway 145/145、共享契约 125/125、前端全量 245/245 与 strict TypeScript 通过；isolated wrapper 明确 `serialPortOpened=false / hardwareCommandSent=false`。Profile adapter 与硬件 capability 保持不变，固件/生产 adapter 进入 A1-H1-F。

## 2026-08-13 - A0-R1 Aethor_robo 部署模型替换（DONE）

- 将 Aethor_robo 内置模型从旧 `Layout11 EX1.zip` 版本替换为用户提供的 `Aethor_Layout_deployed/` 目录快照。规范化结果为 17 links、16 joints、17 个 STL；来源快照、原始/规范化 URDF 和每个保留 STL 均记录 SHA-256。
- 保持现有 14 关节映射不变：左右臂稳定 joint name、`j1…j14`、protocolIndex、axis、分组与 TCP 不变；两个 J1 继续使用 Profile 既有零位和 `0…2π` 预览约定。新增 URDF 回归覆盖结构、顺序、轴、限位与零位。
- 从 URDF、模型树、诊断、设备页和打包资源中移除六个独立动量轮 link/joint/mesh。底座 STL 的 CAD 导出仍烘焙有 wheel-shell 外形，若需从视觉上彻底去除必须重新导出底座。
- 溯源 Schema 升级为兼容目录快照的 v1.1，`pnpm profile:verify` 证明当前 1 个 URDF 与 17 个 STL 覆盖一致。视觉/资源基线更新为 17 份共享 mesh geometry、含操纵器 23 geometry / 22 material。
- 验证结果为 contracts 124 + frontend 243 + gateway 129 + desktop 118 + legal inventory 6，共 620/620；strict TypeScript、2658-module production Web、Gateway/Desktop Release 0 warning/0 error 和三档 Playwright 63/63 全部通过。三档截图已目视检查后更新，无关键裁切、重叠或模型/参考平面穿插。隔离验证明确 `serialPortOpened=false / hardwareCommandSent=false`。

## 2026-08-13 - A1-H0 Aethor_robo 主机协议 codec 软件门（DONE）

- 将受固件阻塞的 A1-H 拆为 H0/H1：H0 完成不接串口的主机无状态 codec，H1 保留固件证据、request/session adapter 和只读实机接入。
- 新增 TypeScript 与独立 C# `aethor-arm-ascii-v1` 实现，共同消费语言无关 CRC/REQ/frame/invalid vectors；以 CCITT-FALSE 标准 `123456789 → 29B1` 锚定算法，覆盖字段唯一性、uint32、7 类帧、512-byte、碎包/粘包/CRLF 和异常字节。
- Aethor 终端快捷命令现生成真实 CRC，并分别显示 CRC/格式诊断与 adapter 禁用原因；修正 `SET_STREAM` 字段。页面仍不连接、不发送，也不消费 Dummy 会话。
- 最终软件证据为 contracts 124 + frontend 241 + gateway 129 + desktop 118 + legal inventory 6，共 618/618；C# codec 定向 7/7。strict TypeScript、2658-module production Web、Gateway/Desktop Release 0 warning/0 error 与三档 Playwright 63/63 均通过。终端实页三档无横向溢出、裁切或 console 告警；隔离入口确认零串口打开、零硬件命令。

## 2026-08-13 - A1-T0 Aethor_robo 数字孪生实时内核（DONE）

- 新增协议无关的 `AethorTwinFrameCoordinator` 和唯一 `ingestAethorTwinMotorFrame` 入口。每条机械臂最多保留一条最新待处理帧，20 ms 窗口内左右臂原子提交一次，把固件候选 50–100 Hz 遥测与 React/Three.js 模型更新限制在最多 50 Hz。
- 在 React 状态前拒绝同 boot 倒序/重复帧、退休 boot 回流、同一会话 controller/arm 身份串线和不兼容帧；Profile 切换会同步清空协调器与模型会话，下一会话重新建立身份和序号基准。
- 每个关节独立记录最后观察时刻和设备反馈年龄。总年龄达到 250 ms 后保留最后实测角度、撤销 `MEASURED` 来源并把不可信串联链灰显；持续收到其他轴的增量帧不会错误延长旧轴新鲜度。
- 控制台诊断新增遥测入口 Hz、模型提交 Hz、最新序号、合并与拒绝计数；实体姿态、幽灵目标继续隔离。当前生产 adapter 仍未实现，默认页面仍为 `UNAVAILABLE / LOCAL PREVIEW`，不会声明已连接。
- 验证证据：contracts 98 + frontend 240 + gateway 122 + desktop 118 + legal 6，共 584/584；strict TypeScript、2657-module production Web 和三档 Playwright 63/63 通过。浏览器实页复核三档无实际溢出、重叠或控制台告警，并修复 1366×768 底部最后一行被截断的问题；未枚举或打开串口，未发送硬件命令。

## 2026-08-13 - A1-U2 Dummy 生产双工迁移与连续终端发送（DONE）

- Dummy 生产网关一次性迁移到 `DummySerialSession + SerialDuplexScheduler`：所有 RX 由唯一持续 reader/decoder 处理，所有 TX 由 P0–P3 有界 writer 处理；旧 `serialIoGate` 与直接 transport 读写路径已删除。
- Dummy 无标签结构化问答使用单一 response fence，结构化响应、命令审计与联锁语义保持独立；P0 STOP/DISABLE 可抢占低优先级 fence，被抢占事务不会写成成功。
- RobotGatewayV1 升级为 1.4。engineering direct 入队返回 `queued + gatewayAccepted`，物理写入再通过 REST history 与 SignalR 发布 `sent + transportWritten`；过期、淘汰、断开取消和写失败分别收束。终端按 request ID 展示多条结果，任一请求缺少 RX 不再禁用下一次发送。
- 前端在 session identity 改变时清空并恢复有界 direct history；真实 TX/RX 仍只来自 C# 网关。Aethor_robo 的 TX、codec 和真实串口入口保持禁用，本阶段没有改变其硬件能力。
- 验证证据：contracts 98 + frontend 230 + gateway 122 + desktop 118 + legal 6，共 574/574；A1-U2 前端定向 50/50。Web Release 为 2653 modules，Gateway/Desktop Release 均 0 warning/0 error，三档 Playwright 63/63。隔离入口明确报告零串口打开、零硬件命令。

## 2026-08-13 - A1-U1 有界串口双工软件门与双 Profile 终端（DONE）

- Application 新增未注册生产 DI 的 `SerialDuplexScheduler`：唯一持续 reader/唯一 writer、RX 有界背压、P0–P3 有界队列、安全容量预留、满载低优先级淘汰、排队时效、ticket 终态和资源探针。关闭先关 transport 解除不响应 cancellation 的 I/O，再唯一 dispose。
- `/terminal` 移除 Dummy-only 路由门并按全局 Profile 分流。Dummy 行为不变；Aethor_robo 只显示候选 REQ 模板、uint32 request ID/ASCII/长度/operation 白名单校验和 `ADAPTER PENDING`，不消费 Dummy 帧、不打开串口、不产生 TX/RX。
- 1366×768、1920×1080 与 2560×1440 实页检查无根横向溢出；长快捷命令改为单行省略并保留完整 title，“填入”动作不再换行或重叠。
- 本阶段没有替换 Dummy `serialIoGate`，也没有实现 Aethor codec/CRC/pending request/REST/SignalR。生产迁移进入 A1-U2，固件接入仍由 A1-H 阻塞。本轮自动验证未枚举或打开 COM4，未发送硬件命令。
- 最终软件证据为 contracts 98 + frontend 225 + gateway 113 + desktop 118 + legal inventory 6，共 560/560；双工调度器定向测试 10/10，production Web 2653 modules，Gateway/Desktop Release 0 warning/0 error，三档 Playwright 63/63。隔离 wrapper 明确 `serialPortOpened=false / hardwareCommandSent=false`。

## 2026-08-12 - Aethor_robo A1-U0 电机发现契约与模型诊断（DONE）

- 新增独立的 `AethorArmMotorFrameV1` TypeScript/JSON Schema 边界。帧按左右臂携带 controller/arm/boot/sequence 身份，允许最多 32 条无序、部分、重复或范围外样本，使异常证据在领域层诊断而不是在 wire 校验时被静默丢弃。
- 新增纯领域 reducer：固定 `motor ID 1…7 → J1…J7`，同一 boot 下拒绝倒序/重复 sequence，新 boot 重新建序；重复 ID 隔离为 conflict，ID >7 只进入 warning，完整快照中的缺失轴标为 missing，增量帧保留既有状态。实体反馈与 14 轴目标草稿继续分离。
- Aethor 控制台可显示左右臂已观测数量、`OBSERVED/MISSING/STALE/ID CONFLICT`、重复/范围外 ID，并将串联链从首个不确定关节起灰显；灰色材质只作用于实体模型，清理时恢复原材质并计入 Three.js 资源所有权。默认无帧时仍是 `LOCAL PREVIEW`，读取和下发保持禁用。
- 仓库新增 `aethor-arm-ascii-v1` 候选协议，冻结请求关联、七轴 mask、发现态、动作/停止语义与未来持续 RX + 有界优先级 TX 的串口所有权设计。当前没有 C# adapter、串口枚举或真实硬件访问，Profile adapter 仍为 `aethor-robo-pending`。
- 外部固件 PRD 同步到 0.3.0-draft，补充部分接线、ID 冲突/范围外诊断和上位机非阻塞并发要求；该目录不属于仓库，未包含在本次 Git 提交。

## 2026-08-12 - Engineering 运动反馈冻结识别（Phase 7 IN PROGRESS）

- 复核固定 Dummy 固件后确认：模式 1–3 的 200 Hz 使能分支只执行 `MoveJoints()` 与 `UpdateJointPose6D()`，没有调用触发 CAN `0x23` 角度采集的 `UpdateJointAngles()`；`#GETJPOS` 又直接输出 `currentJoints`。因此串口回包频繁、sequence 递增并不保证六轴设备角在运动期间更新。
- engineering 人工关节组写入后以最新实测角重新建立观察基准。至少 500 ms、至少 8 个位置样本的六轴最大变化不超过 0.02°，且最大目标误差仍不小于 0.5°时，关节反馈标为 stale，并只记录一次带 request/correlation 的 `feedbackFrozen` 帧及 `engineering.motion.feedback_frozen_suspected`；任一关节重新变化后恢复 valid 并记录恢复事件。
- 该机制不等待固件 ACK、不锁定下一次人工目标、不停止后台查询、不自动重发，也不声称实机静止或到位。参考固件仍保持只读；根治运动中数字孪生不同步仍需在固件现有 CAN 所有权内周期采集并原子提交完整六轴快照。
- 完整软件证据为 contracts 95 + frontend 211 + gateway 103 + desktop 118 + legal inventory 6，共 533/533；strict TypeScript、2644-module Web、Gateway/Desktop Release 0 warning/0 error、三档生产 E2E 63/63 均通过。隔离入口明确 `serialPortOpened=false / hardwareCommandSent=false`。

## 2026-08-12 - Engineering 运动人工确认与连续下发（Phase 5 IN PROGRESS）

- 根因是旧 direct 关节命令把无标签 FIFO 数字或最终 `ok` 当作当前运动的完成条件。固件没有稳定返回或上位机错过该帧时，网关把结果锁存为未知，后续目标只能先停止并去使能；这与现场“实机已经到位、由操作者继续调试”的工作流冲突。
- `RobotGatewayV1.3` 为工程六轴运动新增 `sent + transportWritten`。payload 写入 transport 后立即释放串口和命令所有权，不等待、不解释 FIFO、通用 `ok` 或到位；迟到的队列号、`ok` 和队列满错误只写入有界协议/诊断日志，不改变 direct 状态，也不阻止下一次人工目标。
- 唯一后台 reader 继续按 25 ms 主机节拍尝试 `#GETJPOS`。人工运动期间连续查询超时只把反馈标为 stale，不在常规三次门限自动断开；探针只记录首条和每 20 次，恢复时记录一次 `engineering.motion.feedback_resumed`。显式停止/去使能、断开或新 session 会清理人工运动状态。
- 控制台与终端统一显示 `SENT · MANUAL CONFIRM`。当前会话只要曾取得六轴实测值、motor 仍已知 enabled、mode 有效，即使反馈暂时 stale 也可继续下发；结果只说明写入完成，不声称设备接收、固件入队、运动开始或实机到位。HTTP/transport 失败不会自动重发，界面提示操作者结合真实 TX 和实机人工决定。
- 删除 125 秒最终 ACK 请求窗口和 `AETHOR_GATEWAY_ENGINEERING_JOINT_FINAL_ACK_TIMEOUT_MS`。fake serial 回归证明无任何运动回包时可连续写入、迟到 ACK 只观察、21 次查询超时不误断开且日志限频、停止去使能后可确认重启。本轮软件验证全程未打开 COM4、未发送硬件命令。
- 最终软件证据为 contracts 95 + frontend 211 + gateway 101 + desktop 118 + legal inventory 6，共 531/531；strict TypeScript、2644-module Web、Gateway/Desktop Release 0 warning/0 error、三档 Playwright 63/63 均通过。Windows `development-dirty` 包为 698 个实际文件/697 项 manifest；disabled/engineering 双 smoke 只枚举 COM1/COM4，session offline、进程正常退出，`serialPortOpened=false / hardwareCommandSent=false`。

## 2026-08-12 - Dummy 实时轮询仲裁与 GETJPOS 低噪声显示

- 将 `#GETJPOS` 默认请求周期从 50 ms 调整为 25 ms，并改为从周期起点扣除串口往返耗时，主机目标节拍由约 20 Hz 提升为 40 Hz。模式与使能不再连续查询，而是在位置样本之间每 250 ms 交替一项；每项仍约 500 ms 更新，启动与超时恢复通过两个相邻周期补齐完整状态。
- 后台轮询、engineering direct 和结构化命令继续使用唯一 `serialIoGate`。命令先声明需求，尚未取得串口的轮询会二次检查并让行；结构化关节组到位等待复用 25 ms 快节拍，不再退回旧的 500 ms `PollInterval`。这解决主机侧运动期间约 2 Hz 的模型更新路径，但不能修复参考固件在位置模式 1–3 不更新 `currentJoints` 的问题。
- 终端新增“显示/隐藏 GETJPOS”按钮，默认折叠位置轮询 TX/RX；切换只影响显示，不删除 256 帧原始缓冲，也不停止关节反馈。runtime store 同时维护有界的操作事件视图，控制台最近事件和默认终端视图不再因每条位置轮询帧重渲染。示波历史上限同步为 120 秒 × 40 Hz × 18 路。
- 本段只运行 fake transport、组件和静态构建验证，不连接 COM4、不发送硬件命令。40 Hz 是主机请求节拍，不代表固件 CAN 采样率或实机反馈率；实物运动同步仍需固件修复并在监督条件下复验。
- 验证结果：strict TypeScript、contracts 94、frontend 209、gateway 97、desktop 118、legal inventory 6 均通过；production Web 2644 modules、Gateway/Desktop Release 0 warning/0 error，三档视口 Playwright 63/63。Windows `development-dirty` 包重建为 698 个实际文件/697 项 manifest，engineering offline smoke 只读枚举到 COM1/COM4，保持 session offline、进程退出、`serialPortOpened=false / hardwareCommandSent=false`。桌面 `Aethor Studio V2.lnk` 仍指向该同路径新包并携带 `--engineering`。

## 2026-08-11 - Desktop 串口目录、会话 single-flight 与低噪声诊断链（Phase 8 IN PROGRESS）

- 排查 J3 不动时确认当前浏览器仍是 `SHOWCASE DATA / SERIAL OFFLINE`，且 HMR 前端向旧 5127 网关发送新增的 `X-Aethor-Operation`，旧二进制 CORS 未放行该请求头，目录扫描在预检阶段失败；旧网关的命令审计还会把无设备回包序列化为 `deviceReply:null`，而前端只接受字符串。wire contract 现兼容缺失/字符串/null，避免一条旧审计让命令 authority 恢复失败。J3 索引经固件、manifest、C# parser、前端和 URDF 核对均为第三字段/`protocolIndex=2`；进一步对照固件回零与 `initPose` 后确认还需要独立的设备角到模型角换算。
- 关节位置轮询从模式/使能慢状态轮询中拆分，默认位置 50 ms、模式/使能 500 ms，仍严格串行使用唯一 `serialIoGate`；首轮和超时恢复必须取得完整三状态。新增 fake-serial 回归让 J3 在下标 2 连续变化，并证明位置查询频率高于慢状态；控制台 HUD 增加 J3 与递增 sequence，便于现场区分“帧在更新但 J3 不变”和“整条遥测冻结”。本段软件验证未打开 COM4、未发送硬件命令；实机方向、零位和目标到位仍待监督复验。
- 统一 Dummy 关节坐标：`#GETJPOS` 设备角成为滑条、反馈、动作点位、误差和整组 payload 的唯一坐标；Profile 与 C# 网关限位改用固件定义 `[-170…170, -75…90, 0…180, -180…180, -120…120, -720…720]`。Three.js 仅在渲染边界应用 `model=device*sign+offset`，其中 J3 为 `device-90°`，并以双向换算和 URDF 限位测试防止模型偏置进入实机命令。
- 定位运动时姿态不更新的固件根因：位置模式 1–3 的 200 Hz 控制分支未调用 `UpdateJointAngles()`，而 `#GETJPOS` 只读取 CAN 回调维护的 `currentJoints`。主机与固件通信任务已经异步分离，不增加第二个串口 owner；参考固件保持只读，待在固件工程内加入有界周期的 CAN 角度采集并测量总线负载后再做运动中反馈验收。
- 关节组到位等待新增低频冻结诊断：目标仍超限、至少三个有效 `#GETJPOS` 样本完全不变且总超时时，结果明确提示固件运动模式反馈未刷新候选，并记录一次 `motion.feedback.frozen_suspected`；查询无回包仍使用原 `serial.query.timeout`。诊断不改变 v1.2 命令枚举、不把目标当反馈，也不推断物理运动结果。网关隔离测试 94/94 通过，未打开串口或发送硬件命令。
- 本轮软件证据：`pnpm typecheck`、518 项 `pnpm test`、production `pnpm build` 和三档视口 63 项 Playwright 全部通过；构建 0 warning / 0 error，验证脚本确认没有打开串口或发送硬件命令。当前 5174 页面已显示 J3 `0…180°` 与 `#GETJPOS 设备角`，浏览器无 error 级日志。
- 从桌面日志定位到确定根因：壳拥有的网关运行在随机端口 `64050`，但 production Web 被 `.env.local` 烘入的 `5127` 覆盖，所有 REST/串口请求误投旧开发网关并产生 CORS 重试。修复后有效 Desktop bootstrap（含离线 null）具有最高优先级，production/e2e 强制清空构建时 URL/令牌，Windows 打包对开发值再次扫描失败关闭。
- 第二次实际桌面日志又定位到独立门控：child gateway 已在随机 `56904` 就绪，但页面启动后没有任何网关请求；原因是桌面新会话默认进入无串口能力的 Aethor_robo，Dummy coordinator 没有挂载。现在只要 Desktop bootstrap 声明了 Dummy gateway，新桌面会话就强制从 `Dummy` 启动并立即只读枚举；浏览器展示模式仍按自己的 `sessionStorage` 恢复。该修复同时避免硬件调试启动时先解析体量更大的双七轴模型，3D 继续使用 demand render。
- 顶部串口入口和设备页不再各自持有端口数组、选择值和自动请求；目录移入临时 runtime store，并由 single-flight 协调器合并并发扫描。显式连接/断开也改为共享 owner：相同意图共用一个请求，不同意图在当前终态前失败关闭，两个入口同步显示 connecting/disconnecting/error。断开仍重置目标/模型/会话，随后只读重扫目录，不自动选择或连接端口。
- 建立跨 Desktop/Web/Gateway 的结构化探针链：UUID operationId 经 `X-Aethor-Operation` 贯穿目录 `frontend.serial.catalog.*` / Event 1006/1007/1002，以及会话 `frontend.serial.session.*` / Event 1008/1009/1010；只记录结果数、连接终态、耗时和失败分类。ASP.NET 常规成功请求噪声降为 Warning，稳定产品事件与宿主生命周期保留。
- 修复 Desktop 只订阅 `Log.entryAdded` 而漏掉 `console.info` 的运行时探针缺口；现在从 `Runtime.consoleAPICalled` 接收后，先严格校验前缀、字段白名单、UUID、终态语义、数值范围和长度，再写入 `web.probe`。实际桌面启动中前端与网关 operationId `4854b1bb-813c-4a1c-96c0-9ae0b65558b8` 已一致，结果数为 2，且无 `serial.opened` 或 Web 错误。
- 首次 `pnpm test` 在 contracts/frontend 通过后，被旧 PID 25204 锁定常规 gateway `bin/Release`；没有强杀未知会话。随后把根构建/测试入口改为每次唯一的仓库内隔离 artifacts path，并在 finally 中按父目录与名称双重校验后只清理自身目录；调用方覆盖 artifacts path 会以退出码 2 失败关闭。修复后旧网关、当前桌面及 child gateway 全程保持运行，umbrella `pnpm test` 和 `pnpm build` 均通过，隔离目录残留为 0。
- 独立输出打包首次复现 277 字符 staging 深路径导致 Windows 清理报 `DirectoryNotFoundException`；内部目录改为短名 `.stg-*` / `.dn`，保留父子路径验证与失败关闭，重新打包成功且没有残留新 staging。
- 3D 栅格从固定 DPR 上限改为画布面积预算：balanced 1.75/350 万像素、constrained 1.2/180 万像素、最低 1；不改变 CSS 布局或相机。Desktop 增加 60 秒 single-flight `AETHOR_PERF_V1`，只记录白名单化 JS heap、DOM/layout 数量、可见性与运行时工作集，非法/异常即停止且不保留 CDP 原文。初版只记录 WinForms 宿主，无法解释同次 WebView2 进程组占用；现在从 WebView2 官方快照按唯一 PID 聚合浏览器进程，附可空网关与三者合计，句柄即时释放且不记录 PID/路径/命令行。性能样本还从可信打包入口把当前路由归一化为六值工作区枚举，完整 URL、查询参数和片段均不落盘。快照排除 crashpad，合计不冒充完整 OS 进程树。
- 性能探针增量当时的整仓结果为 contracts 93 + frontend 197 + gateway 83 + desktop 110 + legal inventory 6，共 489/489；2643-module production Web 与隔离 gateway/desktop Release build 通过，0 warning/0 error。标准 `development-dirty` 包重建为 697 个实际文件/696 项 manifest，disabled 与 engineering offline smoke 均通过。旧包控制台切换到终端后 WebView2 工作集由 585.7 MiB 降至 505.9–507.4 MiB，三次短周期往返保持 5 个进程，控制台约 656.7–666.1 MiB、终端约 575.8–587.7 MiB；浏览器侧三次往返始终为控制台 433 个实时元素/1 Canvas、终端 895 个实时元素/0 Canvas。新包已取得 `workspace=console` 和 `workspace=terminal` 实样本，证明分类字段落盘链有效；短周期证据不宣称完成长测或泄漏阈值验收。
- 新桌面工程版实采期间，操作者从界面发起一次 COM4 连接；旧 5127 gateway 仍占用端口，新网关在 `SerialPort.Open()` 收到 `AccessDenied`，记录关联的 `serial.open.failed` / session failed，且没有 `serial.opened` 或硬件命令。该失败暴露出从未取得句柄的临时会话仍被标记 faulted，导致宿主 shutdown 连续 409、桌面只能被外部结束。根因修复把“打开失败”在释放临时 transport 后恢复为 offline，错误继续由 API/operation probe/diagnostic 保留；已成功打开后发生的 stale/faulted 与退出门语义不变。旧 5127 gateway 未被终止，Phase 8 与实机安全项继续 `IN PROGRESS`。
- 修复包先通过 disabled/engineering 两种 offline smoke，再执行一次不连接串口的原生窗口正常关闭：桌面、自有 Gateway 和 WebView2 进程树均退出，旧 PID 25204/5127 仍在。最终工程会话重新打开后只完成串口目录读取，连续结果数为 2；当前段 `serial.opened=0`、session connect=0、硬件命令=0、Web error/exception=0，并取得稳定的 `workspace=console` 性能样本。没有为制造证据再次点击 COM4，因此真实占用端口失败路径仍由 fake transport 回归证明。
- 继续审计串口防堵时发现 `Read()` 已有 100 ms 窗口、`Write()` 已有 2 秒驱动超时，但同步 `SerialPort.Open()` 没有独立总门。新增默认 5000 ms、可在 `100–30000 ms` 内配置的打开超时；超时或 HTTP 取消立即启动候选连接 dispose、回到 offline、记录 `serial.open.timeout/cancelled`，并隔离当前 Gateway 的后续打开直至重启，避免不响应取消的原生工作项被重复累积。底层 Open 忽略取消、应用超时、调用方取消、唯一 dispose、允许宿主退出与零第二 transport 均有 fake 回归。整仓更新为 494/494，2643-module Web 与两个隔离 Release build 通过，0 warning/0 error。Windows `development-dirty` 包已重建为 697 个实际文件/696 项 manifest；disabled/engineering offline smoke 均完成 COM1/COM4 枚举、offline/202/进程退出与零写入。最终工程版从新包启动，当前段只有两次目录结果、无串口打开/连接/命令/Web 错误。未再次触碰 COM4。
- 新增 `docs/系统工程说明.md` 作为接手工程时的总览入口，按当前源码说明目录职责、前端与 C# 技术栈、Profile 切换、网关实现选择、REST/SignalR/串口通信、状态所有权、桌面生命周期和新机器人接入顺序；`docs/README.md` 已将其列为第一阅读入口。说明文件不复制完整 Schema 或固件命令表，具体字段继续链接到原有契约和协议事实源。
- 设备页新增 Windows 桌面诊断包导出，解决现场只能手工定位和复制轮转日志的问题。`DesktopBridgeV1.exportDiagnostics` 由宿主完成原生文件选择、加锁快照、二次脱敏和原子写盘；ZIP 固定包含说明、manifest 及最多五份日志（单份不超过 6 MiB、总日志不超过 30 MiB），排除终端/协议历史、命令审计、关节目标、Profile 和模型资源。浏览器模式明确不可用，取消或失败不留半成品，已有目标只有显式确认才覆盖。
- 诊断包增量后的整仓回归为 contracts 93 + frontend 201 + gateway 88 + desktop 118 + legal inventory 6，共 506/506；strict TypeScript、2643-module production Web、两个隔离 .NET Release build 和三档生产 E2E 63/63 通过。重建 `development-dirty` 包为 697 个实际文件/696 项 manifest，disabled/engineering offline smoke 均完成 ready、目录预检、offline、shutdown 202 和进程退出；本次仅枚举到 COM1，没有打开串口或发送硬件命令。原生文件对话框尚未做人工目视，因此不标记 Phase 8B 完成。

## 2026-08-10 - Aethor_robo A0 双七轴模型控制台完成

- A0 退出门已关闭：规范化整机 Profile、左右两个七轴控制组、全局 Profile 隔离、整机/左右臂取景、参考网格、关节直接预览、同源资产一次恢复、按需渲染和 3D 资源唯一释放均有当前证据；Aethor_robo 仍无网关、反馈、使能、停止或下发路径。
- 当前回归为 contracts 93 + frontend 184 + gateway 82 + desktop 79 + legal inventory 1，共 439/439；Profile 溯源、strict TypeScript、Web 2639 modules、隔离 gateway Release 与 desktop Release build 通过，三档生产 E2E 63/63 通过。
- 修正规范化 URDF 哈希在 Profile/NOTICE 中的文档漂移，并把架构中的参考网格参数同步为实际 2 倍足迹、最小 6 m、最低点下方 6% 且 8–30 cm 有界实现。来源几何、惯量、关节定义和 23 个 STL 未改变。
- 本轮未新启动或访问网关，未枚举或打开 COM4、未发送硬件命令；既有未知 COM4 会话保持原样。来源包仍缺完整 BSD 条款；A1 仍因固件和独立协议证据缺失保持 `BLOCKED`，A0 完成不扩大任何硬件 capability。

## 2026-08-10 - Dummy 串口停滞恢复与 Desktop/Web 对齐（Phase 5 / 8 IN PROGRESS）

- 定位 J2 不更新并非关节索引错误：Dummy `#GETJPOS` 第二字段、manifest `protocolIndex=1`、网关六轴数组和前端 J2 均一致；实际故障是无回包 `!START` 占有串口 I/O 后三查询轮询整体停止。
- SerialPort adapter 不再依赖 Windows `BaseStream.ReadAsync` 的非可靠取消，改为 100 ms 有界同步读窗口；engineering direct 纳入唯一命令所有权，停止去使能可先取消 direct，断开/关闭会等待所有 runner 收束。新增 adapter 取消、STOP 抢占无回包 direct 和重连后 J2 更新回归。
- 成功断开现在清空会话协议/命令证据、连接、遥测和目标草稿，控制台模型与相机恢复到软件启动状态；已保存动作、布局和偏好继续保留，且不把软件姿态宣称为物理 HOME。
- 桌面与 Web 使用同一打包 `dist`；无参数桌面维持 Production/disabled，显式 `--engineering` 才启动 Development engineering 网关且仍不自动打开串口。新增同源圆角星环多尺寸 ICO、工程快捷方式脚本和子进程清理说明。
- 当前软件回归为 contracts 93/93、frontend 184/184、gateway Debug/隔离 Release 82/82、desktop Debug/Release 79/79、legal inventory 1/1，共 439/439；三档 E2E 63/63。隔离 publish 生成 689 文件/688 manifest 的新包并通过 disabled/offline/202/进程退出/零串口 smoke；工程快捷方式已创建但未启动。COM4 旧未知会话的精确清理和工程桌面实启仍待物理安全确认，因此阶段保持 `IN PROGRESS`。

## 2026-08-10 - Dummy engineering 直连调试与错误端口释放（Phase 5 / 7 IN PROGRESS）

- RobotGatewayV1 升级为 1.2，新增仅限 Development + 本机令牌的 `engineering` policy 与受限 direct endpoint。C# 仍是唯一串口所有者，只接受 Dummy 查询、`!START/!STOP/!DISABLE`、模式 1–3 和带显式速度的六轴整组目标；HOME/RESET、RGB、电流/PID、reboot、多行、非 ASCII 与任意 raw 在写入前拒绝。
- 删除前端管理员/专家解锁。终端始终可编辑，只有 gateway 协商 direct capability 且 session/状态门成立时才能发送；控制台在 measured、enabled、有效 mode 与合法六轴目标时可下发。该日最初只显示 FIFO `queued / deviceQueued`；2026-08-12 最终改为 transport 写入即 `SENT · MANUAL CONFIRM`，不依赖 FIFO/ACK，也不冒充独立实测到位。
- 修复错误 COM 会话无法退出：stale/unknown/faulted 允许人工释放，明确 `motor=enabled` 或存在在途命令时仍拒绝普通断开；后端与顶栏/设备页使用同一规则。没有加入自动重连或第二串口 owner。
- 新增 `pnpm dev:engineering` 统一入口：只从被忽略的 `.env.local` 读取本机令牌，拒绝复用未知 5127 owner，启动后必须自证 `v1.2 / engineering / directCommand / offline`。首次实跑发现自检 Header 名错误并修正；失败进程经官方 shutdown 在 offline 状态释放，随后入口成功，页面保持 Dummy offline。1280×720 实页检查还修复了速度单位与说明挤压。
- E2E 构建新增固定无网关 mode，本机 `.env.local` 的开发 URL/令牌不再污染零硬件请求验收。整仓 contracts 93 + frontend 182 + gateway 79 + desktop 74 + legal inventory 1，共 429/429；strict TypeScript、Web/.NET Release build 通过，0 warning/0 error；最终 Edge 三档生产 E2E 63/63 通过。验证期间只枚举到 COM1/COM4，未打开 COM4、未发送硬件命令。

## 2026-08-10 - Dummy 全局串口入口与实测基准对齐（Phase 5 / 7 IN PROGRESS）

- 顶栏加入紧凑串口组件：经既有 `RobotGatewayV1` 刷新端口、手动选择、显式连接和在 `valid + disabled` 条件下断开；与设备页共享 active port/session，不直接占有串口、不自动连接、不重试。Aethor_robo 下固定不适用且零枚举。
- 新 Dummy hardware session 的首个可信 `measured + valid` 六轴帧会把实体反馈与幽灵目标建立同一初始基准；操作者先编辑时取消待对齐，后续实测更新不会覆盖目标草稿。该逻辑不宣称实机零位、关节方向或运动到位已验证。
- 顶栏移除 `FRONTEND SHOWCASE` 文案和重复 SERIAL/URDF 状态，保留 `MOTOR / FEEDBACK / MODE`；Dummy 控制台移除 `Target preview` 提示窗，最近事件不再追加中文翻译；终端可见名称统一为“管理员模式”，仍无 raw 发送端点。
- 新增串口组件、端口状态同步和首帧目标隔离回归；整仓 contracts 91 + frontend 182 + gateway 72 + desktop 74 + legal inventory 1，共 420/420，strict TypeScript 与完整 Release build 通过，Web/.NET 为 0 warning/0 error；三档生产 E2E 63/63 通过并更新视觉基线。验证后仅启动本机 `commandPolicy=disabled` 只读网关，session 保持 offline，枚举到 COM1/COM4 但未打开串口；Gate B 仍被四参数运动包络阻止。

## 2026-08-10 - Phase 7B Dummy 受监督只读采证入口（Phase 7 IN PROGRESS）

- 新增 `gateway:soak:readonly`：只有精确授权短语、操作者/授权编号、当前 InstanceId 与工作区、物理急停、静止、预期 disabled、只读范围五项确认齐全后，才会创建证据目录并启动 Release 网关。真实路径强制 `commandPolicy=disabled`、清空运动包络、只连接 `dummy-6dof`，capability 必须没有任何 supported command。
- 采样只通过 REST 观察三个查询产生的 measured session/joint/protocol；持续时间限制 60–14400 秒、间隔 1–10 秒，逐行记录关节 sequence/六轴角、working set/private memory/handle/CPU，非法 TX、协议 error、stale/faulted/enabled、session/profile 变化或 sequence 停滞立即失败且不自动重连。
- finally 固定执行 disconnect、宿主 202、等待自有 PID、必要时只终止该 PID、token 泄漏扫描、环境恢复和不可连接 post-cleanup。`evidenceCollectionPassed` 只表示采集与清理可信；资源阈值、浏览器 heap、故障注入和 `phase7bCompleted` 固定为未评估/false。
- PowerShell AST 与 `-ValidateOnly` 通过，根 `pnpm gateway:soak:readonly -PortName ... -ValidateOnly` 命令可直接执行且为零 gateway/网络/串口/硬件命令/文件变更；确认 pnpm 会把额外 `--` 原样传给 PowerShell 后，手册已移除该错误分隔符。缺授权短语的负向门在证据目录和进程创建前失败，gateway/5127 为 0；静态 OperationalScriptSafetyTests 5/5。整仓 contracts 91 + frontend 177 + gateway 72 + desktop 74 + legal inventory 1，共 415/415 通过；strict TypeScript、Web 2639 modules 与两个 .NET Release build 通过，0 warning/0 error。没有运行真实路径，没有打开 COM4。

## 2026-08-10 - Dummy 串口重复启停与不合作 I/O 资源回归（Phase 5 / 7 IN PROGRESS）

- 端到端复核 RobotGateway 的串口所有权：轮询与命令继续共用单一 `serialIoGate`，查询/STOP 等待、协议历史和事件队列保持有界；断开与宿主关闭先关闭 transport 句柄，再等待可能忽略 cancellation 的读写任务。没有增加重试、第二套命令队列或 raw 串口入口。
- 把正常连接/有效轮询/断开资源循环由 3 次提高到 32 次；新增 32 次“读取忽略 cancellation”的连接/关闭循环，以及“写入忽略 cancellation 且阻塞到句柄关闭”的关闭顺序回归。每个 fake transport 必须恰好 open/close/dispose 一次并回到 `offline`。
- 新增连续 64 个完整三查询状态周期的压力回归；关节序号持续推进、所有 TX 仍只属于查询白名单，协议历史严格保持 64 条配置上限，断开后 transport 唯一释放。
- 聚焦只读网关 14/14、完整 gateway 71/71、整仓 contracts 91 + frontend 177 + gateway 71 + desktop 74 + legal inventory 1，共 414/414 通过；strict TypeScript 与完整 Release build 通过，Web 2639 modules、两个 .NET 构建 0 warning/0 error。本轮没有启动网关、打开 COM4 或发送硬件命令；fake 负载只证明软件资源所有权，不替代 Phase 7B 的真实驱动长测、工作集/heap 曲线和拔线证据。

## 2026-08-10 - Dummy / Aethor_robo 整机 Profile 切换（A0 / Phase 5 IN PROGRESS）

- 顶栏 `Current profile` 现为唯一整机选择器：`Dummy` 对应一台六轴机械臂，`Aethor_robo` 对应包含左右两个七轴臂的空间机器人；Aethor_robo 页内的左右臂 tab 保持二级选择。
- AppShell 只在 Dummy 激活时挂载网关会话协调器和安全告警。示波、终端、动作编排在 Aethor_robo 下显示 Dummy 专属能力边界；设备页按当前 Profile 显示各自模型、协议、映射和硬件就绪状态。
- 切换会撤销两台设备的隐藏目标草稿、终端管理员模式、Dummy runtime 与遥测。Dummy 非 offline、存在联锁或未确认去使能时拒绝切走；切换本身不发送停止、断开或任何串口命令。
- Dummy 六轴控制台恢复实体/目标幽灵预览、滑块/数值/键盘/3D 目标编辑、反馈来源标记和完整关节组许可门。缺少 Gate B 四参数运动包络时读取与下发继续失败关闭。

验证与边界：
- `pnpm typecheck`、411 项全仓库测试（contracts 91、frontend 177、gateway 68、desktop 74、legal inventory 1）和 Web/.NET Release build 通过；C# 0 warning/0 error。Web 为 2639 modules，复制 37 项 Profile 资源。
- 三档生产 Playwright 63/63 通过，覆盖 Aethor_robo→Dummy→Aethor_robo 切换、目标草稿复位、能力隔离、所有工作区无根溢出和更新后的视觉基线。
- COM4 只执行枚举与配置预检：设备身份匹配、PnP `OK`、gateway/process/listener 为 0；脚本明确报告 `hardwareAccessAuthorized=false`、`gatewayStarted=false`、`serialPortOpened=false`、`networkRequestSent=false`。未打开串口、未发送任何命令，Gate B 仍被缺失四参数运动包络阻止。
- 最新 Windows `development-dirty` 包已重建并纳入本增量：包内 `web/` 与当前 `dist/` 的 54 个文件逐项 SHA-256 完全一致；687 项 manifest / 688 个实际文件闭包通过。离线 smoke 为 `gateway ready / session offline / commandPolicy disabled / shutdown 202`，实际 96 DPI 窗口保持 Per-Monitor V2 且零网关；发布 verifier 以脏工作树、未签名和 6 个许可正文缺口共 12 项问题按预期拒绝。A0 与 Phase 5–8 仍共享未完成工作树，不能创建或推送误导性的阶段完成提交。

## 2026-08-10 - Windows 第三方生产依赖与 SPDX 发布门（Phase 8 IN PROGRESS）

根因与改动：
- 便携包此前只有模型 NOTICE/provenance，没有从实际生产依赖生成的第三方清单；发布人员无法证明 Web bundle、.NET runtime pack、WebView2 与串口库的版本及许可材料闭包。
- 新增确定性清单生成器与 Node 回归：输入为 `pnpm licenses list --prod`、桌面/网关发布后的 `.deps.json` 和已还原 NuGet 包，输出 SPDX 2.3、机器可读缺口摘要、人类可读清单、npm 包根法律文本及 NuGet/runtime 原始法律文件；宿主绝对路径不进入产物。
- Windows 构建在计算 manifest 前生成并复制上述材料；package smoke 交叉验证版本/commit/构建时间、组件/PURL/关系/缺口计数与所有法律附件。release verifier 对任何缺失包内许可正文增加 `third-party-license-incomplete`，不把 SPDX 声明表达式误当成完整再分发材料。

验证与边界：
- 清单单测与 SPDX 官方 2.3 JSON Schema 校验通过。整仓回归为 contracts 91 + frontend 172 + gateway 68 + desktop 74 + legal inventory 1，共 406/406；Web 2630 modules、两个 .NET Release build 0 warning/0 error、三档生产 E2E 60/60。重建包为 688 个实际文件/687 项 manifest；离线 smoke 验证 93 个组件（88 npm、5 NuGet/runtime pack）、6 个缺失正文、gateway ready、session offline、command policy disabled、shutdown 202、零串口/零硬件命令。
- 只读 release verifier 按预期以 12 项问题拒绝当前脏且未签名的开发包，其中唯一 `third-party-license-incomplete` 精确列出 SignalR、React Three Fiber、react-remove-scroll-bar、tr46、urdf-loader 与 System.IO.Ports。
- 该清单覆盖随包生产依赖，不覆盖构建/测试工具。六项文本和两个模型再分发条款仍需权威来源或法律处置；在此之前 Phase 8 保持 `IN PROGRESS`，不生成正式候选、不提交阶段完成记录。未打开 COM4，未发送硬件命令。

## 2026-08-10 - Windows 模型分发闭包与实际 DPI 采证（Phase 8 IN PROGRESS）

根因与改动：
- Windows 包已包含 Aethor_robo URDF/STL，但顶层 `Legal/` 只复制 Dummy NOTICE，发布说明也只提 Dummy；模型分发的来源、能力限制和许可缺口无法从统一法律入口复核。
- 打包脚本现集中复制 Dummy NOTICE、Aethor_robo NOTICE 与 Aethor_robo 机器可读 provenance。构建缺源文件即中止；package smoke 和 release-candidate verifier 要求四项发布/法律文件进入 manifest，缺项失败关闭。Dummy NOTICE 也明确记录源包缺少完整 BSD-3-Clause 条款。
- 新增 `collect-dpi-evidence.ps1`：以 `--offline` 启动实际包窗口，从 HWND 读取 `GetDpiForWindow`、Per-Monitor V2 context、显示器工作区和窗口可见范围；期望 DPI 不匹配或恢复越界会失败，默认有界关闭精确离线 PID。

验证与边界：
- 旧 674 文件包被新 smoke 以缺少 Aethor_robo NOTICE 拒绝，发布 verifier 返回两项 `legal-asset-missing`；重建后为 676 个实际文件/675 项 manifest，离线 smoke 通过。发布 verifier 不再报告法律缺项，但仍因脏工作树、未签名和 `development-dirty` 按设计拒绝。
- 本机 DISPLAY1 为 1920×1080、96 DPI；实际窗口读回 `PerMonitorV2=true`，1600×940 窗口完全位于 1920×1032 工作区，网关为 0。故意声明 120 DPI 时正确失败并清理桌面/API 进程。
- 最终回归为 contracts 91 + frontend 172 + gateway 68 + desktop 74，共 405/405；Web 2630 modules，两个 .NET Release build 0 warning/0 error，完整三档生产 E2E 60/60。
- 该证据只覆盖 100%；125/150/200%、真实多显示器、完整第三方依赖许可清单、MSI、Publisher/证书与 COM4 仍未关闭。未打开串口，未发送硬件命令。

## 2026-08-10 - 控制台参考平面、字体与边界收束（A0 / Phase 2 IN PROGRESS）

改动：
- 参考网格不再固定在世界原点：模型就绪后从完整实体/幽灵世界包围盒计算整机 X/Z 足迹，将平面放到最低点下方模型高度的 6%（限制为 8–30 cm），按 2 倍足迹扩展且最小边长 6 m，网格密度限制在 24–80 格。左右臂相机取景不会缩小整机参考平面。
- UI 正文与标题统一使用 `Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` 本地回退栈、optical sizing、标准连字和 contextual alternates；不下载在线字体。产品名、导航与普通说明使用自然/句首大小写，协议、单位、轴名和机器状态码保留大写。
- 顶栏和侧栏 Profile 统一显示精确产品名 `Aethor_robo`，不再拼接 `DUAL 7-DOF` 或全大写别名；Current profile 使用单行裁切且不越出控件。紧凑顶栏把未定义电机和反馈分别显示为 `N/A`、`NO DATA`，完整语义保留在 title；状态值增加通用单行裁切边界。右侧关节列表与固定 `MODEL PREVIEW ONLY` 区增加独立滚动、稳定滚动槽和明确分隔。
- 修复 1920×1080 下反馈 HUD 与关节微调 HUD 的 3 px 重叠，两个浮层现在保留明确间隔。

验证与边界：
- 新增参考平面边界、Profile 命名和三档几何顺序断言；1366×768、1920×1080、2560×1440 的 3 张视觉基线均人工复核，无根文档溢出、关键区域越界或关节列表/固定操作区重叠。
- 整仓 406/406 通过：contracts 91、frontend 172、gateway 68、desktop 74、legal inventory 1；完整三档生产 E2E 60/60 通过。Web 2630 modules、37 项 Profile 资源，网关/桌面 Release 0 warning/0 error。
- 本轮未重建 Windows 便携包；现有开发包不包含本次 UI 增量，正式包仍由 Phase 8 发布门另行闭合。
- 修改只影响本地展示和测试诊断；没有创建 Aethor_robo 硬件路径，没有打开 COM4，也没有发送串口命令。

## 2026-08-10 - 双七轴三维场景按需渲染（A0 / Phase 8 IN PROGRESS）

根因与改动：
- Aethor_robo 控制台原先使用 R3F 默认永久帧循环，模型、相机和关节静止时仍持续提交 WebGL 帧。
- Canvas 改为 `frameloop="demand"`；OrbitControls change/阻尼、相机 fit、模型 READY、关节姿态、可见性/轴/高亮和拖拽生命周期均显式 invalidate。场景增加只读实际帧计数，供生产 E2E 验证，不参与业务状态。

验证与边界：
- 三档生产构建 E2E 3/3 证明空闲帧计数收敛、L-J1 目标预览后立即恢复并再次收敛；相机重置/左右臂取景、3D 拖拽和三次重挂载资源释放相邻回归 12/12 通过。
- 整仓 401/401、完整三档生产 E2E 60/60 通过；Web 2629 modules、37 项 Profile 资源，网关/桌面 Release 0 warning/0 error。
- 最新 `development-dirty` 包为 674 个实际文件/673 项 manifest；闭包 smoke 为 gateway ready、session offline、command policy disabled、shutdown 202、进程退出、零串口/零硬件命令。
- 修改只影响本地 3D 渲染调度；没有创建 Aethor_robo 串口/协议路径，没有打开 COM4，也没有发送硬件命令。

## 2026-08-10 - 事件发布器有界关闭与串口释放（Phase 5/8 IN PROGRESS）

根因与改动：
- `RobotGateway.DisposeAsync` 原先虽然先释放 transport，却会无界等待 SignalR 事件 sink；sink 忽略 cancellation 时，宿主关闭仍可能永久挂起。
- 每次事件发布新增 100 ms–30 s 独立超时；超时记录 `events.publish.timeout` 并停止事件泵，避免继续累积悬挂发布。关闭先完成命令/轮询与 transport 释放，再按独立窗口排空、取消事件泵；不合作 sink 只产生诊断，不再阻塞 dispose。

验证与边界：
- 先用永不完成且忽略 cancellation 的 fake sink 复现 3 秒外仍未返回；修复后聚焦 3/3、完整 gateway 68/68 通过，覆盖单次悬挂上限、关闭有界和配置边界。
- 整仓 401/401 通过：contracts 91、frontend 168、gateway 68、desktop 74；Web 2629 modules、37 项 Profile 资源，网关/桌面 Release 均为 0 warning/0 error。
- 重建 `development-dirty` 包后，674 个实际文件与 673 项 manifest 闭合；离线 smoke 为 gateway ready、session offline、command policy disabled、shutdown 202、进程退出、零串口/零硬件命令。
- REST session/joint/history 仍是权威恢复源；事件超时不伪造发布成功。该软件门未打开 COM4、未发送硬件命令，也不替代真实驱动卡死与句柄释放验收。

## 2026-08-10 - Phase 6B-S 无生产接线动作执行内核（Phase 6 IN PROGRESS）

需求：
- 在不等待 Gate B 实机运动、也不新增任何硬件可达入口的前提下，提前验证动作逐点执行、停止、恢复和资源生命周期语义。

实现：
- 在 C# Domain/Application 增加 `ActionProgramExecutionPlan`、运行结果/checkpoint 与独立 `ActionProgramRunner`；只依赖 fake `IActionProgramCommandPort`，没有 DI、REST/SignalR、真实 RobotGateway adapter 或前端入口。
- 首点和模式变化先确认模式，关节组只接受 `completed + feedbackConfirmed`；当前点确认后才执行 `durationAfterConfirmed`。相同模式不会重复下发，任何点失败都不会构造后续点命令。
- SHOWCASE、Aethor_robo、错误 DOF/限位、非正速度和 checkpoint 不匹配在 port 接管前拒绝。恢复绑定 program revision、session、计划 SHA-256 与最后确认点。
- 停止、命令等待超时、弱证据和内部故障终止序列，并至多执行一次有界 stop-and-disable；停止未确认时保持失败并提示物理急停。dispose 复用同一停止路径。

验证：
- 11/11 聚焦 fake-port 测试通过，覆盖逐点成功、弱证据、模式确认后停止竞态、操作者停止、停止未确认、恢复、并发、命令超时、内部故障、非法计划和 dispose。
- 全仓库 398 项测试通过：contracts 91、frontend 168、gateway 65、desktop 74；Web 2629 modules、37 项 Profile 资源，两个 .NET Release 构建均为 0 warning/0 error。
- `/actions` 当前生产构建三档 E2E 3/3 继续显示禁用运行入口，编辑/保存/刷新期间 fetch/XHR/WebSocket 为 0；生产 API/前端对执行内核零引用。本轮未启动网关、未打开 COM4、未发送硬件命令。
- Windows `development-dirty` 包已重建，674 个文件与 673 项 manifest 完全闭合；Application DLL 包含当前 6B-S 类型，离线 smoke 仍为 command policy disabled、session offline、shutdown 202、零串口/零硬件命令。

限制：
- 6B-S 不是 wire contract 或可运行产品功能。6B-H 的受管运行计划、真实 adapter、API、审计恢复、前端风险确认与监督实机执行仍依赖 Phase 5 Gate B；Aethor_robo 必须等待独立固件与协议后另行版本化。

## 2026-08-10 - Windows 打包并发锁与 manifest 闭包（Phase 8 IN PROGRESS）

需求：
- 保证便携包在重复/并发构建和外层命令超时时不会混入另一份暂存产物，并让离线 smoke 验证包内完整文件集合而不只是已声明文件。

根因与改动：
- 外层打包调用超时后，子 PowerShell 仍可继续运行；第二个构建并发完成时，`Move-Item` 会在目标已存在后把暂存目录作为子目录嵌入，而原 smoke 只校验 manifest 声明项，未拒绝额外文件。
- 同一版本和 Runtime 新增输出文件独占锁；第二个构建在任何包替换前失败。最终目录提升改用目标已存在即失败的 `Directory.Move`，不再具有嵌套语义。
- 包 smoke 新增重复路径、文件长度、实际文件集合和数量校验，任何未声明文件都在启动网关前失败。

验证：
- 受污染包实际 1348 个文件、manifest 673 项；新 smoke 按预期以 `Package contains an unmanifested file` 失败，且网关进程/listener 均为 0。
- 人工持有构建锁后启动第二个构建，脚本立即报告已有构建占用；现有包仍在、暂存目录为 0。
- 重建的 `development-dirty` 包为 674 个实际文件（673 个 manifest 条目 + 1 个 manifest），闭包 smoke 通过；gateway ready、session offline、command policy disabled、shutdown 202、进程退出，零串口/零硬件命令。
- 包内 `ConsolePage` 包含 `AETHOR_ROBO URDF READY`，且所有 Web 资源均不含伪 `WEBGL INITIALIZATION FAILED` 文本。

限制：
- 该结果仍是未签名脏工作树开发包，不是正式候选；Phase 8B 的 MSI、签名、DPI/多显示器和监督硬件退出门保持不变。

## 2026-08-10 - 三维可访问性状态与当前构建 E2E 门（A0 / Phase 8 IN PROGRESS）

需求：
- 保证控制台的视觉状态、可访问性语义和自动化诊断一致，并确保三档 Playwright 验收的是当前源代码对应的生产构建。

根因与改动：
- `@react-three/fiber` 的 `Canvas fallback` 会成为原生 `canvas` 子节点；浏览器视觉上隐藏这些内容，但 Windows 可访问性树仍可能读取其中的 `role="alert"`，造成模型已 READY 却同时报告 `WEBGL INITIALIZATION FAILED`。移除该伪错误节点，真实 WebGL 缺失、外层渲染异常和上下文丢失仍由既有失败路径处理。
- 增加成功 Canvas 与失败告警互斥的组件回归，并在三档 E2E 中断言 `AETHOR_ROBO URDF READY` 时不存在 `scene-fallback`。
- 发现 `test:e2e` 原先直接 `vite preview`，可能读取旧 `dist`。前端 E2E 命令现先执行根 `build:web`，把 Profile 溯源、TypeScript、Vite 当前构建与 Playwright 放入同一门禁。

验证：
- 新回归在修复前稳定失败，修复后 10/10 聚焦测试和 strict TypeScript 通过。
- 当前构建的三档 Edge Playwright 57/57 通过；READY 与场景失败节点互斥，真实 URDF 失败用例仍通过。
- 全仓库 387 项测试通过：contracts 91、frontend 168、gateway 54、desktop 74；Web 2629 modules、37 项 Profile 资源，两个 .NET Release 构建均为 0 warning/0 error。
- 未启动网关、未打开 COM4、未发送硬件命令。

限制：
- 该门证明 DOM/可访问性语义的因果修复；正式发布包仍需在 Phase 8B 的四档 DPI、多显示器和 Windows 辅助技术人工验收中复核。

## 2026-08-10 - 桌面 loopback 代理隔离与真实恢复闭环（Phase 8B IN PROGRESS）

需求：
- 保证 Windows 桌面壳在操作者启用本机代理时仍能可靠监督自有网关，并完成网关异常退出后的真实离线恢复按钮验收；不得打开串口或自动恢复控制。

改动：
- 根因是 `GatewayProcessSupervisor` 的默认 `HttpClient` 继承了 `HTTP_PROXY/HTTPS_PROXY`。本机没有 `NO_PROXY` 时，已监听的 loopback 网关无法收到 readiness 请求，桌面连续耗尽三个候选后错误降级离线。
- readiness 与 host shutdown 改用 `UseProxy=false`、`AllowAutoRedirect=false` 的专用 loopback handler；不修改系统代理，也不要求用户用环境变量修补产品行为。
- 增加代理隔离回归，并同步桌面 README、架构、ADR-0007、Phase 8 runbook/handoff、路线图和验收矩阵。

验证：
- 本机保持 `HTTP_PROXY/HTTPS_PROXY=http://127.0.0.1:7877` 且无 `NO_PROXY`：修复前 3 个已监听候选均健康检查超时；修复后只启动 1 个候选，`/health/ready` 返回 200，5 秒后仍为唯一子网关。
- 终止精确包子网关后，原生面板明确显示设备未知且不会自动重连，5 秒内网关为 0；真实点击“以离线模式重新启动”后旧桌面退出，只出现一个带 `--offline --web-root` 的新桌面，网关为 0。清理后桌面/API/5127 listener 均为 0。
- 相邻正常关闭路径同样只产生一个候选；`POST /api/v1/host/shutdown` 返回 202，桌面记录 `Gateway process stopped and released`，最终桌面/API 进程均为 0。
- 全仓库 386 项测试通过：contracts 91、frontend 167、gateway 54、desktop 74；Release build 通过，Web 2629 modules、37 项 Profile 资源，两个 .NET 工程 0 warning/0 error。
- `development-dirty` 包共 674 个文件，manifest 校验 673 项；离线 smoke 确认 gateway ready、session offline、command policy disabled、shutdown accepted、gateway exited，且零串口、零硬件命令。

待完善：
- Phase 8 仍缺正式 MSI、Publisher/证书签名、安装/修复/升级/卸载、100/125/150/200% DPI 与真实多显示器目视，以及独立授权的 7B/8B 硬件回归，因此不标记 `DONE`、不创建阶段完成提交。

## 2026-08-10 - Aethor_robo 控制台交互与渲染收束（A0 IN PROGRESS）

需求：
- 在不引入动力学、硬件发送或脆弱机器耗时阈值的前提下，提高双七轴控制台连续拖动、工具窗移动和三维预览的流畅度。

实现：
- `ConsolePage` 不再订阅完整 workbench store；窗口坐标只由对应工具窗消费，移动诊断/模型树/显示窗口不会重绘 3D 场景。目标 store 订阅拆到场景、关节面板、选中关节 HUD 和底部摘要，静态页面骨架不随每次关节输入重渲染。
- 实体姿态与目标姿态分离更新；后续帧只调用数值发生变化的关节。相机联合包围盒只在模型就绪、整机/左右臂取景变化或显式重置时计算，连续目标输入不再遍历整机。
- 目标幽灵不绘制 collision；23 份共享 geometry 保持不变，目标材质由每 mesh 改为 14 个受控关节与一个基础组共享，仍保留关节独立高亮。诊断由 `29 geometry / 53 material` 降为 `29 / 22`。
- 增加工具窗坐标零场景重绘、差量关节应用、目标 collision 隐藏/材质共享、相机 bounds revision 和三档重复挂载回归。

验证：
- 优化前在本机 Edge 1920×1080、软件 GPU 受限模式下执行 8 组 × 24 次同步输入，批次中位约 350 ms、最大约 439 ms；优化后同脚本中位约 237 ms、最大约 281 ms。该对比仅用于定位和前后对照，不宣称硬件级 FPS/WCET。
- 全仓库 385 项测试通过：contracts 91、frontend 167、gateway 54、desktop 73；strict TypeScript 与 Release build 通过，Web 构建 2629 modules、复制 37 项 Profile 资源，两个 .NET 工程 0 warning/0 error。
- 三档 geometry/material、相机按需重算和重复挂载专项 E2E 9/9 通过；三档完整 Playwright 57/57 通过。实页确认 `29 / 22`、14 轴本地预览和硬件禁用状态保持。
- 未启动网关、未打开 COM4、未发送硬件命令。

待完善：
- 正式发布机仍需在独立 GPU/多显示器与 100/125/150/200% DPI 下记录长时间帧时间、GPU/进程内存和输入延迟；当前自动门保护更新范围和资源所有权，不用单台开发机时间阈值冒充工业 WCET。
- A0 仍与 Phase 5–8 共用未完成工作树，不能创建或推送误导性的独立完成提交。

## 2026-08-10 - 串口非阻塞与关闭收束门（Phase 5 IN PROGRESS）

需求：
- 工业控制链不能因轮询、驱动取消失效或在途命令让普通操作、STOP、断开和宿主退出无限等待。

实现：
- 普通命令和 STOP 取得 `serialIoGate` 均受 `CommandTimeout` 约束；零写入的普通命令超时拒绝，STOP 超时返回 `unconfirmed + timeout`、反馈降为 stale 并锁存安全联锁。
- 人工 disconnect 在存在在途硬件命令时失败关闭，即使最后一帧仍显示 disabled 也不能释放 session。
- session 清理先取消轮询/runner 并关闭串口句柄，以打断不响应 cancellation token 的 pending read；随后等待唯一终态并 dispose transport。关闭触发的 I/O 退出记录为取消且明确物理状态未知。
- 新增 fake transport 回归，覆盖轮询持有串口时 STOP 有界返回、在途使能时人工断开拒绝，以及忽略 read cancellation 时宿主关闭无需注入伪回包即可完成。

验证：
- 聚焦串口回归 3/3、gateway Release 54/54 通过。
- strict TypeScript、全仓库 382 项测试和 Release build 通过；Web 构建 2629 modules、复制 37 项 Profile 资源，两个 .NET 工程 0 warning/0 error。
- 三档 Playwright 57/57 通过；未启动网关、未打开 COM4、未发送任何硬件命令。

待完善：
- fake-driver 软件门不能替代 COM4 上的拔线、驱动卡死、STOP 延迟和资源释放实测；这些仍属于 Phase 5 Gate B/Phase 7B 的新授权监督验收。
- 固件 HOME/RESET 仍会阻塞协议线程，继续保持 unsupported。

## 2026-08-10 - Aethor_robo 三维资源去重（A0 IN PROGRESS）

需求：
- 优化双七轴空间机器人约百兆 STL 的加载和内存路径，使控制台在展示、切换和重复挂载时保持流畅且资源有界。

改动：
- 新增单模型生命周期 `SharedGeometryLoadCache`；visual/collision 对同一 URL 的并发请求只解析一次，46 个节点共享 23 份只读 geometry。
- 实体节点共享单一材质，目标幽灵仍保留独立材质以支持按关节高亮；缓存不拥有 dispose，最终对象图继续是 geometry/material 的唯一释放边界。
- 失败条目在通知订阅者前移除，原有一次同源网络重试会启动真实新加载；持续失败仍进入 `URDF LOAD FAILED`。

验证：
- 优化前运行诊断为 `52 geometry / 98 material`；优化后为 `29 / 53`，同时页面仍只请求 23 个唯一 STL URL。
- 新增 4 项缓存单元测试；strict TypeScript、shared 91 与 frontend 164 项测试通过。
- 三档 geometry 计数、重复挂载释放和一次网络中断恢复专项 E2E 9/9 通过。
- 全仓库 380 项测试和 Release build 通过，C# 0 warning/0 error；三档完整 Playwright 57/57 通过，Vite 2629 modules、复制 37 项 Profile 资源。
- 未启动网关、未打开 COM4、未发送硬件命令。

待完善：
- 正式设备上长时间 GPU/进程内存曲线仍属于后续桌面性能验收；当前证据证明对象数量和生命周期，不宣称硬件级 WCET。
- A0 仍与 Phase 5–8 共享未完成工作树，不能创建或推送误导性的独立完成提交。

## 2026-08-10 - Aethor_robo 模型迁移溯源门（A0 IN PROGRESS）

需求：
- 让来源 ZIP 到规范化 Aethor_robo Profile 的迁移具备可交接、可复核的工业证据，而不是只依赖文字声明。

改动：
- 新增 `provenance.json`，固定来源 ZIP、原始/规范化 URDF 与 23 个源 STL→规范名称的 SHA-256 映射；只读源包对账确认全部 STL 为字节一致改名。
- 新增流式 `verify-provenance.mjs`，校验路径边界、Profile 身份、许可状态、URDF 哈希、逐 STL 哈希，以及 provenance/URDF 引用/磁盘资产三方完全覆盖。
- `pnpm test:web` 与 `pnpm build:web` 在测试或构建前自动执行溯源门；完整 BSD 条款仍缺失，完整性验证不扩大分发许可。

验证：
- `pnpm profile:verify` 通过：1 个规范化 URDF、23 个字节一致 STL 映射。
- `pnpm test` 通过：contracts 91、frontend 160、gateway 52、desktop 73，共 376 项；`pnpm build` 通过，Web 2628 modules、复制 37 项 Profile 资源，两个 .NET Release build 为 0 warning/0 error。
- 三档 Edge Playwright 54/54 通过，继续覆盖模型资产、双七轴本地编辑、相机取景、故障恢复、资源释放与零硬件请求。
- 未启动网关、未打开 COM4、未发送任何硬件命令。

待完善：
- 来源 `package.xml` 只有 `author=TODO`、`maintainer=TODO@email.com` 与 `BSD` 声明，压缩包没有完整许可原文；正式对外分发前仍需来源方提供可核对的版权与许可文件。
- A0 仍与 Phase 5–8 共享未完成工作树，不能创建或推送误导性的独立完成提交。

## 2026-08-09 - Aethor_robo 双七轴控制台接入（A0 IN PROGRESS）

需求：
- 将“数字孪生”工作区改名为“控制台”，接入 `Layout11 EX1.zip` 中的 Aethor_robo 空间机器人，并只操作其左、右两个七轴机械臂。

改动：
- 新增 `aethor-robo-dual-7dof` 内置 Profile，规范化 23 links、22 joints、23 STL；两个七轴臂进入控制组，六个车轮只做模型展示。
- 规范路由改为 `/console`，旧 `/twin` 兼容重定向；控制台改用独立 14 轴本地 store，不消费 Dummy gateway 或目标草稿。
- 顶栏、模型状态与主操作区明确显示 `OFFLINE / UNAVAILABLE / MODEL ONLY / HARDWARE PENDING`；读取、下发和软件急停固定禁用。
- `RobotProfileManifestV1` 新增可选 `jointGroups`，并校验组唯一性、关节覆盖和 TCP link；无硬件能力的 Profile 可以诚实声明空 `controlModes`。
- 控制台新增“整机 / 左臂 / 右臂”显式取景；分组取景使用 Profile 关节组的实际/幽灵联合包围盒，切换机械臂会同步控制组但不会修改任何关节值。
- 实页验收发现自动相机取景距离约 8.04，而固定场景雾在 7 处完全遮蔽整机；移除固定距离雾化后模型恢复可见。
- Playwright trace 定位到本机网络切换会让 11 个 loopback STL 请求以 `net::ERR_NETWORK_CHANGED` 中断；同源只读 URDF/STL 现有界重试一次，持续失败仍明确进入 `URDF LOAD FAILED`，该策略不覆盖 API、SignalR 或硬件命令。
- 同步产品边界、架构、路线图、验收矩阵、公共提示词、Profile 档案与当前交接；后续阶段必须分别记录 Dummy 与 Aethor_robo 影响。

验证：
- 全仓库 376 项测试通过：contracts 91、frontend 160、gateway 52、desktop 73；strict TypeScript、Vite 与两个 .NET Release build 通过，C# 0 warning/0 error，当前 37 项内置 Profile 资源被复制。
- 浏览器 1920×1080 实页确认 `/console` 无根文档横向溢出、Aethor_robo URDF ready、模型可见、双七轴分组存在、硬件下发禁用且控制台无 warning/error。
- 三档 Edge Playwright 54/54 通过，覆盖 23 个 STL、左右七轴编辑、整机/分组取景恢复、3D 拖拽、一次同源资源中断恢复、持续失败可见、重复挂载资源释放、旧路由兼容、零硬件请求和控制台视觉基线。
- E2E 固定为两个 worker、60 秒用例门、45 秒场景门和 90 秒预览启动门，Playwright 保持零 retry；完整复验 54/54 通过。

待完善：
- 阶段提交/远端同步仍待完成；当前改动与 Phase 5–8 的共享脏工作树重叠，因此 A0 保持 `IN PROGRESS`，不会冒充独立完成阶段。
- Aethor_robo 固件、协议、硬件限位/速度、反馈和停止语义未完成；Dummy 指令集不得复用。
- 来源包只有 BSD 声明，没有完整许可证文本；正式分发前必须补齐。

## 2026-08-09 - 工程治理：完成阶段受控推送

需求：
- 用户要求以后每个 Phase 在完成后由 Codex 推送到远端仓库。

改动：
- 将阶段 Git 规则从“只创建本地提交、用户手动 push”改为“退出门、handoff 和阶段提交全部通过后，fetch 核对远端并普通 push 到 `origin` 对应分支”。
- 明确禁止 force-push、自动改写分叉历史、自动 tag/release/PR，以及把 `IN PROGRESS`、`BLOCKED` 或 checkpoint 冒充阶段交付。
- 同步根工程约定、项目内 workflow skill、工程工作流、README 与文档索引。

验证：
- 远端核对为 `https://github.com/StephenGu010/Aethor_StudioV2.git`；刷新后本地 `main` 仅领先已完成的 Phase 4 提交一项且远端未领先。
- 已将 `f423e46 phase(04): deliver supervised readonly gateway` 普通推送到 `origin/main`，未包含当前未提交的 Phase 5–8 工作区变更。

## 2026-08-09 - 阶段 8B：DPI 与受控崩溃恢复软件门（Phase 8 IN PROGRESS）

需求：
- 在不连接 COM4 的前提下，固定 Windows DPI 契约、让网关崩溃对操作者可见，并确定正式安装/数据保留边界。

改动：
- 桌面项目显式设为 Per-Monitor V2；自定义无边框 resize 命中区按当前 `DeviceDpi` 缩放并记录 DPI 变化。
- 网关意外退出后由原生面板阻断工作区，明确提示设备状态未知且不会自动重连；恢复入口只允许旧 session 退出后以 `--offline` 和已校验 Web 根重启。
- 恢复入口改为原子单向状态机：正常态不能请求离线重启，只有观察到网关失效后接受一次请求；重复失效或 32 路并发请求只有一个请求能获准。
- 桌面启动新增 WebView2 Stable-only 离线探测并调整生命周期顺序：只有 Runtime 版本与 WebView 环境创建成功后才启动网关；缺失、非法或非 Stable channel 显示原生前置条件面板，不自动下载。面板增加受宿主安全门保护的原生关闭按钮。
- 新增包级 WebView2 前置 smoke，以 Beta-only 进程覆盖复现失败路径并证明桌面保持在前置条件状态、网关未启动、零串口和零硬件命令；原生面板视觉不由该脚本冒充完成。
- 修复关闭语义：网关在宿主 202 之前崩溃时，进程消失不再被当作安全退出；普通关闭保持拒绝并要求操作者处理未知物理状态。
- 新增 DPI 与离线重启策略测试；修复外部进程事件订阅在窗口释放时未解除的生命周期缺口。
- ADR-0008 选择 MSI/Major Upgrade 并把安装二进制与 `%LOCALAPPDATA%\Aethor Studio V2` 分离；普通卸载默认保留用户数据，安装器不得强杀可能持有串口的进程。
- 便携构建增加 Authenticode 失败关闭门：四项签名参数必须完整、脏工作树禁止签名、七个自有 PE 文件必须匹配精确 Publisher 并带可信时间戳；只有完成复验的干净构建标记 `release-candidate`，干净未签名构建标记 `development-unsigned`。
- 新增只读发布候选校验器，交叉核对 Git、manifest、646 项长度/SHA-256、未清单文件和七个自有文件签名，不具有串口或硬件命令能力。
- 构建输出根限制在仓库目录内；外部输出路径在创建目录前拒绝，符合工程文件不外溢约束。
- 按真实 1920×1080 页面复核重新校准视觉标尺：正文由 14px 提至 15px，基准页面标题由 24px 提至 28px，品牌区、顶栏和导航比例同步放大；导航/状态标签使用 UI 字体，等宽字体收敛到数值与协议。
- 压缩六轴关节行的无效垂直留白，使 1920/2560 下 J1–J6 无需滚动完整可见；1366 继续只允许关节列表局部滚动，急停和主下发区保持固定。
- 移除数字孪生对 Dummy 固定相机位置的依赖：初载时以实际/目标模型联合世界包围盒、FOV 和画布宽高比计算取景；窗口变化和显式重置重新适配，拖动关节目标时只更新下一次重置基准，不触发视角跳动。
- 将 `.aethor-robot` 从同步全量解压改为 ZIP 中央目录预检和选择性异步解压：压缩/解包 250 MiB、2,048 文件、1 MiB manifest、8 MiB URDF、64 条诊断全部有界，并拒绝 Windows 大小写冲突、ADS/保留名和尾随点/空格。选择新文件或卸载页面会取消旧任务，迟到结果不能覆盖当前文件。
- 设备页把结果收敛为 `PACKAGE STRUCTURE VALID / STL PATHS ONLY`，明确前端不展开 STL、不安装、不持久化，未来 C# 服务必须从原始包重新验证。

验证：
- `pnpm test` 为 shared 90 + frontend 153 + gateway 52 + desktop 73，共 368 项；Vite 2624 modules、网关与桌面 Release build 通过，0 warning/0 error。打包 exe 的窗口 DPI awareness 运行时读回 `PerMonitorV2=true`。
- `development-dirty` 包重新生成 647 个总文件（manifest 内 646 项）；构建明确报告 `serialPortOpened=false/hardwareCommandSent=false`。
- 重排后的正常包级生命周期依次读到 Stable Runtime `151.0.4129.72`、gateway ready、WebView started 和 DOM complete/rootChildren=1；运行段 web exception 0，宿主 202 正常关闭后桌面/网关进程为 0。
- 只提供部分签名参数会在输出变更前失败；当前无签名脏包被发布校验器按预期拒绝 11 项（含 manifest 未签名和七个 `NotSigned`），同时报告零网络、零串口、零硬件命令。
- 浏览器实页复核 1366×768、1920×1080、2560×1440 均无根文档溢出；前端 153/153、Edge 45/45 通过，且新增字号下限、桌面六轴完整可见、相机初载/重置和 Profile 包本地校验/零硬件请求断言。
- 在 `commandPolicy=disabled`、session offline 且同一 PID 已稳定就绪 5 秒后终止唯一子网关，后续 5 秒无自动重启、无 WebView 重试错误；普通关闭消息被拒绝且桌面保持运行。日志确认工作区阻断，清理后桌面/网关进程为 0。就绪前替代 PID 被证明是既有的有界启动重试，不计作运行时恢复。

待完善：
- Windows 当时锁屏，恢复按钮实际点击、四档 DPI 目视和多显示器移动未验证。
- 再次尝试原生恢复按钮验证时仍只捕获到 Windows 锁屏界面；未尝试解锁或输入，精确清理本次离线包桌面/子网关后两者为 0。
- MSI 编译器治理、Publisher/签名证书、离线 WebView2 Runtime 和两个干净版本的安装/修复/升级/卸载仍是 Phase 8B 退出门。
- 本次 COM4 控制预检通过，但缺少新的完整现场安全确认；未打开串口、未发送 `!START`。

## 2026-08-09 - 阶段 8A：Windows 桌面软件门（Phase 8 IN PROGRESS）

需求：
- 在不扩大 COM4 或硬件命令权限的前提下，完成 Windows WebView2 桌面壳、进程边界、便携打包和可审计 smoke。

改动：
- 实现 WinForms/WebView2 自定义壳、单实例、窗口位置恢复、严格 `DesktopBridgeV1`、随机 loopback 端口/令牌、Job Object 子进程回收、有界脱敏日志和失败界面。
- 桌面父进程以最小环境白名单启动网关，固定 `Production + desktop token + commandPolicy=disabled`；正常关闭新增认证 `/api/v1/host/shutdown`，只有离线或明确 disabled 才接受。
- 实现自包含 win-x64 便携包、逐文件 SHA-256 release manifest、许可证/限制说明和包 smoke。构建默认拒绝脏工作树；`-AllowDirty` 只标记开发包。
- 实际 WebView2 运行发现 bridge 单例初始化顺序错误并补充模块导入回归测试；随后发现 SignalR negotiate 的两个客户端请求头缺失，改为精确 CORS 白名单并增加真实 OPTIONS smoke。
- 移除 meta CSP 中浏览器不会执行的 `frame-ancestors` 指令；frame 防护由封闭虚拟主机和导航白名单承担。
- 新增 ADR-0007、Phase 8A 桌面 smoke、Phase 8 handoff，并将路线图拆为 8A/8B。

验证：
- `pnpm test` 为 shared 90 + frontend 143 + gateway 52 + desktop 46，共 331 项通过；`pnpm typecheck`、Vite/.NET Release build 和三档 Edge E2E 39/39 通过。
- 离线网关 smoke 返回 SignalR OPTIONS 204、命令关闭、session offline、token 无泄漏、post-cleanup 通过。
- 便携包 manifest 646 项哈希通过；网关 ready、shutdown 202、子进程退出、零串口/零硬件命令。
- 实际 WebView2 运行段 root 挂载成功，REST、negotiate 和 hub 连接成功，console error 0、web exception 0；正常关闭后桌面/网关进程均为 0。

待完善：
- 8B 安装/升级/卸载、签名、四档 DPI、多显示器、网关崩溃恢复、监督硬件回归和最终 handoff 未完成；Phase 8 不标记 DONE、不提交。
- 本次 `!START` 尚无新的完整现场确认，未打开 COM4、未发送命令。

## 2026-08-09 - 阶段 7A：有界实时示波与协议观测（Phase 7 IN PROGRESS）

需求：
- 在不扩大串口写入权限的前提下，把静态示波和终端升级为来源可信、容量有界、可恢复的真实网关观测工作台。

改动：
- 新增 18 路 `LiveSignalHistory`，每路最多 2400 点/120 秒；统一 runtime store 采集入口，拒绝非法、陈旧、重复和倒序帧并统计序号缺口。
- 图表采集与刷新分离为前台 10 Hz/隐藏 1 Hz；ECharts 复用实例、按单位分轴并唯一释放。CSV 增加 session/profile/signal/source/unit/validity。
- 示波和终端在配置网关后不再因缓冲为空回退 SHOWCASE；增加 measured/waiting/stale/idle 状态。
- 协议帧稳定 ID 去重并限制 256 条；终端自动滚动、复制反馈、仅清空视图和带来源导出完整落地，新帧不会被旧清空状态吞掉。
- 同 session 断开也会撤销管理员模式。遵守 `RobotGatewayV1.1` 无 raw 端点决策，真实发送仍永久禁用。
- 以 ADR-0006 将 7A 软件门与 7B 真实网关长测分开；没有将合成长测描述为实机证据。

验证：
- `pnpm test` 为 shared 87 + frontend 135 + C# 46，共 268 项通过；10 分钟 × 20 Hz 合成长测保持单路 2400、总计 43200 点。
- `pnpm typecheck`、Vite/.NET Release build 通过，C# 0 warning/0 error；三档 Edge E2E 39/39 通过。
- 页面人工检查无 console warning/error，并修复 1366×768 终端局部横向溢出。

待完善：
- 7B 的真实持续采样、浏览器/网关资源曲线、真实拔线/超时/重连和帧/审计核对尚未取得授权，Phase 7 不标记完成。

## 2026-08-09 - 阶段 6A：离线动作文档与编辑器（Phase 6 IN PROGRESS）

需求：
- 在不等待实机运动门、也不引入串口执行器的前提下，先完成 Dummy 六轴动作编排的专业离线文档与编辑工作台。

改动：
- 新增 `ActionProgramV1` TypeScript 类型、JSON Schema、SHOWCASE 示例和接口说明；固定 `dummy-6dof`、六轴 degree、manifest 限位、模式 1–3、最多 256 点和来源/UTC 规则。
- `/actions` 实现新建、复制、程序/点位属性、增删排序、目标草稿预览、受门控实测采集、显式本机保存、导入导出、冲突确认和未保存离开保护。
- 导入在读取前执行 1 MiB 上限；未知版本、错误 DOF、重复 ID、非法限位/模式和来源时间造假失败关闭。本机库限制为 64 个文档/4 MiB；持久化恢复逐条重验 Schema 与稳定 ID，损坏或超限记录隔离并告警。
- 运行按钮固定为 `PHASE 6B LOCKED`，Action 页面没有网关命令、串口、队列或定时完成路径。
- 以 ADR-0005 将 Phase 6 拆为可独立交付的 6A 离线文档和 Gate B 后的 6B runner；未来等待只允许发生在 `completed + feedbackConfirmed` 之后。
- 同步 README、架构、产品边界、路线图、验收矩阵、Phase 6 提示词与 handoff。

验证：
- `pnpm test` 为 shared 87 + frontend 116 + C# 46，共 249 项通过；ActionProgram 聚焦 domain/store/page/sidebar 为 21/21。
- `pnpm typecheck`、Vite/.NET Release build 通过，C# 0 warning/0 error；三档 Edge E2E 39/39 通过，覆盖动作显式保存/刷新恢复、零硬件网络流量和页面边界。
- 本次未打开 COM4、未启动网关、未发送查询、状态改变或运动命令；控制预检明确返回 `serialPortOpened=false/networkRequestSent=false`。

待完善：
- Phase 6B runner、停止后恢复、逐点审计、fake serial 和监督实机短动作仍未开始；依赖 Phase 5 Gate B。

新增约定：
- 动作文档有效不代表动作安全或可执行；SHOWCASE/人工/实测来源不能互相提升。
- 当前不存在 V0，未知版本直接拒绝；未来 Schema 升级必须提供显式迁移和测试。

## 2026-08-09 - 阶段 5：安全硬件控制软件门（IN PROGRESS）

需求：
- 实现结构化硬件命令、安全仲裁和前端能力门，并以独立 Gate A/Gate B 完成监督台架验证。

改动：
- RobotGatewayV1 升级为 1.1，增加 capabilities、命令 DTO、稳定终态/证据码、有界审计和 SignalR `commandResult`。
- C# 单一 gateway owner 增加命令 ID/指纹幂等、单在途、有界停止抢占、超时/取消、状态/限位/完整运动包络校验、防御式停止链和未知结果安全联锁；serial adapter 仍没有 raw 写入。
- 硬件命令默认 disabled；supervised 强制 desktop token。joint-group 只有同时配置速度上限、到位容差、连续稳定窗口和总到位超时才被声明；FIFO 接受后必须由 `#GETJPOS` 连续实测收敛才能返回完成。
- 固件审查发现 HOME/RESET 阻塞协议线程，生产 capabilities 默认排除两项，直到固件可抢占性通过监督验收。
- 前端增加 AppShell 级实时 session owner、运行时 store、设备控制确认/禁用原因/终态和数字孪生显式速度下发门；目标预览仍零自动发送。
- Three.js 锁定为 r182，与 React Three Fiber 9.7 的内部 `Clock` 使用保持兼容，消除 r183+ 弃用告警。
- 新增不可连接的 `gateway:preflight:control`，检查 COM4 身份、残留资源、Release assembly 和未预先注入的监督/运动配置；脚本无启动、串口或网络能力。
- 新增 Phase 5 监督式控制 runbook，分离无运动 Gate A 与低风险运动 Gate B，规定签字、采证、失败处置和清理；Gate A 已验证，Gate B 被阻止。
- Gate A 在 COM4 上取得使能、停止去使能、模式 1–3 和恢复模式 2 的设备回读；没有发送关节目标，断开前确认 disabled，清理后无 gateway 进程或 5127 listener。
- 针对轮询覆盖协议环早期命令 TX 的实测问题，命令审计增加有界请求快照、SHA-256 请求指纹、实际成功写入 transport 的 payload 和截断标志。
- 设备页新增当前会话命令证据面板：以 REST 历史为权威，显示实际 TX、完整请求指纹和截断状态，可手动刷新或导出 JSON；SignalR 终态触发审计恢复，恢复失败不会覆盖已经收到的命令终态。
- 修复前端权威状态竞争：AppShell 协调器独占初始 capabilities/session/history 恢复，设备页挂载只枚举端口。命令审计新增 `unavailable/loading/ready/error` 安全状态，未 ready 时普通命令失败关闭但停止去使能保留。
- 结构化命令丢失 HTTP 响应时，本地生成 `unconfirmed + transportError` 并锁存控制；设备页和数字孪生都在每次命令终态后重取 REST 状态与审计，避免重复发送未知结果命令。
- 将最近命令展示结果与 `latchedSafetyResult` 安全状态拆分；实时未知终态和 REST 历史都可建立联锁，成功停止可清除，空白、陈旧或截断历史不能误清已知联锁。
- 修复固定顶栏软件急停绕过统一终态恢复的问题：三个命令入口改用 `GatewayCommandLifecycle`，顶部 STOP 响应丢失会生成并锁存 `unconfirmed/transportError/none`，并恢复 REST session/joint/audit。安全 store 增加当前 session 成功 STOP 时间水位，阻止乱序旧未知结果重新锁存或覆盖最近结果。
- 修复 SignalR 中断后旧 measured/valid 状态仍可能解锁控制的问题：重连、关闭或非法载荷立即把 session/joint 降为 stale，重连后必须完成 REST capabilities/session/joint/protocol 权威恢复；恢复窗口内的实时 valid 帧仍按 stale 接收。数字孪生保留最后实测姿态并标记 `MEASURED STALE`，所有路由显示持续全局告警。
- 同步 RobotGatewayV1、架构、产品边界、协议、ADR-0004、路线图、验收矩阵和 Phase 5 handoff。

验证：
- `pnpm test`：shared 85 + frontend 96 + C# 46，共 227 项通过；新增聚焦测试覆盖 HTTP adapter 10 项、C# 命令状态机 15 项，以及前端三入口终态协调、顶部 STOP 响应丢失、乱序结果水位、SignalR 降级/REST 恢复、陈旧姿态保留、全局告警、审计恢复、session 切换、联锁重建/清除和 JSON 导出。
- 修复命令接管前取消仍可能落审计并触达串口的问题：接管点前取消现在零审计、零写入；接管后的 HTTP 取消仅中断调用方等待，网关仍形成唯一终态。同 ID 恢复不重复写入，shutdown 先等待取消中的 runner 收束再释放 transport。
- 修复控制预检只哈希 API 入口 DLL、无法识别 Application 等依赖层代码变化的问题；预检现在输出四个自有 Release DLL 的逐项哈希和规范化总清单哈希。
- `pnpm typecheck`、Vite/.NET Release 构建通过，C# 0 warning/0 error；Edge 三档视口 E2E 36/36 通过。
- Edge 三档视口 E2E 36/36 通过；视觉基线更新后再次独立复验。另在本地浏览器检查无页面级横向溢出或控制台 error/warning，后端缺席时硬件动作全部禁用。
- `gateway:preflight:control` 在当前 COM4 PnP 身份上通过，确认无 gateway/listener、无预注入监督或运动配置，并明确报告 gateway 未启动、串口未打开、网络未请求。
- Gate A 证据保存在被 Git 忽略的 `TestResults/phase-05-com4/20260809T060050Z/`；Gate B 未执行，因此阶段不提交、不标记 DONE。
- 最终构建后 `gateway:preflight:control` 通过；COM4 身份匹配，gateway 进程/listener 为 0，监督配置、令牌和四参数包络均未残留，未打开串口或发网络请求。

新增约定：
- HOME/RESET 契约端点存在不等于 capability 可用；固件阻塞风险优先于旧计划功能表。
- 四参数运动包络必须来自可追溯硬件证据，禁止从 URDF、旧 UI 或展示数据推断；动作编排只能消费网关的 `completed + feedbackConfirmed`，不能用固定延时替代。

## 2026-08-09 - 阶段 4：只读网关与监督 COM4 验收（DONE）

需求：
- 建立工业级 .NET 10 串口边界，在现场监督下读取 Dummy 六轴状态，不提前引入任何硬件状态改变或运动权限。

改动：
- 新增 Domain/Application/Infrastructure/API 分层、单一串口 session owner、fake transport、Windows SerialPort adapter 和 28 项 C# 测试。
- 将 Phase 4 写入限制固化为 Domain formatter 与 Infrastructure payload 双重白名单，仅允许 `#GETJPOS/#GETMODE/#GETENABLE`。
- 新增 loopback REST/SignalR、opaque session token、Development/desktop token source、显式失败状态、有界事件队列/协议历史和无自动重连策略。
- 修正协议帧来源语义：TX 查询标记为 `commanded`，RX 回包为 `measured`，解析/超时错误为 `unavailable`；不再把网关写出的查询误标为设备测量。
- 前端增加 `HttpRobotGateway`、loopback/Zod trust-boundary 校验、安全 static fallback、设备页人工只读连接/断开/刷新与真实来源/有效性显示；所有 Phase 5 动作保持禁用。
- 完成 Phase 4 视觉修订：移除侧栏 `ROBOTICS ENGINEERING / CONTROL WORKSPACE` 副标并保留清晰的 `V2` 版本标识；将标题、正文和工程数值拆分为 Windows 本地 Display/Text/Mono 字体角色，重新校准标题栏、导航、状态带和三档视口字号比例。
- 修正项目本地 `dotnet.ps1` 的参数透传；`--info/--version` 等根级 SDK 诊断参数不再被 PowerShell advanced-script 公共参数抢占，现有 restore/build/test/run 调用保持兼容。
- 新增 `gateway:preflight` 与唯一 Phase 4 监督 runbook；预检只读取 PnP、网关进程和 listener，身份不符或残留资源时失败关闭，现场授权前不存在串口/HTTP 连接路径。
- 新增 `gateway:smoke:offline`；用项目选择的 .NET runtime 启动精确 Release gateway 进程，自动验证离线认证/枚举/状态、运行中预检失败关闭、令牌日志审计和 post-cleanup，源码不包含连接端点。
- 新增 3 项运维脚本安全回归：根测试门会拒绝预检获得连接/网络能力、离线 smoke 增加未审查端点或非精确清理，以及 package 入口偏离已审查命令。
- 完成一次监督 COM4 只读连接与断开；真实设备仅收到三个白名单查询，返回六轴关节值、模式 2 和未使能状态。原始证据保持在已忽略的 TestResults，未提交机器日志或令牌。
- 修复 Windows PowerShell 5.1 将顶层 JSON 数组表示为 `value/Count` 适配对象、导致采证误判的问题；脚本显式归一化为 `[object[]]`，并增加回归断言防止重现。
- 同步运行手册、RobotGatewayV1 接口、架构、产品边界、ADR-0003、路线图、验收矩阵和 Phase 4 handoff。

验证：
- `pnpm typecheck` 通过；`pnpm test` 为 shared 80 + frontend 61 + C# 28，共 169 项通过。
- `pnpm build` 通过：Vite 2612 modules、Profile 10 项资源；.NET Release 0 warning/0 error。
- `pnpm test:e2e` 在 Edge 三档视口 36/36 通过；覆盖精简品牌锁定、主标题层级、无裁切/溢出和更新后的 Win32 视觉基线；未配置网关时没有端口枚举、连接、fetch 或 WebSocket 硬件路径。
- loopback smoke 验证 live、未认证 401、只读 capabilities、COM1/COM4 枚举、offline session 与 SignalR connect/stop，未调用连接端点。
- `gateway:preflight` 对当前已核对 COM4 身份返回 exit 0，对错误身份返回 exit 2；两种结果均声明 `serialPortOpened=false`、`networkRequestSent=false`，静态审计未发现连接调用。
- `gateway:smoke:offline` 通过：live、未认证 401、`hardwareCommands=false`、COM4 仅枚举、session `offline/unavailable`；运行中预检 exit 2，精确停止后 exit 0，token 未进入日志。错误身份和 5174 listener 占用均在启动前失败关闭，当前 Vite owner 未被终止。
- 监督实机采集归一化后为 6 帧：3 TX + 3 RX，TX 严格为 `#GETJPOS/#GETMODE/#GETENABLE`，0 error；关节值 `[-7.97,-70.56,180.09,-3.56,3.26,0.03]`，session 为 `connected/disabled/mode 2/measured/valid`。
- 断开返回 `offline/unavailable`；日志仅有一次 `serial.opened` 和一次位于其后的 `serial.closed`，之后无再次打开；post-cleanup 网关进程 0、5127 listener 0、stderr 空。

踩坑：
- 设备页在 1366×768 曾让根 document 多出滚动；根因是内部工作区高度/contain 边界不完整，现由 shell 内部滚动并由全量三档 E2E 固化。
- 本机无系统 .NET SDK；使用官方 SDK 10.0.302 的项目本地、gitignored 安装，并由 `global.json` 与 wrapper 保持可复现。
- Windows PowerShell 5.1 不支持新式静态 `RandomNumberGenerator.GetBytes(int)`/`Convert.ToHexString` 组合；runbook 改用可释放的 RNG 实例和逐字节十六进制转换。
- Release apphost 不会自动发现仓库忽略目录 `.tools/dotnet` 的 runtime；离线 smoke 和监督 runbook 改为使用与 `dotnet.ps1` 相同的项目本地 runtime 选择规则直接启动 assembly。
- Windows PowerShell 5.1 的 `Invoke-RestMethod` 可能把顶层 JSON 数组表示成带 `value/Count` 的适配对象，直接保存或再用 `@()` 接收都不足以保证证据形状；原实机 summary 因此诚实保留为失败，新增离线审计文件证明原始 6 帧有效，未重新连接设备。
- 最初的协议帧记录将所有非 error 方向统一标成 `measured`；通过先失败的 C# 回归断言定位到唯一映射点，未在 UI 做补偿。
- `dotnet.ps1` 原先使用 `[CmdletBinding()]`，导致 `--info` 与 `InformationAction/InformationVariable` 发生模糊匹配；改为直接透传 `$args`，没有为每个 SDK flag 建立重复参数表。
- 首轮以 8 workers 并发加载三档 WebGL 场景时，2K 用例发生资源竞争超时；旧视觉快照差异符合预期。新基线逐张审阅后，以 4 workers 完整复验 36/36 通过，没有放宽 READY 或快照断言。
- 首次尝试通过 `pnpm ... --` 传递 PnP Instance ID 时，ID 内的 `&` 被 `cmd.exe` 拆分；根命令改为读取当前进程环境变量，避免依赖脆弱转义或在命令行暴露机器身份。

未覆盖：
- `handle.exe` 未安装，无法直接观察 OS 串口句柄；释放结论来自运行日志、代码顺序、offline 终态和进程/listener 清理，禁止为补证再次打开 COM4。
- 未在真实设备上注入拔线或连续超时；自动化故障路径已覆盖，真实断线恢复归入 Phase 7。
- Windows catalog 目前只保证端口名；硬件 ID 允许为空，实机 handoff 使用操作系统 PnP 身份记录。

新增约定：
- Phase 4 不存在 raw 或状态改变 API；REST 是权威快照，SignalR 只是有界通知；串口故障不自动重连。
- Phase 4 实机验收只能从监督 runbook 进入；预检脚本必须保持不可连接，硬件 ID 不通过 package-runner 参数传递。

## 2026-08-08 - 阶段 3：Dummy 六轴直接关节数字孪生

需求：
- 在不接入串口、动力学、轨迹规划或 IK 的前提下，实现类似 Robot Viewer 的六关节选择与轴约束拖动，并给出可交付的降级和资源生命周期证据。

改动：
- 以 manifest 的稳定关节 ID/URDF 名称和 URDF 原点/局部轴建立六轴绑定；缺失或重复映射失败关闭，不根据 mesh 名称猜测关节。
- 新增模型点选、黄色旋转环、选中链节高亮、滑块/数值/方向键统一草稿；所有入口只修改目标幽灵模型，展示反馈保持独立。
- 拖动采用世界关节轴法向平面的右手规则有符号角，近平行视线退化为屏幕切向；操纵器使用高优先级事件层/raycast，避免重叠模型抢占。
- 新增 WebGL 缺失、上下文丢失、URDF/mesh/映射失败和低性能显式降级；低性能模式收敛 DPR、抗锯齿与阴影成本。
- 增加 renderer、controls、model roots、geometry/material/texture 和拖动会话诊断；模型对象按唯一引用释放，浮动工具窗在拖动中卸载也清理窗口监听器。
- 将 `RobotScene`、`JointManipulator`、`robotModel`、能力策略、资源释放和资源计数拆为单一职责模块，并将 3D 场景作为页面内二级动态分包。

验证：
- 六轴 URDF 零位原点、局部轴、manifest 限位、右手方向、目标夹紧和反馈隔离均有单元测试。
- 三档 Edge 验证模型/键盘选择、真实 3D 拖动、零 fetch/XHR/WebSocket、URDF 失败、重复挂载资源计数、布局和视觉基线。
- `pnpm typecheck`、`pnpm test`、`pnpm build` 与 `pnpm test:e2e` 作为阶段退出门；未打开 COM4，未发送任何硬件命令。

踩坑：
- 操纵器与机械臂重叠时，默认按射线距离排序会先触发模型拾取并切换关节；通过独立高优先级事件层和操纵器优先 raycast 修复，而不是扩大不可见点击区域来掩盖问题。
- 3D 动态分包和并行 WebGL worker 增加首载波动；READY 仍由资源完成与真实渲染帧驱动，E2E 使用 30 秒有界状态等待，不使用固定 sleep。

新增约定：
- 3D 交互只能写目标草稿；未来网关下发仍必须经过独立的显式整组命令与安全状态机。

## 2026-08-08 - 阶段 2：工业 UI 系统与信息架构

需求：
- 修正展示前端的字体、比例、密度和三档视口表现，在不扩大硬件权限的前提下形成可交付的工业控制台信息架构。

改动：
- 建立石墨深色 token、Windows 本地字体栈、分级字号/间距和可见焦点规范，统一数值对齐、禁用态与低噪声语义色。
- 重排标题栏、导航、状态带、数字孪生控制区和底部数据区；1366×768 使用紧凑布局，1920×1080 为基准，2560×1440 完整利用画布。
- 禁用按钮的原因容器可通过键盘聚焦，设备选择、桌面窗口、软件急停和硬件命令继续诚实显示不可用原因。
- 增加 `/actions` 动作编排入口，但明确标记 `PHASE 6 PLANNED / NO EXECUTION PATH`，创建、导入和运行均不可用。
- Playwright 扩展为五工作区、三档视口 21 项检查，并提交三张 Win32 数字孪生视觉基线。
- Three.js 阴影配置改用受支持的 `PCFShadowMap` 映射，移除项目自身触发的软阴影弃用警告。
- 修正 URDF 回调早于异步 STL 完成导致的伪 `URDF READY`：所有 visual/collision mesh 收束后才克隆目标模型，并在两个真实渲染帧后上报 READY；取消或失败路径仍由 LoadingManager 完成迟到资源释放。

验证：
- `pnpm typecheck`、`pnpm test`、`pnpm build` 和 `pnpm test:e2e` 全部通过。
- 共享契约 77 项、前端 36 项，共 113 项单元测试通过；Edge 三档视口 21 项 E2E 通过。
- 五个工作区均显示 `SHOWCASE DATA / SERIAL OFFLINE`，真实硬件操作保持禁用；未打开 COM4。

踩坑：
- 本机 5173 被非权威旧服务占用，D 盘权威工程改用临时 5174 做人工复核；仓库默认端口约定未改变。
- 页面高度修复后必须先重建再刷新视觉基线，否则复用旧 `dist` 会造成 2K 底部空白的假象。
- `urdf-loader` 的 URDF 根回调不代表 STL 已完成，不能据此克隆目标模型或上报 READY；三档并行 WebGL 验收改用明确状态的 15 秒有界超时，不使用固定 sleep。
- Three.js r185 会对 React Three Fiber 9.7 内部的 `THREE.Clock` 发出上游弃用警告；当前无控制台错误，后续依赖兼容升级时消除，不通过过滤日志规避。

新增约定：
- 动作编排路由在阶段 6 前只承担产品信息架构，不得获得保存或执行路径。

## 2026-08-08 - 阶段 1：Dummy 协议、契约与安全状态机

需求：
- 以固定 `dummy_ref` 提交为证据，将 Dummy 六轴协议收敛为工业可审计的共享契约，不访问 COM4。

改动：
- 将 `shared/contracts` 建为 `@aethor/contracts` workspace，前端删除重复类型并改为消费共享类型。
- 新增模式 1–3 公共白名单、`>` 六轴 formatter、response parser、255 字符有界行解码、命令/会话纯状态机和有界 fake transport。
- JSON Schema 新增 `unconfirmed`、UTC 结果时间、完整 Profile capabilities、模式 1–3 限制和 `OperationEvent`；Dummy manifest 同步为明确能力数组。
- 新增跨语言 conformance vectors 与 ADR-0002；前端离线校验不再接受 RGB、模式 4/5、标定、PID、reboot、`&`、`@` 或通用 `$`。
- 固化源码差异：运动 FIFO 单项 64 bytes；固件有效行上限实际为 255；`$0...` 成功路径没有 ACK，只能作为未来停止链内部 best-effort 写入。

验证：
- `pnpm typecheck`：共享契约与前端均通过。
- `pnpm test`：共享契约 77 项、前端 33 项通过。
- `pnpm build`：通过，Dummy Profile 10 项资源复制成功。
- `pnpm test:e2e`：Edge 三档视口 12 项通过，离线发送保持禁用，模式 5 显示 INVALID。
- 未打开 COM4，未发送查询、使能、停止或运动命令。

待完善：
- C# DTO 生成和 adapter 对 vectors 的复用在 Phase 4 落地；速度上限、反馈收敛容差、HOME/RESET 完成语义仍待后续监督验收。

新增约定：
- 设备 FIFO 数字或 `ok` 只增加命令 evidence，不直接等于物理完成；终态不能被迟到 ACK 覆盖。

## 2026-08-08 - 阶段 0：工程治理与本地 Git 流程

需求：
- 所有 V2 工程文件只保存在 D 盘权威仓库；建立可交接的系统工程、计划、handoff 和 Git 流程。

改动：
- 新增根 `AGENTS.md`、项目内 `aethor-studio-workflow` skill 和阶段制工程工作流文档。
- 新增 `.gitattributes`、`.editorconfig` 与 `.gitmessage`，统一文本、编辑和提交约定。
- 明确完成阶段自动创建本地 commit，但绝不自动 push；远端推送由用户手动执行。
- 保留规范的 `apps/services/shared/docs` 结构，只借鉴 `Aethor_Studio` 的分层边界，不恢复旧目录。
- 清理阶段 0 迁移留在仓库外的 `node_modules` 备份和 skill 生成临时文件，均移入 Windows 回收站。

验证：
- Git 远端为 `StephenGu010/Aethor_StudioV2.git`，当前分支为 `main`。
- 项目 skill 通过官方 `quick_validate.py`，界面 YAML 可解析。
- Node.js 24.14.0 / pnpm 11.16.0 下 typecheck、23 项单元测试和生产构建通过。
- 指定 `Aether_matlabv3` 参考仓库因网络/公开访问不可用，未臆造其内容。
- 本次只修改工程治理文件和文档，未改产品代码、未打开 COM4、未发送硬件命令。

## 2026-08-08 - Dummy 分阶段路线图与交接体系

需求：
- 完成 Dummy 六轴平台分阶段实施计划，使工程可安全交接并收敛目录结构。

改动：
- 将 `D:\Aethor_robot\Aethor_StudioV2` 确立为权威工作副本；C 盘旧副本仅保留回退。
- 新增阶段 0–8 路线图、逐阶段执行提示词、验收矩阵、handoff 模板与进行中的阶段 0 交接。
- 接受 `apps/services/shared/docs` 目标目录 ADR；实际代码移动和 D 盘测试复验仍属于阶段 0 未完成工作。
- 将首版范围收敛为 `dummy-6dof`、模式 1–3、手动 COM4、显式整组关节下发和版本化动作 JSON。
- 根据指定固件提交补充停止、队列、模式和 ACK 的真实语义。

验证：
- 本次文档整理未打开串口，也未发送查询、使能、停止或运动命令。
- D 盘 TypeScript strict、23 项 Vitest、生产构建和 Edge 三档视口 9 项 Playwright 均通过；目录迁移后的再次复验仍属于阶段 0 退出门槛。

## 2026-08-08 - 阶段 0：目录治理完成

需求：
- 将扁平原型目录迁移为规范的应用、服务与共享资产边界，并提供根级可复现命令。

改动：
- 完成 `apps/studio-web`、`apps/studio-desktop`、`services/robot-gateway`、`shared/contracts`、`shared/robot-profiles` 迁移。
- 新增根 pnpm workspace、统一脚本和唯一锁文件；移除旧路径和子项目 workspace 配置。
- 修正 Vite/Vitest/TypeScript 的 Profile 路径，并同步 README、架构、路线图与阶段 handoff。
- 修正生产构建中 Dummy Profile 的重复目录层级，并新增 URDF/7 个 STL 的公开 URL 回归测试。

验证：
- `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm test:e2e` 全部通过。
- 23 项单元测试和 Edge 三档视口 12 项 E2E 通过；生产构建复制 10 项 Dummy Profile 资源。
- 旧顶层目录与重复锁文件不存在；未打开 COM4，未发送硬件命令。

踩坑：
- 机械移动后的旧 pnpm junction 仍指向迁移前位置；已将旧生成目录移出仓库并从根锁文件干净安装，源码未受影响。
- 静态复制目标原先重复包含 `dummy-6dof`，页面状态测试未覆盖真实资源 URL；现由生产预览 E2E 直接请求 URDF/STL 防止回归。

新增约定：
- 所有前端命令从仓库根执行；不再接受 `Frontend/Contracts/RobotProfiles/Backend/Desktop` 兼容副本。

## 2026-08-07 - 前端优先平台骨架

需求：
- 建立展示级 Windows 机械臂调试平台，先完成四个前端工作区并预留 C#/WebView2 边界。

改动：
- 新增 React/Vite 工程、版本化契约、Dummy 受管 Profile、架构与协议文档。
- 明确静态展示数据与真实设备状态隔离。
- 实现数字孪生、数据示波、串口终端、设备与模型四个工作区，并按工作区拆分 Three.js 与 ECharts 资源。
- 将 `URDFDummy4.urdf` 与 7 个 STL 规范化为 `dummy.urdf`、`base_link/link_1…6`、`joint_1…6` 和小写 mesh 路径。
- 增加 `.aethor-robot` 前端校验、共享 JSON Schema、只读 `StaticShowcaseSource` 与不可用 `DesktopBridgeV1`。

验证：
- `node node_modules/typescript/bin/tsc -b --pretty false`：通过。
- `node node_modules/vitest/vitest.mjs run`：7 个测试文件、23 项测试通过。
- `node node_modules/@playwright/test/cli.js test`：Edge 下 3 个视口、9 项 E2E 通过。
- `node node_modules/vite/bin/vite.js build`：通过；发布包包含 `dummy.urdf` 与 7 个 STL。
- 内置浏览器逐页检查四个路由；Dummy URDF 显示 `URDF READY`，中文、图表和离线安全状态正常。

踩坑：
- Safety First 与 `dummy_ref` 对 RGB 协议描述冲突；V2 固定以指定 `dummy_ref` 提交为准。
- 原 URDF 第四关节为 `Join4` 且 velocity/effort 为零，迁移时只修正名称，不推断动态上限。

待完善：
- C# 串口服务、SignalR 实时通道、WebView2 原生桥接和第二台机械臂 Profile。

新增约定：
- 展示数据不得生成任何真实连接、使能、命令接受或急停成功状态。
