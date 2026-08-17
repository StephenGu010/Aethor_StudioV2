# Phase 04 Handoff — 参考位与单轴角度统一

- 状态：待执行
- 固件 commit：TBD
- 上位机 commit：TBD

## 必交结果

- 七轴机械参考姿态和 `q_ref_deg` 的可重复操作说明。
- 每轴 direction、zero bias、软限位、低速速度/加速度版本。
- J1–J7 的 +5°/−5° 命令、实机反馈、模型角和最终误差表。
- 重启后 `UNALIGNED`、重新对齐和目标对齐当前的验证。
- ENABLE、STOP、DISABLE、CLEAR_FAULT 的单轴流程结果。

## 退出确认

- [ ] 实机、GET_JPOS、滑条和 URDF 角度统一
- [ ] 无重复反向、零偏或 rad/deg 换算
- [ ] 软限位有机械依据
- [ ] 未对齐时不能运动
