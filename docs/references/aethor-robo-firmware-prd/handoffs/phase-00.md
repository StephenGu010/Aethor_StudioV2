# Phase 00 Handoff — 契约与台架配置冻结

- 状态：待执行
- 固件 commit：TBD
- 上位机 commit：TBD
- 协议版本：`aethor-arm-ascii-v1`

## 必交结果

- CubeMX、Keil、编译器、FreeRTOS、FDCAN1 和 UART 配置快照。
- `App/` 分层和依赖关系已建立，CubeMX 再生成不覆盖业务代码。
- J1–J7 的 CAN ID 1–7、Master ID 11–17 和配置校验测试。
- 方向、限位、速度、加速度、参考位和增益的 TBD 清单；TBD 存在时使能被拒绝。
- 构建日志、Map/栈堆基线和已知问题。

## 退出确认

- [ ] 干净环境可编译
- [ ] 七轴配置静态检查通过
- [ ] 无电机运动
- [ ] Phase 1 台架和测量工具已准备
