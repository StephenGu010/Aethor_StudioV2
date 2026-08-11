# 阶段 5 交接

- 状态：`IN PROGRESS`
- 实机门：`GATE A PASSED / GATE B BLOCKED`
- 日期：2026-08-09
- 仓库/分支：`Aethor_StudioV2 / main`
- 开始基线：`f423e460f9f36f4067785782a4af59b0a98353f2`
- 阶段完成提交：无；Gate B 未关闭，不创建 `phase(05)` 提交

## 当前结论

Phase 5 已完成默认关闭的 RobotGatewayV1.2、C# 结构化命令安全链、关节组实测到位判定、前端 capability gate、控制预检和监督式 runbook。2026-08-09 在用户明确要求发送 `!START` 后，Gate A 完成一次真实 COM4 状态控制验证：使能、停止并去使能、模式 1–3 和恢复模式 2 均取得设备回读，最终在断开前确认 `disabled / mode 2`。全过程没有发送关节目标，未发生计划内运动。

2026-08-10 增加仅限 Development + 本机令牌的 `engineering` direct 调试路径：删除前端管理员机制，终端和 Dummy 控制台可在 C# 白名单与状态门内发命令；六轴关节 FIFO 结果只写作 `queued / deviceQueued`，不冒充到位。错误 COM 导致 stale/unknown/faulted 时允许释放，明确 enabled 或在途命令时仍拒绝普通断开。该增量不关闭 Gate B，详情见 [ADR-0009](../decisions/0009-engineering-direct-debug-boundary.md) 和 [直连手册](../runbooks/dummy-engineering-direct.md)。

同日后续现场运行暴露出一个更底层的停滞：一次无回包 `!START` 使 Windows `SerialPort.BaseStream.ReadAsync` 即使收到取消也未完成，direct 长期持有串口门，三查询轮询随之停止，因此 J2 与其他反馈看似冻结，断开又停在 `disconnecting`。J2 协议、manifest 和前端索引均为第二字段，未发现映射错误。adapter 现改为 100 ms 同步读窗口，direct 纳入唯一命令所有权，STOP/Shutdown 可取消并等待其收束；新回归证明断开后重新连接可继续更新第二轴。本次只完成 fake-driver 软件门，旧实机会话的 Release/COM4 复验仍等待物理安全确认。

这不代表 Phase 5 完成。Dummy 没有可信四参数运动包络；HOME/RESET 还会阻塞固件协议线程并可能妨碍 STOP。`jointGroup/home/reset` 继续不声明，Gate B 未授权、未执行。

## 已完成

- C# `RobotGateway` 是串口、轮询、命令仲裁和审计的唯一所有者；同一时刻最多一个普通命令，停止可有界抢占。
- 串口防堵门已增加 fake-driver 验收：所有命令等待串口所有权均有界，STOP 超时返回未确认并锁存联锁；人工断连不能遗留在途硬件命令；宿主清理先关闭句柄打断忽略 cancellation token 的 pending read，再等待 runner 终态和 dispose。打开阶段默认限时 5 秒；超时/取消会主动 dispose 尚未接管的候选连接、恢复 offline、记录稳定诊断并隔离本 Gateway 后续打开，避免原生 Open 停滞任务累积。尚未在 COM4 上做驱动卡死/拔线故障注入，因此不能把软件门写成 Gate B 实机完成。
- 事件发布关闭门已增加不合作 fake sink 验收：单次发布超时后事件泵停止，不启动更多悬挂调用；dispose 先释放 transport，再按独立窗口排空/取消事件泵。SignalR sink 即使忽略 cancellation 也不能无限阻塞网关退出。
- 命令以 ID + 请求指纹幂等；同请求只物理执行一次，同 ID 不同请求拒绝。
- 许可门覆盖 session/profile、连接、反馈新鲜度、使能、模式、六轴有限值、manifest 限位、速度、完整四参数运动包络和在途状态。
- 关节组只在 FIFO 接受后持续查询 `#GETJPOS`，且误差连续处于容差窗口才返回 `completed + feedbackConfirmed`；超时返回 `timedOut + deviceQueued` 并锁存联锁。
- 停止链为 `!STOP → $0,0,0,0,0,0 → !DISABLE → #GETENABLE`；仅设备回读 0 才完成。
- Dummy 设备页只通过结构化端点下发；Dummy 目标草稿与反馈隔离，预览编辑不会发送。Aethor_robo 控制台使用独立 14 轴本地草稿，没有网关或串口发送路径。
- 顶栏 `Current profile` 负责整机切换。只有 Dummy 激活时才挂载网关会话协调器；Dummy 连接中、重连中、存在联锁或未确认去使能时拒绝切走。切换不是停止/断开命令，并会清空隐藏目标草稿和旧 runtime/遥测。
- 顶栏新增与设备页共用 runtime session 的串口入口，可刷新、选择、显式连接和安全断开；不会自动连接，Aethor_robo 下不枚举。两个入口都只调用 `RobotGatewayV1`，C# 网关仍独占串口。
- 新 Dummy hardware session 的首个可信六轴实测帧只做一次幽灵目标基准对齐；用户先编辑则取消待对齐，后续反馈不覆盖目标。该软件行为尚未验证实机原点和关节方向。
- 终端没有管理员/专家解锁。只有网关协商 `engineering + directCommand` 时可发送受限 Dummy 白名单；输入框不等于串口权限，任意 raw、HOME/RESET、RGB、电流/PID、reboot 与多行输入仍被 C# 拒绝。
- `preflight-control.ps1` 只检查身份、残留资源、配置和 Release assembly，不能启动网关、打开串口或发网络请求。
- 命令审计现在保存有界请求快照、SHA-256 请求指纹及实际成功写入 transport 的 payload；不再依赖易被轮询覆盖的协议帧环形历史。
- 前端以 REST 命令历史为权威，在初始化、显式刷新和 SignalR 命令终态后恢复有界审计；设备页显示实际 TX、完整请求指纹与截断状态，并支持当前会话 JSON 导出。审计恢复失败与命令终态分别呈现，不会把展示失败误报成物理结果未知。
- AppShell 协调器现在独占初始 capabilities/session/joint/history 恢复；设备页挂载只枚举端口，不再竞争写入权威会话。审计状态不是 `ready` 时，普通命令和关节组下发失败关闭，停止去使能仍可用；HTTP 命令响应丢失会锁存本地 `unconfirmed + transportError`。最近结果与 `latchedSafetyResult` 已分离，手动历史恢复可以重建联锁，但空白/陈旧历史不能误清除已有联锁。
- Dummy 设备页与固定顶栏软件急停统一进入 `GatewayCommandLifecycle`；顶部 STOP 响应丢失不再只显示普通提示，而会锁存 `unconfirmed/transportError/none` 并把审计置为不安全。当前 session 保存成功 STOP 时间水位，迟到或乱序的旧未知结果不会重新锁存、覆盖最近结果；空白/截断历史也不会丢失该水位。Aethor_robo 控制台的软件急停固定禁用，不进入该生命周期。
- SignalR 重连、关闭或非法载荷会立即把 Dummy measured session/joint 降为 `stale`；重连回调和契约违规则触发合并限流的 REST capabilities/session/joint/protocol 恢复，成功前收到的实时 valid 帧仍按 stale 接收；最终关闭保持降级直至重新建立实时会话。Dummy 相关工作区保留最后实测值并显示 `MEASURED STALE`，不会跳回展示值；五个工作区共用全局降级/安全告警，普通控制保持锁定，停止去使能仍可用。Aethor_robo 控制台继续保持 `MODEL ONLY`，不把 Dummy 状态解释为本机反馈。

## Gate A 实机结果

| 项目 | 结果 |
|---|---|
| 执行时段 | 2026-08-09 05:57–06:02 UTC |
| 设备 | `dummy-6dof`；COM4；PnP `OK` |
| PnP Instance ID | `USB\VID_1209&PID_0D32&MI_00\7&2BF1B17E&0&0000` |
| 能力 | 仅 `enable / stopAndDisable / setMode`；无 `jointGroup/home/reset` |
| 初始状态 | measured/valid、disabled、mode 2 |
| 使能 | `completed / ok / feedbackConfirmed`；回读 `ok 1` |
| 停止并去使能 | `completed / ok / feedbackConfirmed`；回包含 `Stopped ok`、`Disabled ok`、`ok 0` |
| 模式 | 1、2、3 均回读确认，最后恢复 2 |
| 运动命令 | 0；未发送 `>` 关节目标 |
| 断开前终态 | measured/valid、disabled、mode 2 |
| 清理 | session 断开；gateway 进程 0；5127 listener 0；监督配置和令牌已清除 |

本次授权证据是用户在确认条件后明确发出 `!START` 请求。Codex 无法独立观察物理工作区、急停位置或人员状态，因此只记录用户授权和设备/软件证据，不把视觉不可见条件写成已自行检查。

被 Git 忽略的本机证据位于 `TestResults/phase-05-com4/20260809T060050Z/`。`gate-a-evidence.json` 保存 6 条命令结果、最终 measured session/joint state 和 256 条协议帧；`post-cleanup-preflight.json` 证明清理后无 gateway 进程或 5127 listener。证据不含会话令牌。

### 本次采证限制及修正

500 ms 轮询很快填满 256 帧协议环，最终快照虽有 128 条 TX，但早期 `!START`、停止链和模式 TX 已被覆盖。命令历史仍保留命令种类、终态和设备回包，因此 Gate A 结果可审计，但不能声称该文件保留了所有原始命令 TX。

实机运行后已修正契约：每条 `CommandAuditRecord` 额外保存规范化请求、请求指纹、最多 32 条实际成功写入 transport 的 payload 及截断标志。设备页现在可直接查看、刷新并导出这些记录。该修正经过 fake transport、JSON Schema、前端 Zod、恢复和导出测试，但不是对既有 Gate A 证据的追写；以后应在每条命令后立即保存审计记录。

## 尚未完成

1. 由机械/固件负责人提供可追溯并签名的最大速度、到位容差、连续稳定窗口和总到位超时。
2. 为 Gate B 的微小关节增量目标单独取得现场授权；不得使用展示位或推断的“安全回位”。
3. 独立执行 Gate B 的实测到位、超时/停止抢占、失败注入与清理采证。
4. 将 HOME/RESET 改为可抢占的非阻塞固件状态机，或继续永久保持 unsupported。
5. 全部实机门关闭后才决定 Phase 5 是否 DONE 并创建本地阶段提交；远端 push 仍由用户执行。

## 关键决策

| 决策 | 原因 | 影响 |
|---|---|---|
| 命令默认 disabled；supervised 需要 desktop token | 防止开发配置意外获得硬件权限 | 普通浏览器网关不能自行开启命令 |
| 不提供任意 raw API | 保持 adapter 白名单、许可门和唯一串口 owner | engineering direct 也必须经过版本化端点与 C# 二次校验 |
| HOME/RESET 排除 | 固件阻塞协议线程，STOP 及时性未证明 | UI 诚实显示不支持 |
| joint-group 需要已验证四参数包络 | URDF 和旧默认值不是安全证据 | 缺任一项就不声明 capability |
| ACK/FIFO 不等于完成 | 固件没有统一物理完成事件 | 只以连续实测收敛判定完成 |
| STOP 只以 disabled 回读完成 | 写入成功不是设备安全证据 | 未确认时持续提示物理急停 |
| 命令审计独立保存实际 TX | 高频轮询会覆盖协议环 | 动作编排可恢复可靠逐点证据 |
| 审计恢复是前端许可门 | 历史缺失时不能证明无未知结果联锁 | 只读遥测继续；普通命令锁定，停止仍可用 |
| SignalR 恢复不等于遥测可信 | 通道可恢复但权威快照仍旧或缺失 | measured 值降为 stale；REST 四类快照恢复成功前不解锁，全局持续告警 |

## 验证证据

| 检查 | 结果 |
|---|---|
| 聚焦审计测试 | shared 85、HTTP adapter 10、C# 命令状态机 15 项通过 |
| 全量 `pnpm test` | shared 85 + frontend 96 + C# 46，共 227 项通过 |
| 2026-08-10 串口防堵复验 | gateway 54/54；整仓 contracts 91 + frontend 164 + gateway 54 + desktop 73，共 382 项；三档 E2E 57/57 |
| 2026-08-10 事件发布器有界关闭复验 | 聚焦 3/3；gateway 68/68；整仓 contracts 91 + frontend 168 + gateway 68 + desktop 74，共 401 项；覆盖发布超时、停止继续发布、忽略取消时的有界 dispose 与超时配置边界 |
| 2026-08-10 双 Profile 与现场准备复验 | 整仓 contracts 91 + frontend 177 + gateway 68 + desktop 74 + legal inventory 1，共 411 项；三档 E2E 63/63；COM4 仅枚举/配置预检通过，`hardwareAccessAuthorized=false`、`serialPortOpened=false`、`networkRequestSent=false`，四参数运动包络仍缺失 |
| 2026-08-10 串口资源压力复验 | 聚焦只读网关 14/14、gateway 71/71、整仓 414/414；strict TypeScript、Web 2639 modules 与两个 .NET Release build 通过，0 warning/0 error；32 次正常连接/断开、32 次忽略读取取消的关闭、阻塞写入关闭顺序和连续 64 个状态周期均稳定回收，协议历史保持配置上限；仅 fake transport，未打开 COM4 |
| 2026-08-10 全局串口入口与目标基准复验 | contracts 91 + frontend 182 + gateway 72 + desktop 74 + legal inventory 1，共 420/420；strict TypeScript、完整 Release build 和三档生产 E2E 63/63 通过；顶部/设备页 active port 一致、零自动连接、Aethor_robo 零枚举、首个可信实测帧一次性对齐且用户编辑优先；只读网关以 disabled/offline 启动并枚举 COM1/COM4，未打开串口、未验证实机原点/方向/运动 |
| 2026-08-10 engineering direct 与错误端口释放复验 | contracts 93 + frontend 182 + gateway 79 + desktop 74 + legal inventory 1，共 429/429；strict TypeScript、完整 Release build 0 warning/0 error、三档生产 E2E 63/63；覆盖错误端口 stale/unknown 释放、无管理员终端、白名单/状态门/速度界限、控制台 queued 非完成语义、统一启动入口和 E2E 本机配置隔离；真实入口以 v1.2 engineering/offline 启动，仅枚举 COM1/COM4，未打开 COM4、未发送硬件命令 |
| 2026-08-10 无回包 I/O、STOP 抢占与 J2 重连软件门 | contracts 93/93、frontend 184/184、gateway Debug 82/82、desktop Debug/Release 79/79、三档生产 E2E 63/63；覆盖 100 ms 可取消读窗口、无回包 direct 被 STOP 取消、未知 STOP 后可释放并显式重连、断开清空临时证据、下一 session 的 J2 从 -70.85 更新到 -42.25，以及前端模型/目标/runtime 复位；gateway Release/包/COM4 仍待旧未知会话在物理安全确认后清理，不构成 Gate B |
| 2026-08-11 串口打开停滞软件门 | contracts 93/93、frontend 197/197、gateway 88/88、desktop 110/110、legal inventory 6/6，共 494/494；2643-module Web 和两个隔离 Release build 0 warning/0 error；覆盖原生 Open 忽略取消、应用总超时、调用方取消、候选连接唯一 dispose、offline/host shutdown 与零第二 transport。697/696 文件开发包两种 offline smoke 通过；未打开 COM4、未发送硬件命令，不构成真实驱动故障注入或 Gate B |
| `pnpm typecheck` | strict TypeScript 通过 |
| `pnpm build` | Vite/Profile 与 .NET Release 通过；C# 0 warning/0 error |
| `pnpm test:e2e` | 当前 Edge 三档视口 63/63 通过 |
| Gate A | 6 条命令结果均 `completed + feedbackConfirmed`；0 条运动目标 |
| 清理预检 | COM4 PnP OK；gateway/process/listener 0；监督配置和 token 不存在 |
| 最终构建后预检 | 通过；四程序集清单 SHA-256 `f5633df61a5f1a225972af02b17b3af505b572ecc09acac82190929255886ead`；未打开串口、未发网络请求 |

## 恢复清单

- [ ] 阅读 [路线图](../roadmap.md)、[产品边界](../product-boundaries.md)、[协议](../protocols/dummy-ascii-v1.md)、[RobotGatewayV1](../../shared/contracts/robot-gateway-v1.md)、[ADR-0004](../decisions/0004-supervised-command-boundary.md) 和 [runbook](../runbooks/phase-05-supervised-control-com4.md)。
- [ ] 检查 Git 状态；Phase 5 应保持未提交，直到 Gate B 和退出门完成。
- [ ] 不再执行 Gate A，也不为补齐旧协议帧重新打开 COM4。
- [ ] Gate B 必须使用新的现场授权、一次性令牌和独立证据目录。
- [ ] 任一 `unconfirmed/failed/timedOut/cancelled` 立即进入停止链，不得继续动作序列。
