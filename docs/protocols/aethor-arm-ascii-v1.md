# Aethor Arm ASCII v1 候选协议

## 状态与适用范围

本文是 `Aethor_robo` 单条七轴机械臂与 Aethor Studio V2 之间的候选协议事实源，协议 ID 为 `aethor-arm-ascii-v1`。它服务左臂或右臂中的一条七轴链；双臂由独立的控制器/臂身份区分，不能依靠串口到达顺序推断。

当前状态为 `DRAFT / SOFTWARE CONTRACT VERIFIED`：JSON Schema、TypeScript 类型、ID 映射和控制台降级显示已有软件测试，但固件 parser、CRC 测试向量、串口 adapter 和实机反馈尚未实现。内置 Profile 的 adapter 仍是 `aethor-robo-pending`，全部硬件 capability 继续为 false。

本协议不兼容 Dummy 的 `!START`、`#GETJPOS` 和 `>` 命令。两种机器人可以共享上位机的串口生命周期、日志和终端 UI，但必须使用不同 codec 与状态机。

## 串口与帧

| 项 | 候选规范 |
|---|---|
| 链路 | STM32 UART + DMA；PC 侧虚拟串口或 USB-UART |
| 波特率 | `921600` 候选值，必须由固件与转接器实测后冻结 |
| 数据格式 | 8N1，ASCII，LF 结尾；接收端移除可选 CR |
| 最大行长 | 512 bytes，不含行结束符 |
| CRC | CRC-16/CCITT-FALSE：poly `0x1021`、init `0xFFFF`、无反射、xorout `0x0000` |

请求和输出形态：

```text
REQ  <request_id> <operation> [key=value ...] *<CRC16>
ACK  <request_id> accepted [key=value ...] *<CRC16>
RSP  <request_id> ok [key=value ...] *<CRC16>
ERR  <request_id> <error_code> [key=value ...] *<CRC16>
DONE <request_id> <result> [key=value ...] *<CRC16>
EVT  <event_seq> <event_type> [key=value ...] *<CRC16>
TEL  <frame_seq> <stream_type> [key=value ...] *<CRC16>
```

`request_id` 为 `1..4294967295` 的无符号十进制数，`0` 保留。J1–J7 数组固定七项；角度使用 `deg`，角速度使用 `deg/s`，时间 `t_us` 是 MCU 启动后的单调微秒。数字不得为 `NaN`、`Inf` 或科学计数法，重复键按 `BAD_FRAME` 拒绝。

`ACK` 只表示状态改变命令被接管，`DONE` 才是其最终结果；`RSP` 用于查询，`TEL` 用于可丢旧保新的遥测。上位机不得把 transport 写入、ACK 或通用状态文本解释为实机到位。

## 会话与握手

连接后顺序固定为：

```text
HELLO → GET_INFO → GET_CONFIG → GET_STATE → GET_JPOS → SET_STREAM
```

`HELLO` 返回至少 `product/controller/arm/session/boot_id/dof/protocol/fw/modes/stream_max_hz`。网关同时校验：

- `product=aethor-robo`、`dof=7`、协议主版本一致；
- `controller`、`arm`、`boot_id` 非空，且和当前连接身份一致；
- `GET_CONFIG.map_hash` 与选中 Profile 的部署映射一致；
- 固件实际限位、速度和加速度来自受控部署配置，不从 URDF 的 `0…360°` 或零 velocity 推断。

`boot_id` 改变表示固件重启：清空全部在途请求、撤销旧反馈新鲜度并重新握手。通信看门狗候选值为心跳 250 ms、超时 1000 ms；超时动作必须由握手明确返回为 `STOP_DISABLE`，不能成为隐藏行为。

## 电机发现与关节映射

每条七轴链只有以下稳定映射：

```text
motor_id 1 → J1
motor_id 2 → J2
...
motor_id 7 → J7
```

反馈到达顺序、CAN 接线顺序和本次只连接了几台电机都不能改变映射。调试发现态允许任意 ID 子集；`motor_id > 7` 只进入诊断，不映射到 URDF。出现重复或身份冲突的 ID 时，该 ID 对应关节隔离为 `conflict`，不能任选一帧覆盖模型。

查询和遥测都携带：

- `present_mask`：bit0…bit6 表示是否观测到 ID 1…7；
- `valid_mask`：反馈值是否可用且新鲜；
- `conflict_mask`：身份存在冲突；
- `unexpected_ids`：范围外 ID 的去重升序集合。

结构化 `ENABLE` 和 `MOVE_JOINTS` 只能在 `present_mask=valid_mask=0x7F`、`conflict_mask=0`、`unexpected_ids=none` 且其他状态门成立时开放。部分接线只用于逐电机调试与模型观测。

`GET_JPOS` 示例字段：

```text
RSP <id> ok t_us=<uint64> q_deg=<7 values> present_mask=0x5B valid_mask=0x5B conflict_mask=0x00 unexpected_ids=none
```

`q_deg` 始终七项；缺失槽的数字只是占位，消费端必须以 mask 为准。`GET_MOTORS` 另外返回七项状态、故障、温度和反馈年龄。两个驱动完全使用同一 CAN ID 时固件未必能得出精确数量，因此诊断使用 `DUPLICATE_ID_SUSPECTED`，不伪造重复设备数。

## 关节状态和上位机投影

周期状态候选为：

```text
TEL <seq> JOINT_STATE t_us=<uint64> q_deg=<7> qd_deg_s=<7> tau_nm=<7> present_mask=<hex> valid_mask=<hex> conflict_mask=<hex> unexpected_ids=<list|none> state=<state> active_request=<id|0>
```

固件发布的七轴值必须来自同一个原子快照，查询只读取该快照，不能临时发 CAN 请求。上位机 adapter 将通过信任边界的内容投影为 `AethorArmMotorFrameV1`：

| 字段 | 含义 |
|---|---|
| `contractVersion` | 固定 `1.0` |
| `profileId` | 固定 `aethor-robo-dual-7dof` |
| `jointGroupId` | `left-arm` 或 `right-arm` |
| `controllerId/armId/bootId` | 来自握手的稳定身份 |
| `frameSeq/receivedAtUtc` | 网关有序帧号与接收 UTC 时间 |
| `snapshotComplete` | 是否是完整发现快照；不是“七台电机均在线” |
| `motors[]` | 保留原始 motor ID、角度、反馈年龄和有效标记 |

Schema 有意允许 `0..255` 的 ID、重复项和无序子集，让领域层可以诊断，而不是在 JSON 入口静默丢失证据；最多 32 项，额外字段拒绝。领域层按 ID 更新模型，拒绝同一 `bootId` 下倒序/重复 `frameSeq`，在新 `bootId` 后重新接受低序号。

控制台状态含义：

- `notObserved`：尚无该臂的电机帧，继续显示本地展示姿态；
- `present`：对应 ID 的值有效，可更新实体模型；
- `stale`：有样本但不可作为新鲜反馈；
- `missing`：完整发现快照明确缺失该 ID；
- `conflict`：该 ID 的身份不可信，数值不应用。

一条串联臂从第一个不确定关节起到末端均使用灰色实体材质，因为上游姿态未知会使后续 link 的空间位姿也不可信。幽灵目标保持独立材质，避免把诊断降级混入目标草稿。

## 控制、停止与动作编排

正式运动命令为完整七轴组：

```text
REQ <id> MOVE_JOINTS q_deg=<7 values> speed=<0.01..1.00> mode=<POS_VEL|MIT>
```

`speed` 是已验证每轴速度/加速度上限的比例，不是 `deg/s`。固件生成同步到达的时间标定轨迹并持续反馈；`ACK` 返回预计时长，`DONE COMPLETED` 返回实测末态与最大误差。未对齐、未整组使能、反馈陈旧、目标越界、模式不一致、已有互斥动作或电机故障必须在接管前拒绝。

首版动作编排由上位机逐段发送 `MOVE_JOINTS`；只有上一段收到关联的 `DONE COMPLETED` 才进入下一段。固件不保存动作队列，也不复用 Dummy 的无标签 FIFO。

优先级从高到低为：内部故障停机/`DISABLE`、`STOP`、`ACK/ERR/DONE/EVT`、查询响应、周期遥测。`STOP behavior=controlled` 尝试有界减速，反馈失效时升级为 quick stop 与去使能；`DISABLE` 可幂等调用并以反馈确认整组去使能。

## 上位机并发模型

C# 服务是串口的唯一所有者，采用一个持续 RX reader 和一个有界优先级 TX writer：

- writer 只拥有实际串口写入，不在等待 `RSP/ACK/DONE` 时持有写锁；
- pending request 以 `request_id + boot_id + session` 关联响应，只拥有完成源，不拥有 transport；
- 停止/去使能为 P0，终端人工发送和结构化控制共享 P1 公平队列，心跳与必要查询保留 P2 配额，后台诊断为 P3；
- 周期遥测在固件与上位机两端都丢旧保新，不能挤占控制响应；
- 请求超时不自动用新 ID 重放运动；先查询状态，结果仍未知时由操作者停止和恢复；
- 串口终端的辅助模式必须经过 Aethor codec 校验，raw 模式仍只提交一次 transport write，不等待回包占住发送队列。

该模型与当前 Dummy adapter 分开实现；不能把 Dummy 的 `serialIoGate` 等待响应方式复制到 Aethor，因为它会让查询、终端和运动响应彼此阻塞。A1-U1 已提供未注册生产 DI 的共用双工调度软件门；协议 codec、response correlation 和 Aethor session adapter 仍未实现。

## 错误与恢复

基础错误至少包括 `BAD_FRAME`、`BAD_CRC`、`LINE_TOO_LONG`、`UNKNOWN_OPERATION`、`BAD_VALUE`、`DOF_MISMATCH`、`OUT_OF_RANGE`、`INVALID_STATE`、`NOT_ALIGNED`、`NOT_ENABLED`、`BUSY`、`FEEDBACK_STALE`、`MOTOR_FAULT`、`MODE_MISMATCH`、`CONFIG_MISMATCH`、`MOTOR_ID_OUT_OF_RANGE`、`DUPLICATE_ID_SUSPECTED`、`REQUEST_ID_CONFLICT`、`TX_CONGESTED` 和 `INTERNAL_ERROR`。

同一 request ID 与相同载荷允许一次有界重发并返回原结果；同 ID 不同载荷必须返回 `REQUEST_ID_CONFLICT`。重连后重新执行完整握手，不恢复旧在途动作。

## 实施门

进入真实网关前还需关闭以下门：

1. 固件仓库提交、CubeMX/FreeRTOS 任务所有权与 DM3520 映射可追溯；
2. CRC、parser、重复请求、帧回绕和错误码跨语言测试向量冻结；
3. UART/CAN 负载下 50 Hz 完整快照、反馈年龄和 TX 拥塞行为实测；
4. 单电机、任意子集、乱序 ID、ID >7、冲突 ID 和全七轴发现验收；
5. STOP/DISABLE、看门狗、MIT/POS_VEL、同步到达与梯度速度完成独立监督验收；
6. C# adapter、终端 codec、REST/SignalR 投影和资源释放通过 fake transport 后，才允许打开真实串口。
