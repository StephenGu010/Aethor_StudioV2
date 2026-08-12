# 阶段提示词索引

这些文件用于把单个阶段交给另一位工程师或 AI。每次只执行一个阶段，禁止把后续规划顺手标成完成。

执行顺序：

1. [公共上下文](00-common-context.md)
2. [阶段 0：基线与目录治理](phase-00-baseline-and-layout.md)
3. [阶段 1：协议、契约与安全状态机](phase-01-protocol-and-contracts.md)
4. [阶段 2：UI 系统](phase-02-ui-system.md)
5. [阶段 3：关节选择与拖动](phase-03-joint-dragging.md)
6. [阶段 4：只读 COM4](phase-04-readonly-com4.md)
7. [阶段 5：安全硬件控制](phase-05-hardware-control.md)
8. [阶段 6：动作编排](phase-06-action-programming.md)
9. [阶段 7：实时遥测](phase-07-live-telemetry.md)
10. [阶段 8：桌面发布](phase-08-desktop-release.md)
11. [Aethor_robo A1-H：固件证据与跨语言适配](aethor-robo-a1-h-firmware-adapter.md)

开始阶段 N 前，必须同时阅读 [路线图](../roadmap.md)、[产品与安全边界](../product-boundaries.md)、[验收矩阵](../testing/acceptance-matrix.md)、相关权威协议/Schema，以及 `docs/handoffs/phase-(N-1).md`。完成后从 [handoff 模板](../handoffs/template.md) 生成该阶段实际交接文档。
