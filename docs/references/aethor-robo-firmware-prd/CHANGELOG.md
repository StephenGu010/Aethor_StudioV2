# 变更记录

## 0.3.0-draft — 2026-08-12

### 修订

- 调试发现态允许任意数量、任意接线顺序的电机，以 `motor_id 1…7` 固定映射 J1…J7；整组运动仍要求完整唯一七轴。
- `GET_JPOS/GET_MOTORS/JOINT_STATE` 增加 `present/valid/conflict` mask 与异常 ID 集合，缺失值不再具有反馈语义。
- 明确 ID >7 不映射、重复 ID 只按可观测证据报告 `DUPLICATE_ID_SUSPECTED`，不虚构精确数量。
- C# 网关改为持续 RX、单 writer 有界优先级队列；写入锁不跨越设备响应等待，STOP、终端与诊断查询可继续入队。
- 补充部分关节数字孪生灰显、串联链姿态不确定传播、终端异步回包与双 adapter 单会话所有权。

## 0.2.0-draft — 2026-08-12

### 修订

- 将 Classic CAN 1 Mbps、UART 921600、250 Hz 控制和 50 Hz 遥测区分为供应商默认值、候选值与待核对的工程配置。
- 明确 MIT 使用 `CANID`、位置速度使用 `0x100+CANID`，特殊 FC/FD/FB 帧必须使用当前驱动模式对应的 ID。
- 将 `0x7FF/0xCC` 标为供应商 H7 示例能力，要求 Phase 1 单电机实测后再进入七轴轮询。
- 取消普通运行时 `SET_MODE`；驱动模式写入/复位改为维护流程，并要求复位后清除对齐、重建 boot/session。
- 收紧 HEARTBEAT 会话所有权、重复请求、字段语法和网关有界重试规则。
- 对齐当前 Aethor Studio V2 双七轴 Profile：首组保持 `arm-01`，装配完成后再映射 left/right；不复制 Dummy wire v1.3。
- 补充 CRC 独立核对、跨语言测试、第二组双会话和阶段 handoff 要求。

## 0.1.0-draft — 2026-08-12

### 新增

- 明确首组 Aethor_robo 七自由度固件的范围、分层和状态机。
- 固定 J1–J7 的电机 CAN ID `1–7` 与 Master ID `11–17`。
- 定义版本化上位机协议 `aethor-arm-ascii-v1`，包含请求关联、CRC、查询、遥测、事件和命令终态。
- 记录 DM3520 MIT、位置速度、反馈、使能、失能和清错帧格式。
- 规定 250 Hz 固件控制周期、50 Hz 上位机遥测和 GET_JPOS 快照读取机制。
- 定义每次上电的关节参考位对齐，统一实机、固件关节角、滑条和 URDF。
- 定义七轴五次时间标度、同步到达、完成判定和位置速度回退路径。
- 建立 Phase 0–8 的分阶段计划、可直接使用的实施提示词、测试矩阵和 handoff 模板。

### 未完成

- 七轴机械方向、机械参考姿态、软限位、速度/加速度和 MIT 增益仍需实机确认。
- 现有 CubeMX/Keil 工程路径和实际 UART 配置尚未纳入核对。
- 固件与 Aethor Studio V2 尚未按本规范实现。

### 资料依据

- Dummy 六轴参考协议：`D:\Aethor_robot\dummy_ref`。
- DM-S3519/DM3520 供应商资料：外部供应商资料（未纳入本仓库）。
- DM-MC-Board02 控制板资料：`D:\Aethor_robot\dm-mc02-master`。
