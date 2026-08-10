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
| 关节组 | `>j1,...,j6[,speed]` | 先返回 FIFO 余量，随后可能 `ok` | 只在新鲜反馈收敛到目标后完成 |

当前生产配置只可能宣告使能、停止并去使能和模式 1–3。HOME/RESET 因固件阻塞风险默认排除；关节组因没有已验证的速度、到位容差、连续稳定窗口和总超时默认排除。端点存在只代表稳定契约，不代表 capability 已开放。

`shared/contracts/src/dummyAsciiV1.ts` 是 TypeScript 可执行规范；`shared/contracts/conformance/dummy-ascii-v1.vectors.json` 是未来 C# 适配器必须复用的语言无关样例。

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
- `ok`：通用设备 ACK，只推进 evidence，不直接进入 `completed`。
- 未知/非 ASCII/数值错误/超长/不完整行：保留为可诊断分类，不更新可信状态。

命令状态只允许从 `created` 进入 `accepted/rejected/unsupported`，再进入 `completed/failed/timedOut/cancelled/unconfirmed`。终态不可被迟到 ACK 覆盖。

## 固件实现风险与未知项

- `!` 和 `#` 分支大量使用 substring 匹配；V2 必须发送精确白名单，禁止 `!NOTSTOP` 一类文本触发意外命令。
- 固件 `#CMDMODE` 会回显请求数字，范围外输入不一定返回错误；V2 在 formatter 和 Schema 层先拒绝 4/5 及其他值，并通过 `#GETMODE` 复核。
- 固件没有可信的速度上限、安全回位姿态、统一运动完成事件或已验证的反馈收敛策略。当前网关用 `#GETJPOS` 连续实测作为外部完成证据，但速度、到位容差、稳定窗口和总超时仍必须来自可追溯台架证据，不得从 README、URDF 零 velocity 或旧上位机默认值推断。
- `DummyRobot::Homing()` 与 `Resting()` 先把速度设为 10，再在 `while(IsMoving())` 中阻塞，协议层只有函数返回后才发送 ACK。运动期间命令处理可能无法及时解析 `!STOP`，因此当前不能把 HOME/RESET 视为可安全抢占动作。
- Gate A 已取得使能、模式 1–3、停止链和最终 disabled 的真实回读；未验证模式 3 点列连续性、任何关节运动、运动中抢占或四参数运动包络。Gate A 证据不能复用为 Gate B 授权。
