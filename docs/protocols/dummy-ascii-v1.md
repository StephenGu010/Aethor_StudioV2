# Dummy ASCII v1 协议适配说明

## 权威来源

- 仓库：`D:\Aethor_robot\dummy_ref`
- 固定提交：`5b9b602d8013799895c03f288e98ad72f38193be`
- 人类说明：根 `README.md`
- 解析实现：`dummy-ref-core-fw/UserApp/protocols/ascii_protocol.cpp`
- 停止实现：`dummy-ref-core-fw/Robot/instances/dummy_robot.cpp`

如 README 与代码不一致，先记录冲突并用固件代码和监督台架测试确认，不能由前端猜测。Safety First 的 RGB/回包描述不是 V2 的协议依据。

## 传输

- 当前设备：手动选择串口；已发现 COM4 不代表已授权打开。
- 串口：115200 baud，按行 ASCII，发送以 `\n` 结束。
- 后端必须处理分片、粘包、空行、超长行、未知行、拔线和超时；前端不得直接持有串口。

## V2 结构化白名单

| 类别 | 命令 | 典型成功响应 | V2 语义 |
|---|---|---|---|
| 使能 | `!START` | `Started ok` | 已接收使能动作；随后用 `#GETENABLE` 确认 |
| 停止 | `!STOP` | `Stopped ok` | 固件当前实现保持当前位、清电流、去使能并清 FIFO；仍需读回确认 |
| 去使能 | `!DISABLE` | `Disabled ok` | 已接收；随后用 `#GETENABLE` 确认 |
| 回零 | `!HOME` | `Homing ok` | 已开始/接受，不等于物理回零完成 |
| 复位 | `!RESET` | `Started ok` | ACK 不等于完整恢复成功 |
| 查询关节 | `#GETJPOS` | `ok j1 j2 j3 j4 j5 j6` | 六轴反馈帧 |
| 查询模式 | `#GETMODE` | `ok <num> <name>` | 只接受适配器允许的模式 1–3 |
| 查询使能 | `#GETENABLE` | `ok 0/1` | 状态确认来源 |
| 设模式 | `#CMDMODE <1..3>` | `ok Set command mode...` | 仅 1–3 暴露为结构化能力 |
| 关节组 | `>j1,...,j6[,speed]` / `&...` | 立即队列余量，随后可能 `ok` | 显式整组六轴下发；按模式解释完成语义 |

`@` 笛卡尔流不是 V2 能力。虽然固件支持模式 4/5、`$` 电流流、RGB、标定、PID 和 reboot，首版 UI/API 均不提供其结构化入口。

## 模式和回包语义

| 模式 | 固件名称 | 首版 | `ok` 解释 |
|---|---|---|---|
| 1 | `SEQ_POINT` | 支持 | 固件执行路径等待运动结束后返回 |
| 2 | `INT_POINT` | 支持 | 解析后即可返回，不能解释为物理到位 |
| 3 | `CONT_TRAJ` | 支持 | 固件执行路径等待运动结束后返回；不等于 V2 提供轨迹规划 |
| 4 | `MOTOR_TUNE` | 排除 | 不适用 |
| 5 | `COMP_CURRENT` | 排除 | 不适用 |

运动流入队成功先返回整数队列余量；内部失败值可能表现为 `255`，另有 `error CMD FIFO FULL` 路径。适配器必须把“已入队”“已 ACK”“已完成/到位”分开建模。

## 停止与安全

固件当前 `EmergencyStop()` 会保持当前位置目标、清零关节电流、设置 `isEnabled=false` 并清空 FIFO。README 仍建议 `!STOP → $0,0,0,0,0,0 → !DISABLE`；其中 `$0...` 只有模式 5 才解析，且 V2 不暴露模式 5。因此后端将该项视为兼容性的 best-effort 防御步骤，最终权威仍是 `#GETENABLE` 读回为 `0`。

任何 ACK、超时或串口断开都不能让 UI 显示“急停成功”。软件停止不能替代物理急停；实机验收前必须让物理急停可达。

## 待阶段 1 固化

- 用 formatter/parser 测试固定所有已允许帧及错误帧。
- 明确 `>` 与 `&` 在各模式下的产品选择，避免重复入口。
- 将 accepted/completed/unconfirmed 与反馈新鲜度纳入共享 Schema。
- 验证无 mode 5 时 `$0...` 的响应/超时处理，停止链不能因此阻塞去使能与读回。

