# Dummy ASCII v1 协议适配说明

## 权威来源

- 仓库：`D:\Aethor_robot\dummy_ref`
- 固定提交：`5b9b602d8013799895c03f288e98ad72f38193be`
- 人类说明：根 `README.md`
- 行解析：`dummy-ref-core-fw/Bsp/communication/ascii_processor.cpp`
- 命令分支：`dummy-ref-core-fw/UserApp/protocols/ascii_protocol.cpp`
- 执行与停止：`dummy-ref-core-fw/Robot/instances/dummy_robot.cpp`、`dummy_robot.h`

README 与代码冲突时，以固定提交代码和后续监督台架证据为准，并保留冲突记录。Safety First 的 RGB/回包定义不是 V2 的协议依据。

## 传输与边界

- UART4/USB CDC：115200 baud，ASCII 按行处理；V2 统一发送 LF（`\n`）。固件接收 CR 或 LF。
- 固件声明 `MAX_LINE_LENGTH=256`，但解析循环在索引达到 256 后丢弃该行，因此 V2 最大有效 payload 是 255 个 ASCII 字符。
- 运动 FIFO 为 16 项、每项 64 bytes；V2 formatter 要求 `>` 命令不超过 63 个 ASCII 字符，保留 NUL 终止空间。
- 后端必须处理分片、粘包、空行、非 ASCII、超长行、未知行、不完整尾帧、拔线、取消和超时；所有队列、监听器和历史必须有界。
- COM4 只代表当前枚举结果。2026-08-09 Gate A 曾在明确授权下人工连接一次并验证状态控制，随后确认 disabled、断开并清理；未来任何连接仍需重新取得当次现场授权。

## V2 公共白名单

| 类别 | 命令 | 固件响应 | V2 完成策略 |
|---|---|---|---|
| 使能 | `!START` | `Started ok` | ACK 仅表示已处理；`#GETENABLE=1` 后才完成 |
| 停止 | `!STOP` | `Stopped ok` | ACK 不是最终确认；`#GETENABLE=0` 后才确认去使能 |
| 去使能 | `!DISABLE` | `Disabled ok` | `#GETENABLE=0` 后才完成 |
| 回零 | `!HOME` | `Homing ok` | 无可信完成帧，不能仅凭 ACK 宣称物理回零成功 |
| 复位 | `!RESET` | `Started ok` | 无可信完整恢复确认，结果保持 accepted/unconfirmed |
| 查询关节 | `#GETJPOS` | `ok j1 j2 j3 j4 j5 j6` | 六个有限数值解析成功后完成 |
| 查询模式 | `#GETMODE` | `ok <num> <name>` | 仅 1–3 且编号/名称一致时有效 |
| 查询使能 | `#GETENABLE` | `ok 0/1` | 合法读回即完成 |
| 设模式 | `#CMDMODE <1..3>` | `ok Set command mode to [m] (<name>)` | ACK 后仍以 `#GETMODE` 匹配为完成 |
| 关节组 | `>j1,...,j6[,speed]` | 先返回 FIFO 余量，随后 `ok` | supervised 只以新鲜反馈收敛完成；engineering 按下述模式语义形成调试结果 |

当前生产配置只可能宣告使能、停止并去使能和模式 1–3。HOME/RESET 因固件阻塞风险默认排除；关节组因没有已验证的速度、到位容差、连续稳定窗口和总超时默认排除。端点存在只代表稳定契约，不代表 capability 已开放。

`shared/contracts/src/dummyAsciiV1.ts` 是 TypeScript 可执行规范；`shared/contracts/conformance/dummy-ascii-v1.vectors.json` 是未来 C# 适配器必须复用的语言无关样例。

## 关节坐标约定

`#GETJPOS` 的六个数值是 V2 唯一的设备角坐标。反馈表、滑条、目标草稿、动作点位、误差计算和 `>j1,...,j6,speed` 下发都保留这套坐标，不在串口命令前追加模型偏置。

| 关节 | 设备角范围 (deg) | URDF 渲染换算 |
|---|---:|---|
| J1 | -170…170 | `model = device` |
| J2 | -75…90 | `model = device` |
| J3 | 0…180 | `model = device - 90` |
| J4 | -180…180 | `model = device` |
| J5 | -120…120 | `model = device` |
| J6 | -720…720 | `model = device` |

范围来自固定固件提交中 `DummyRobot` 的六个 `CtrlStepMotor` 构造参数。J3 偏置来自同一提交的 `Homing() = (0,0,90,0,0,0)`、`MoveJoints(target-initPose)` 与 `currentJoints=motor.angle+initPose`：设备 J3=90° 对应 URDF J3=0°。J2–J6 的电机反向标志在命令编码和反馈解码两侧对称应用，原 PySide profile 也把六轴 `joint_sign` 设为 `+1`，因此 V2 不再额外翻转符号。`RobotProfileManifestV1.joints[].modelTransform` 只在 3D 渲染边界应用，反向换算测试保证模型角不会混入设备下发；最终物理正方向仍以监督式逐轴小步测试为验收证据。

## 内部停止链例外

规划的停止链仍为 `!STOP → $0,0,0,0,0,0 → !DISABLE → #GETENABLE`，但 `$0...` 不是公共白名单命令：

- 固件代码在 `$` 格式正确时只调用 `SetJointCurrentsCached`，没有发送成功 ACK；README 所写成功 `ok` 与该提交代码不一致。
- 电流实际应用仍受模式 5、使能和 compliant active 条件约束；V2 不进入模式 5，也不把这个步骤当作停机证据。
- 未来后端只允许生成固定的全零内部命令。写入失败要记录，但不得阻塞后续 `!DISABLE` 和 `#GETENABLE`。
- 唯一可向 UI 宣称的停机确认是最终读回 `#GETENABLE=0`；否则为 `unconfirmed`，并提示使用物理急停。

## 模式与运动前缀

| 模式 | 固件名称 | 首版 | `ok` 的证据等级 |
|---|---|---|---|
| 1 | `SEQ_POINT` | 支持 | 执行循环退出后发送；去使能也会让循环退出，仍需反馈确认 |
| 2 | `INT_POINT` | 支持 | 解析目标后立即发送，绝不表示到位 |
| 3 | `CONT_TRAJ` | 支持 | 执行循环退出后发送；不等于 V2 提供轨迹规划或平滑保证 |
| 4 | `MOTOR_TUNE` | 排除 | 不解析为有效会话模式 |
| 5 | `COMP_CURRENT` | 排除 | 不解析为有效会话模式 |

固件对 `>` 与 `&` 的关节代码路径相同，V2 只生成 `>`。`&` 仅作为固件遗留别名记录，不进入 UI、DTO 或动作编排。`@` 笛卡尔流、通用 `$` 电流流、RGB、标定、PID 和 reboot 均不提供公共构造入口。

## 回包分类

- `0..15`：成功入队后的剩余 FIFO 空间，属于 accepted 证据；`0` 表示本次已入队但队列已满。
- `255`：固件内部失败哨兵；当前入口通常转换为 `error CMD FIFO FULL`，解析器仍显式识别该值。
- `error ...`：设备错误，保留首 token 作为 code、完整行作为诊断证据。
- `ok`：通用设备 ACK。模式 1/3 中，当前参考固件在 `IsMoving()` 结束后发送，因此 engineering 可写作“固件报告本条运动结束”，证据仍是 `deviceAck`，不是独立实测到位；模式 2 中固件立即发送，只表示可中断目标已受理，不能写作到位。

engineering direct 采用人工确认：HTTP 校验并入队后返回 `queued + gatewayAccepted`，物理 writer 成功后另行发布 `sent + transportWritten`。请求不等待队列号、`ok` 或到位，也不持有响应 waiter；迟到的 `0..15`、`ok` 与 `error CMD FIFO FULL` 只进入协议/诊断日志，不反向改变结果或阻止下一次人工下发。`transportWritten` 不能解释为设备接收、入队、运动开始或到位；正式 supervised 关节组仍必须使用反馈收敛完成策略。

engineering 网关还会区分“持续收到位置回包”和“位置值确实在变化”。每次人工关节组写入都会以写入前最新实测角为基准重新开始观察；当观察时间至少 500 ms、样本不少于 8 帧、六轴最大变化不超过 0.02°，且当前位置与目标的最大误差仍不少于 0.5°时，关节反馈标为 `stale`，并仅记录一次 `feedbackFrozen` 协议错误帧和 `engineering.motion.feedback_frozen_suspected` 诊断。后续任一关节变化超过 0.02°即恢复 `valid` 并记录 `engineering.motion.feedback_progress_resumed`。此机制不锁定命令、不停止 25 ms 查询、不自动重发，也不把“冻结”解释为实机静止。
- 未知/非 ASCII/数值错误/超长/不完整行：保留为可诊断分类，不更新可信状态。

命令状态只允许从 `created` 进入 `accepted/rejected/unsupported`，再进入 `completed/failed/timedOut/cancelled/unconfirmed`。终态不可被迟到 ACK 覆盖。

## 固件实现风险与未知项

### 运动中反馈修复要求

参考固件保持只读。正式固件改动应沿用现有 FreeRTOS/CAN 回调链，不新增第二条上位机串口连接：

1. 在位置模式 1–3 中按独立有界节拍发起一次广播角度查询；不要在每个 200 Hz 控制 tick 无条件增加查询。初始候选为 20 Hz，最终值由 CAN 帧率、丢帧率和控制抖动实测决定。
2. 每次查询建立新的六轴响应位图；CAN `0x23` 回包按 node 1–6 置位，只在六轴齐全时把 `motorJ[i].angle + initPose[i]` 一次性提交为新的 `currentJoints`，并递增固件关节帧序号。超时丢弃不完整批次，保留上一完整帧。
3. `#GETJPOS` 读取完整快照，不能在六个 float 更新到一半时拼出混合帧。若当前 MCU 上 24 bytes 复制不是原子的，应使用短临界区或双缓冲指针交换。
4. `UpdateJointPose6D()` 只消费已提交的完整关节帧；不得用 `targetJoints` 或上位机插值替代 `currentJoints`。
5. 回归至少覆盖 disabled、模式 1/2/3 运动、停止、去使能和 CAN 单轴丢包；验收证据是运动期间连续变化的 `#GETJPOS`，而不是命令队列 ACK。

当前 supervised 网关在关节组到位等待期间保留首个有效 `#GETJPOS` 样本。若目标仍在容差外、至少三个有效样本完全不变且最终到达总超时，网关记录一次 `motion.feedback.frozen_suspected`，命令仍以 `timedOut + deviceQueued` 结束并锁存联锁。engineering 人工运动使用上文的在线冻结观察，只降级反馈、不锁定后续命令。两者都只是区分“查询有回包但反馈冻结”和“查询本身超时”的诊断证据，不能证明实机没有运动。

主机只保留一个串口问答 owner。默认 `#GETJPOS` 请求周期为 25 ms，并从周期起点扣除 I/O 耗时；`#GETMODE` 与 `#GETENABLE` 每 250 ms 交替插入一项，不形成慢查询突发。结构化运动由同一命令循环按 25 ms 查询位置；engineering 运动只在写入时短暂取得串口，随后由后台轮询继续读取。人工运动期间查询超时不自动断开，探针按首条和每 20 次汇总，反馈恢复单独记录。两条路径都不允许并发读取。该 40 Hz 是主机请求节拍，不是固件 CAN 采样率或实机已验证反馈率。

- `!` 和 `#` 分支大量使用 substring 匹配；V2 必须发送精确白名单，禁止 `!NOTSTOP` 一类文本触发意外命令。
- 固件 `#CMDMODE` 会回显请求数字，范围外输入不一定返回错误；V2 在 formatter 和 Schema 层先拒绝 4/5 及其他值，并通过 `#GETMODE` 复核。
- 固件没有可信的速度上限、安全回位姿态、统一运动完成事件或已验证的反馈收敛策略。当前网关用 `#GETJPOS` 连续实测作为外部完成证据，但速度、到位容差、稳定窗口和总超时仍必须来自可追溯台架证据，不得从 README、URDF 零 velocity 或旧上位机默认值推断。
- 固件已经以 FreeRTOS 分离实时控制、命令 FIFO 和 UART/USB 处理，电机角请求也通过 CAN 回调更新，因此上位机不应创建第二个串口 owner。当前缺陷位于固件反馈采集：位置模式 1–3 的 200 Hz 控制分支调用 `MoveJoints()` 和 `UpdateJointPose6D()`，但没有调用 `UpdateJointAngles()`；`#GETJPOS` 只能重复返回未刷新的 `currentJoints`。应在固件现有控制/CAN 所有权内加入有界周期的电机角请求并经 CAN 回调更新，先测量 CAN 负载再确定周期；不能用目标插值伪装为实测反馈。该固件修复尚未写入只读参考仓库。
- `DummyRobot::Homing()` 与 `Resting()` 先把速度设为 10，再在 `while(IsMoving())` 中阻塞，协议层只有函数返回后才发送 ACK。运动期间命令处理可能无法及时解析 `!STOP`，因此当前不能把 HOME/RESET 视为可安全抢占动作。
- Gate A 已取得使能、模式 1–3、停止链和最终 disabled 的真实回读；未验证模式 3 点列连续性、任何关节运动、运动中抢占或四参数运动包络。Gate A 证据不能复用为 Gate B 授权。
