# Phase 07 Handoff — 故障恢复与长稳

- 状态：待执行
- 固件 commit：TBD
- 上位机 commit：TBD

## 必交结果

- 单轴反馈超时、驱动故障、CAN bus-off、overflow、串口拥塞和断线注入记录。
- 8 小时静态遥测与 2 小时保守动作循环报告。
- 任务栈余量、堆、队列高水位、日志覆盖、CAN/UART 和 deadline 指标。
- boot_id 变化、重复 request ID、网关重连和 in-flight 清理结果。
- 故障原因、恢复条件和人工步骤的运行手册。

## 退出确认

- [ ] 故障状态与原始证据可关联
- [ ] STOP/DISABLE 不受遥测拥塞影响
- [ ] 无资源持续增长、死锁或状态卡住
- [ ] 恢复后可执行新的合法命令
