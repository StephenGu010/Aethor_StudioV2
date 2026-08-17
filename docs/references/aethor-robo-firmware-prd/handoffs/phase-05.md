# Phase 05 Handoff — 七轴位置速度整组控制

- 状态：待执行
- 固件 commit：TBD
- 上位机 commit：TBD

## 必交结果

- 七轴 MOVE_JOINTS 原子校验和命令生命周期测试。
- 20 组保守姿态往返记录：目标、最终反馈、误差、到位时间差。
- RUNNING、SETTLING、DONE、BUSY、STOP 和超时抓包。
- 动作编排逐段等待 DONE 的验证。
- 完成/停止/失败后下一条命令可立即执行的证明。

## 退出确认

- [ ] 运动期间 50 Hz 实体模型连续更新
- [ ] ACK 未被当作完成
- [ ] STOP 后无需重启即可继续
- [ ] POS_VEL 同步性结论按实测表述
