# Phase 08 Handoff — Aethor_robo 第二个七轴关节组与双会话

- 状态：待执行
- 固件 commit：TBD
- 上位机 commit：TBD

## 必交结果

- 第二控制器的 controller_id、arm_id、七轴配置和参数版本。
- `arm-01/arm-02` 到 Profile `left-arm/right-arm` 的装配映射与签字记录。
- 第二组 Phase 1–7 硬件相关验收摘要。
- 两串口会话同时在线的遥测、命令和资源测试。
- 控制台切换机械臂时目标草稿、实体/幽灵模型和命令状态隔离测试。
- 单侧断线、单侧故障和单侧 STOP 不影响另一组的证据。

## 退出确认

- [ ] 固件源码和协议没有按左右臂分叉
- [ ] 所有请求绑定 controller_id/arm_id
- [ ] 两组状态、目标和动作编排不串组
- [ ] 双臂 Profile 与两套物理会话映射已记录
