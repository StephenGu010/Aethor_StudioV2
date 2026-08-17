# Phase 03 Handoff — 串口协议与只读数字孪生

- 状态：待执行
- 固件 commit：TBD
- 上位机 commit：TBD

## 必交结果

- CRC、分帧、请求号、重复请求和错误码测试报告。
- HELLO、GET_INFO、GET_CONFIG、GET_STATE、GET_JPOS、SET_STREAM 和 HEARTBEAT 抓包。
- 1 小时 50 Hz 遥测的序号间隙、CRC 错误和丢帧统计。
- J1–J7 实机手动转动与 URDF 实体模型方向/幅值记录。
- 串口断开、错误 COM、重连和 boot_id 变化验证。
- 一个请求不回包时后续终端查询与 STOP 仍能完成 transport write 的优先级队列证据。

## 退出确认

- [ ] 实体模型只由实测 q_deg 驱动
- [ ] 查询/终端不影响 CAN 与遥测
- [ ] RX 持续读取，TX writer 不跨响应等待持锁，队列容量和高水位有界
- [ ] map_hash 不一致时运动被禁用
- [ ] HEARTBEAT 超时产生 STOP_DISABLE
