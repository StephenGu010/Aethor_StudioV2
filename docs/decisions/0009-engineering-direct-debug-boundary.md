# ADR-0009：Dummy engineering 直连调试边界

## 状态

Accepted，2026-08-10；2026-08-12 修订为人工确认运动，2026-08-13 随 A1-U2 修订为排队/写入两阶段结果。只适用于 Development 调试，不关闭 Phase 5 Gate B，也不等同于正式桌面启动策略或发布候选能力。

## 背景

Dummy 固件与旧上位机支持人工发送 ASCII 指令，但 `RobotGatewayV1.1` 只公开结构化命令。当前没有可信的四参数运动包络，正式 `jointGroup` 因而必须保持关闭；同时，前端管理员解锁只改变输入框状态，既不能解决实机调试，也会形成错误的权限暗示。错误 COM 口还可能停在 `connected + stale/unknown`，旧 UI 因要求 fresh + disabled 而无法释放。

## 决策

- wire contract 当前为 `RobotGatewayV1.4`。`queued + gatewayAccepted` 只表示进入有界网关队列；`sent + transportWritten` 才表示串口物理写入完成，两者都不是设备确认。
- engineering 只允许 `ASPNETCORE_ENVIRONMENT=Development + tokenSource=development`。桌面无参数启动继续固定 `Production + desktop token + disabled`；本机开发包只有显式携带 `--engineering` 才切换到 Development engineering，且启动不会自动打开串口。supervised 仍要求 desktop token。
- 删除前端管理员机制，命令输入始终可编辑。离线只校验；只有能力协商明确返回 engineering direct 才能发送。
- C# 继续唯一拥有串口。direct 不是任意 raw 通道，只接受三个查询、`!START/!STOP/!DISABLE`、模式 1–3，以及恰好六个角度和一个显式速度的 `>` 命令。
- HOME/RESET、RGB、模式 4/5、电流/PID、标定、reboot、多行、控制字符和非 ASCII 均拒绝。Infrastructure 再次执行 payload allow-list。
- 六轴 direct 要求当前 session 已至少取得一帧 measured 六轴数据、有效模式、motor enabled、恰好六个有限设备角和 `0 < speed <= 100`。不应用旧 Profile/URDF 角度范围，也不裁剪设备角。engineering 人工模式允许保留最后实测值的 stale 会话继续下发；断开或切换 session 后必须重新取得实测帧。100 只来自固件输入范围。
- direct HTTP 在校验并入队后立即返回 `queued + gatewayAccepted`；物理 writer 完成后通过有界 REST 历史和 SignalR 发布 `sent + transportWritten`。它不读取、不等待也不解释 FIFO 数字、`ok` 或到位；没有设备回包时不会占住下一次发送。
- `transportWritten` 不是设备接收、固件入队、运动开始或到位证据。结果不允许携带 `deviceReply`；迟到的 `0..15`、`ok` 或 `error CMD FIFO FULL` 只归入有界协议/诊断日志，不改变任何命令状态。
- `DummySerialSession` 只有一个连续 reader 和一个优先级 writer。direct 不创建响应 waiter；唯一后台轮询继续尝试 `#GETJPOS`。人工运动期间连续查询超时只把反馈标为 stale、按首条和每 20 次汇总记录，不自动断开串口，恢复时记录一次探针。
- direct 与结构化命令共享有界物理 writer，但不共享“等待回复”的互斥。结构化问答通过 response fence 匹配设备回包，P0 STOP/DISABLE 可以抢占低优先级 fence；真实 TX/RX 进入协议帧，前端不得伪造。
- direct 写入失败、排队过期、被 P0 淘汰或 session 关闭都有独立结果，不声称已发送。查询、启停、去使能和模式命令仍等待匹配设备回包，engineering direct 采用人工确认。
- 普通断开只在命令在途或 motor 明确 enabled 时拒绝；成功打开后的 stale/unknown/faulted 错误会话允许释放。从未打开成功的端口直接恢复 offline，不创建需要再次点击“释放”的伪会话。
- 完成断开后清空当前会话协议/命令证据、连接状态、遥测历史和目标草稿，模型回到 Profile 软件启动姿态；已自动保存的动作程序、布局和导出文件不受影响。该姿态不是实机 HOME 或安全回位。
- 动作编排在同一 engineering policy 上增加独立 `EngineeringActionProgramRuntime`：它提交不可变 authored revision，逐点复用 direct 的 `sent + transportWritten` 证据，按最大角差/速度估算等待，可单次或循环。它不把 direct 提升为设备确认；终态显式为 `finishedUnconfirmed/stoppedUnconfirmed`。
- 动作运行期间 C# 持有串口命令所有权。查询仍可用，结构化停止、终端 `!STOP/!DISABLE`、断开或 runtime dispose 会先取消未来点位并撤销尚未写出的当前点位；writer 已取得的原子写入先收束，再发送停止链。其他外部状态改变/运动命令拒绝，避免两套调度互相穿插。
- 六轴值不套用旧 Profile/URDF 范围，也不做三位小数舍入。TS/C# 以共享 vectors 固定最短往返文本，并共同执行固件 FIFO 63 ASCII 字符上限。

## 后果

- 可以在固件不提供稳定运动回包时连续人工调试，并把“串口写入”“设备确认”“实机到位”彻底分开。
- engineering 的人工动作运行不是反馈确认式监督执行，不能作为 Gate B 或发布候选的到位证据。
- direct 请求目前以有界协议 TX/RX 和 HTTP result 为证据，不进入结构化 `CommandAuditRecord`；需要正式可恢复的运动审计时必须走 supervised `jointGroup`。
- Aethor_robo 不受影响，仍无串口、协议或硬件命令能力。

## 验证

- parser/transport 接受六个任意有限设备角并拒绝错误轴数、非有限值、缺速度、HOME/RESET、RGB、电流和多行输入。
- fake transport 证明无任何运动回包时可连续受理多个 `queued` 请求，并各自收束为 `sent`；迟到 ACK 只记日志；连续查询超时不自动断开或阻止下一目标。
- UI 回归覆盖无管理员输入、离线禁发、engineering 发送和错误端口释放。
- 实机到位、零位、方向、速度和停止响应仍需按运行手册人工验证。
