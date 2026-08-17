# 02 上位机串口协议：aethor-arm-ascii-v1

## 1. 设计目的

`aethor-arm-ascii-v1` 是七自由度控制器与 Aethor Studio V2 硬件网关之间的版本化串口协议。它保留 Dummy 六轴协议便于人工阅读的优点，但修正以下问题：

- 每条请求有明确请求号，不使用无法关联的裸 `ok`。
- `ACK`、最终结果和连续遥测分开，运动期间不阻塞反馈。
- 查询只读取固件内的最新快照，不临时占用 CAN 总线。
- 所有状态和数值带固定单位、固定七轴顺序和明确错误码。
- 允许重发请求，但不会重复执行同一动作。

旧 Dummy 的 `!START`、`#GETJPOS`、`>...` 等格式不作为七轴控制器的正式线协议。Aethor Studio 的高层 `RobotGatewayV1` 保持不变，由新协议适配器实现编码解码。

## 2. 物理链路

| 项 | 规范 |
|---|---|
| 接口 | STM32 UART + DMA，PC 侧虚拟串口或 USB-UART |
| 波特率 | 候选 `921600`；Phase 0 必须以现有 CubeMX 工程、UART 时钟误差和 USB-UART 能力实测冻结 |
| 数据格式 | 8 数据位、无校验、1 停止位（8N1） |
| 文本编码 | ASCII 可打印字符；不在帧内发送中文 |
| 行结束 | `LF` (`0x0A`)；接收端兼容并移除前置 `CR` |
| 最大行长 | 512 字节，含 CRC 前不含行结束符 |
| 接收方式 | DMA circular + IDLE line，写入有界环形缓冲 |
| 发送方式 | DMA；控制响应高优先级，遥测低优先级且可丢旧帧 |

首轮整机部署启用通信看门狗：完成 `HELLO` 后，上位机每 250 ms 发送一次 `HEARTBEAT`，连续 1,000 ms 未收到带正确会话号的合法心跳时，固件终止活动命令、执行受控停止并整组去使能；反馈无效时直接执行失能意图。普通查询和控制请求证明链路正在工作，但不替代独立心跳的所有权语义。看门狗时长和动作必须由 `GET_INFO` 返回，不能成为隐藏行为。

## 3. 通用帧格式

### 3.1 请求

```text
REQ <request_id> <operation> [key=value ...] *<crc16>\n
```

示例：

```text
REQ 42 GET_JPOS *6B48
REQ 43 SET_STREAM rate_hz=50 fields=jpos,jvel,state,motor *847F
REQ 44 MOVE_JOINTS q_deg=0.000,-15.000,30.000,0.000,20.000,0.000,5.000 speed=0.200 mode=MIT *29A0
```

### 3.2 固件响应和异步输出

```text
ACK  <request_id> accepted [key=value ...] *<crc16>
RSP  <request_id> ok [key=value ...] *<crc16>
ERR  <request_id> <error_code> [key=value ...] *<crc16>
EVT  <event_seq> <event_type> [key=value ...] *<crc16>
TEL  <frame_seq> <stream_type> [key=value ...] *<crc16>
DONE <request_id> <result> [key=value ...] *<crc16>
```

含义：

| 类型 | 使用场景 |
|---|---|
| `ACK` | 改变状态的命令已通过校验并被接管 |
| `RSP` | 查询类请求的单次结果 |
| `ERR` | 请求未被接管，或解析失败 |
| `EVT` | 与请求无关或需要持续报告的状态变化 |
| `TEL` | 周期遥测；允许限流或丢弃旧帧 |
| `DONE` | 已接管命令的最终结果 |

### 3.3 字段规则

- `request_id`：无符号 32 位十进制数，`1..4294967295`；`0` 保留。
- `event_seq`、`frame_seq`：无符号 32 位递增，回绕按模 2³² 处理。
- `operation`、键名、枚举值使用 ASCII 大写或小写约定，不包含空格。
- 键值之间用一个空格分隔，列表内部用逗号分隔。
- 浮点数使用十进制点，不使用科学计数法，不允许 `NaN/Inf`。
- J1–J7 列表必须恰好 7 项，顺序固定。
- 角度单位 `deg`，角速度 `deg/s`；与驱动器通信时的 rad 转换不暴露给上位机。
- 时间戳 `t_us` 为 MCU 启动后的单调微秒数，64 位无符号整数。
- 布尔值固定为 `0/1`。
- CRC 前有一个空格和 `*`，CRC 为 4 位大写十六进制。

### 3.4 CRC

- 算法：CRC-16/CCITT-FALSE。
- 多项式：`0x1021`。
- 初值：`0xFFFF`。
- RefIn/RefOut：false。
- XorOut：`0x0000`。
- 计算范围：从行首到 CRC 前空格之前的所有 ASCII 字节。
- CRC 错误时返回 `ERR 0 BAD_CRC`；若能可靠解析请求号，可回显该请求号。

## 4. 握手与能力协商

建立串口后，网关必须先发送：

```text
REQ 1 HELLO client=aethor-studio-v2 protocol=1 *....
```

固件响应示例：

```text
RSP 1 ok product=aethor-robo controller=aethor-arm-controller-01 arm=arm-01 session=831462 dof=7 protocol=aethor-arm-ascii-v1 fw=0.1.0 modes=POS_VEL,MIT stream_max_hz=100 link_watchdog_ms=1000 link_timeout_action=STOP_DISABLE *....
```

`session` 由固件在每次 HELLO 时分配，仅在当前串口连接和当前 `boot_id` 内有效。`boot_id` 在 MCU 每次启动时改变，并应落入握手响应。后续 HEARTBEAT 携带 `session`；不匹配的心跳不刷新通信看门狗。

若 `dof`、协议主版本或产品不匹配，网关不得使能控制按钮。版本兼容规则：

- 主版本不同：拒绝控制，可显示诊断。
- 主版本相同、固件增加可选字段：旧网关忽略未知键。
- 删除字段、修改单位、改变枚举语义：必须升级协议主版本。

## 5. 命令定义

### 5.1 查询命令

#### `GET_INFO`

```text
REQ <id> GET_INFO
RSP <id> ok product=... controller=... arm=... dof=7 fw=... build=... protocol=... can_bitrate=<actual> uart_baud=<actual>
```

#### `GET_CONFIG`

返回固件正在使用的关节映射，而不是上位机 Profile 的副本：

```text
REQ <id> GET_CONFIG
RSP <id> ok config_rev=2026-08-12.1 direction=1,-1,1,1,-1,1,1 q_min_deg=... q_max_deg=... v_limit_deg_s=... a_limit_deg_s2=... map_hash=7F2A91C4
```

上位机连接后比较 `map_hash` 和 Profile 映射；不一致时只允许诊断，不开放运动。

`map_hash` 使用 CRC-32/ISO-HDLC，输入是下列固定顺序、无空格、浮点统一 6 位小数的 ASCII：

```text
dof=7;direction=<csv>;q_min_deg=<csv>;q_max_deg=<csv>;v_limit_deg_s=<csv>;a_limit_deg_s2=<csv>
```

它用于发现配置漂移，不作为密码学签名。固件和 C# 必须共享固定测试向量。

#### `GET_STATE`

```text
REQ <id> GET_STATE
RSP <id> ok state=READY aligned=1 enabled=1 moving=0 mode=MIT active_request=0 fault=NONE feedback_age_max_ms=4
```

#### `GET_JPOS`

```text
REQ <id> GET_JPOS
RSP <id> ok t_us=183920040 q_deg=0.000,-15.012,0.000,0.004,20.001,0.000,4.995 present_mask=0x5B valid_mask=0x5B conflict_mask=0x00 unexpected_ids=none
```

`GET_JPOS` 必须读取最新原子快照，不发送 CAN 查询，不等待新的电机帧。因此它与连续运动、遥测和其他串口命令不会争用 CAN 总线。`q_deg` 始终固定 7 项并按 `motor_id 1…7 → J1…J7` 排列，与反馈到达顺序、接线顺序无关；只有对应 `present_mask` 与 `valid_mask` 位均为 1、且 `conflict_mask` 为 0 时该值才可作为实体模型反馈。缺失项使用最近值或 0 作为占位，但上位机必须忽略其数值语义。

#### `GET_MOTORS`

返回完整发现快照、七轴状态、温度、故障码和反馈年龄：

```text
RSP <id> ok present_mask=0x53 valid_mask=0x51 enabled_mask=0x51 conflict_mask=0x04 unexpected_ids=8,12 status=1,0,1,0,1,0,1 fault=0,0,0,0,0,0,0 mos_c=32,0,32,0,33,0,34 rotor_c=30,0,30,0,31,0,32 age_ms=3,65535,4,65535,4,65535,4
```

- 四个 mask 的 bit0…bit6 对应 `motor_id 1…7`；数组同样固定 7 项，缺失项仅为占位。
- `unexpected_ids` 列出观测到的整数 ID 中不在 1…7 的去重升序集合；没有时为 `none`。这类电机不得映射到 URDF 关节或进入控制帧。
- `conflict_mask` 表示该 ID 的身份不可信。不同反馈 ID 却声明相同 D0 motor ID、配置扫描发现低 8 位冲突或同一槽出现互相矛盾的身份时置位，并产生 `DUPLICATE_ID_SUSPECTED`。两个驱动完全使用相同 CAN ID 时未必能可靠计数，因此协议不得声称知道重复电机的精确数量。
- 调试发现态允许 `present_mask` 是任意子集；结构化 `ENABLE/MOVE_JOINTS` 仅在 `present_mask=valid_mask=0x7F`、`conflict_mask=0`、`unexpected_ids=none` 且其他状态门通过时开放。

#### `GET_DIAG`

返回至少以下计数器：

```text
RSP <id> ok control_hz=250 loop_last_us=3810 loop_max_us=4102 deadline_miss=0 can_rx=238401 can_tx=238410 can_drop=0 can_error=0 uart_rx_overflow=0 uart_tx_drop_tel=12 cmd_queue_hwm=2
```

#### `HEARTBEAT`

```text
REQ <id> HEARTBEAT session=<uint32>
RSP <id> ok state=READY boot_id=<uint32>
```

只有带当前 `session` 的 HEARTBEAT 刷新通信看门狗；其他合法请求更新 `last_valid_request_us` 诊断但不改变心跳所有权。网关必须按 250 ms 固定发送 HEARTBEAT。超时事件为：

```text
EVT <seq> LINK_TIMEOUT elapsed_ms=1000 action=STOP_DISABLE
```

### 5.2 遥测配置

#### `SET_STREAM`

```text
REQ <id> SET_STREAM rate_hz=<0..100> fields=<csv>
RSP <id> ok rate_hz=<actual> fields=<accepted_csv>
```

- `rate_hz=0` 表示停止周期遥测，事件和命令响应不受影响。
- 默认 50 Hz，首版最大 100 Hz。
- 支持字段：`jpos,jvel,jtor,state,motor,diag`。
- 配置只对当前串口会话有效。

### 5.3 参考位对齐

```text
REQ <id> ALIGN_REFERENCE q_ref_deg=<7 values>
ACK <id> accepted
DONE <id> COMPLETED q_deg=<7 values> bias_deg=<7 values>
```

前置条件：`UNALIGNED` 或 `DISABLED`；七轴反馈全部有效且机械臂不运动。处于 `READY/MOVING` 时拒绝。

### 5.4 驱动模式维护

基础协议不提供日常 `SET_MODE`。DM3520 控制模式属于驱动器持久参数；供应商资料表明参数写入会触发驱动器复位。首版通过维护工具或受控部署流程，在整组去使能、机械臂受支撑时统一配置七个驱动器，再由固件启动核对 `CMODE` 并通过 `GET_INFO/GET_CONFIG` 公布当前模式。

如果后续确需远程模式切换，应在向后兼容扩展中增加 `SET_DRIVE_MODE` 维护命令，要求：七轴全失能、逐轴写入并读取确认、任一失败保持不可使能、全部驱动重启后清除 alignment 和活动请求、重新执行自检与参考位对齐。上位机不能把该能力呈现为普通运动模式按钮。

### 5.5 整组使能

```text
REQ <id> ENABLE
ACK <id> accepted
EVT <seq> ARM_STATE state=ENABLING cause=request request=<id>
DONE <id> COMPLETED state=READY enabled=1
```

前置条件：已对齐、七轴反馈新鲜、无驱动故障、模式和映射量程核对成功。七电机依次发送使能帧后，必须从反馈状态确认全部进入使能，不能仅以 CAN 发送成功判定。

### 5.6 停止和去使能

#### `STOP`

```text
REQ <id> STOP behavior=controlled
```

`STOP` 是最高优先级业务命令，可在 `READY/MOVING/STOPPING/FAULT` 中调用：

- `controlled`：从当前估计速度生成有界减速，目标固定为停止时位置；完成后保持使能。
- 如果反馈失效或正常减速无法执行，升级为内部 `quick_stop`，立即停止轨迹推进并去使能全部电机。

人工点击 STOP 时按上述行为执行，允许停止后继续下一条命令；通信看门狗触发的 `LINK_TIMEOUT` 会在受控停止完成后继续执行整组去使能。

#### `DISABLE`

```text
REQ <id> DISABLE
```

取消活动运动，停止发送普通控制设定值，向七电机发送相应模式的失能帧，并从反馈确认。可重复调用；已经去使能时返回 `DONE COMPLETED already=1`。

### 5.7 清除驱动错误

```text
REQ <id> CLEAR_FAULT scope=all
REQ <id> CLEAR_FAULT joint=3
```

只允许在去使能、运动停止且故障来源已消失时执行。清错后重新读取反馈，仍存在故障则 `DONE FAILED`。

### 5.8 整组关节运动

```text
REQ <id> MOVE_JOINTS q_deg=<q1,...,q7> speed=<0.01..1.00> mode=<POS_VEL|MIT>
```

可选字段：

| 字段 | 默认值 | 说明 |
|---|---:|---|
| `speed` | `0.20` | 对每轴已验证速度/加速度限值的比例，不是 deg/s |
| `mode` | 当前模式 | 可选的一致性声明；若出现，必须与当前驱动模式一致，不能触发切换 |
| `settle_ms` | 部署配置 | 到位后连续稳定时间 |
| `timeout_ms` | 自动计算上限 | 只能增大，不能小于固件安全下限 |

响应时序：

```text
ACK 100 accepted motion_id=100 duration_ms=2840 mode=MIT
EVT 812 MOTION_STATE request=100 state=RUNNING
TEL ...
EVT 856 MOTION_STATE request=100 state=SETTLING max_error_deg=0.42
DONE 100 COMPLETED elapsed_ms=2918 max_error_deg=0.18 q_deg=...
```

拒绝条件包括：未对齐、未使能、反馈过期、已有运动、目标越界、非有限数、模式不一致、速度比例越界或任意驱动故障。

### 5.9 动作编排所需命令

固件首版不保存动作序列。上位机动作编排器按段发送 `MOVE_JOINTS`，只有收到上一段 `DONE COMPLETED` 才进入下一段。用户停止时发送 `STOP`，随后清空上位机本地待执行段。

若后续需要 MCU 端队列，必须在协议 v2 中增加有界队列、队列版本和明确取消语义，不能复用 Dummy 的无标识 FIFO。

## 6. 遥测帧

### 6.1 关节状态

默认 50 Hz：

```text
TEL 20191 JOINT_STATE t_us=183920040 q_deg=... qd_deg_s=... tau_nm=... present_mask=0x7F valid_mask=0x7F conflict_mask=0x00 unexpected_ids=none state=READY active_request=0
```

要求：

- 七轴数据来自同一个发布快照，带同一 `t_us`。
- `q_deg` 是对齐后的上位机关节角。
- mask 语义与 `GET_JPOS/GET_MOTORS` 完全相同；缺失、陈旧或冲突轴只能用于诊断，数字孪生不得继续伪装为新鲜反馈。
- 运动任务和 UART 发送解耦；TX 堵塞时丢弃较旧遥测，只保留最新快照。

### 6.2 电机状态

建议 10 Hz 或仅状态变化时发送：

```text
TEL 20192 MOTOR_STATE t_us=... status=... fault=... mos_c=... rotor_c=... age_ms=...
```

### 6.3 控制器状态事件

```text
EVT 901 ARM_STATE state=FAULT cause=MOTOR_FEEDBACK_TIMEOUT joint=3
EVT 902 MOTOR_FAULT joint=5 code=OVERCURRENT raw=0xA
EVT 903 LINK_DIAG telemetry_dropped=15 uart_tx_queue_hwm=7
```

状态变化必须立即产生事件，不等待下一个遥测周期。

## 7. 错误码

| 错误码 | 含义 | 是否可直接重试 |
|---|---|---|
| `BAD_FRAME` | 行结构非法 | 修正后可重试 |
| `BAD_CRC` | CRC 不匹配 | 可重发同一请求号 |
| `LINE_TOO_LONG` | 超过 512 字节 | 否，缩短命令 |
| `UNKNOWN_OPERATION` | 未知命令 | 否 |
| `MISSING_FIELD` | 缺少必填字段 | 否 |
| `BAD_VALUE` | 数字、枚举或列表格式非法 | 否 |
| `DOF_MISMATCH` | 列表不是 7 项 | 否 |
| `OUT_OF_RANGE` | 目标或配置超限 | 修改目标后使用新请求号 |
| `INVALID_STATE` | 当前状态不允许该命令 | 状态恢复后可重试 |
| `NOT_ALIGNED` | 未建立本次上电参考位 | 先对齐 |
| `NOT_ENABLED` | 未整组使能 | 先使能 |
| `BUSY` | 已有互斥命令执行 | 等待终态或停止 |
| `FEEDBACK_STALE` | 一个或多个电机反馈过期 | 排查 CAN |
| `MOTOR_FAULT` | 驱动器报告故障 | 去使能并排查 |
| `MODE_MISMATCH` | 命令模式与驱动模式不一致 | 去使能后切换 |
| `CONFIG_MISMATCH` | ID、量程或部署配置不一致 | 修正配置 |
| `MOTOR_ID_OUT_OF_RANGE` | 观测到 ID 不在 1…7 | 修正驱动 ID；保持调试发现态 |
| `DUPLICATE_ID_SUSPECTED` | 存在重复或低 8 位冲突证据 | 逐台断电核对 ID；禁止整组运动 |
| `REQUEST_ID_CONFLICT` | 同请求号对应不同载荷 | 使用新请求号 |
| `TX_CONGESTED` | 高优先级响应队列也无法及时发送 | 排查串口/网关 |
| `INTERNAL_ERROR` | 固件内部一致性失败 | 禁止运动并导出诊断 |

`DONE FAILED` 还需带 `reason=<error_code>` 和最小定位字段，例如 `joint=3`、`motor_id=3`、`max_error_deg=...`。

## 8. 并发、优先级和流控

固件内部只允许一个会改变机械臂状态的活动命令。查询命令并发读取发布快照，不等待活动动作完成；UART RX 分帧、命令解析、业务执行与 UART TX DMA 必须彼此解耦。优先级从高到低：

1. `DISABLE`、内部故障停机。
2. `STOP`。
3. 命令 `ACK/ERR/DONE` 与状态事件。
4. 查询响应。
5. 周期遥测。

遥测积压时丢旧保新，不能阻塞控制任务。高优先级响应队列满应产生诊断并进入受控故障，而不是覆盖响应。

## 9. 超时与重连

- 查询请求建议网关超时：300 ms。
- `ACK` 建议超时：300 ms；超时后可用同一请求号重发一次。达到重试上限后把结果标记为未知，查询状态或停止，绝不使用新请求号自动重放运动。
- 运动最终结果由固件给出预计时长；网关超时使用 `duration + settle + margin`，但超时后先 `GET_STATE`，不能把未知当失败或成功。
- 串口重连后先 `HELLO → GET_INFO → GET_CONFIG → GET_STATE → GET_JPOS → SET_STREAM`，随后启动 HEARTBEAT。
- 固件重启可由 `boot_id` 变化识别；一旦变化，上位机清空全部在途命令并重新进行参考位对齐。

## 10. 协议示例

完整联调流程：

```text
PC> REQ 1 HELLO client=aethor-studio-v2 protocol=1 *....
MC< RSP 1 ok product=aethor-robo controller=aethor-arm-controller-01 arm=arm-01 session=831462 dof=7 protocol=aethor-arm-ascii-v1 fw=0.1.0 boot_id=3928421 *....
PC> REQ 2 SET_STREAM rate_hz=50 fields=jpos,jvel,state,motor *....
MC< RSP 2 ok rate_hz=50 fields=jpos,jvel,state,motor *....
PC> REQ 3 GET_STATE *....
MC< RSP 3 ok state=UNALIGNED aligned=0 enabled=0 moving=0 mode=POS_VEL *....
PC> REQ 4 ALIGN_REFERENCE q_ref_deg=0,0,0,0,0,0,0 *....
MC< ACK 4 accepted *....
MC< DONE 4 COMPLETED q_deg=0,0,0,0,0,0,0 bias_deg=... *....
PC> REQ 5 ENABLE *....
MC< ACK 5 accepted *....
MC< DONE 5 COMPLETED state=READY enabled=1 *....
PC> REQ 6 MOVE_JOINTS q_deg=0,-10,20,0,15,0,5 speed=0.10 mode=POS_VEL *....
MC< ACK 6 accepted motion_id=6 duration_ms=3200 mode=POS_VEL *....
MC< TEL ...
MC< DONE 6 COMPLETED elapsed_ms=3292 max_error_deg=0.22 q_deg=... *....
```

所有示例中的 CRC 以 `....` 占位，开发时必须用正式 CRC 测试向量替换，并由固件与 C# 共用测试样例验证。协议实现前还必须冻结字段语法：v1 的值不允许空格、`*`、`=`、CR 或 LF；未知键可以忽略，但重复键必须拒绝为 `BAD_FRAME`，避免不同实现选择不同值。
