# Aethor Studio V2 文档中心

本目录是 `dummy-6dof` 六轴机械臂与 `aethor-robo-dual-7dof` 空间机器人双七轴机械臂的工程事实源。文档只描述已验证事实、已锁定决策和明确规划，不把未来能力写成已实现能力。

## 阅读顺序

1. [系统工程说明](系统工程说明.md)：目录、技术栈、Profile 切换、网关、通信、状态所有权和扩展方式的完整导读。
2. [阶段制工程与 Git 工作流](engineering-workflow.md)：计划、实施、验证、handoff、阶段提交和受控远端 push 的统一流程。
3. [阶段路线图](roadmap.md)：Dummy 阶段 0–8 与 Aethor_robo 并行接入阶段的目标、交付物和验收门槛。
4. [产品与安全边界](product-boundaries.md)：首版范围、硬件动作约束和明确排除项。
5. [系统架构](architecture.md)：当前结构、目标结构、依赖方向和状态所有权。
6. [Dummy ASCII v1](protocols/dummy-ascii-v1.md)：固件协议证据、允许命令和响应语义。
7. [验收矩阵](testing/acceptance-matrix.md)：自动化、模拟串口和实机监督验收。
8. [Phase 4 监督只读 COM4 验收](runbooks/phase-04-supervised-readonly-com4.md)：不可连接预检、现场授权、唯一连接动作、证据与清理步骤。
9. [Phase 5 监督式 COM4 控制验收](runbooks/phase-05-supervised-control-com4.md)：状态控制门、独立运动门、四参数运动包络、失败处置和清理步骤；Gate A 已验证，Gate B 被阻止。
10. [Phase 7B Dummy 只读长测采证](runbooks/phase-07b-readonly-soak.md)：显式现场授权、只读白名单、资源/协议采样、失败关闭和最终释放。
11. [ActionProgram V1](../shared/contracts/action-program-v1.md)：离线动作文档、来源、保存与版本兼容边界。
12. [阶段提示词](prompts/README.md)：可直接交给下一位工程师或 Codex 的执行任务。
13. [交接模板](handoffs/template.md)：每阶段结束时记录真实结果、证据和剩余风险。
14. [Phase 6 交接](handoffs/phase-06.md)：已验证的 6A 离线编辑器、6B-S 无生产接线执行内核，以及仍锁定的 6B-H 实机入口。
15. [当前交接：Phase 7](handoffs/phase-07.md)：已验证的 7A 有界观测软件门、已就绪但尚未执行的 7B 只读采证工具。
16. [当前交接：Phase 8](handoffs/phase-08.md)：已验证的 8A Windows 桌面软件门、仍待完成的 8B 正式发布门。
17. [Phase 8 桌面 smoke](runbooks/phase-08-desktop-smoke.md)：便携包、WebView2、loopback 网关、DPI 与受控恢复验证。
18. [ADR-0008 Windows 安装与数据保留](decisions/0008-windows-installer-and-user-data.md)：MSI、Major Upgrade、默认数据保留、签名与工具治理边界。
19. [Aethor_robo 双七轴档案与进度](profiles/aethor-robo.md)：来源、规范化映射、能力边界和并行阶段状态。
20. [Aethor_robo 当前交接](handoffs/aethor-robo.md)：下一位工程师继续模型、协议和硬件接入时的入口与禁区。
21. [ADR-0009 Engineering 直连调试边界](decisions/0009-engineering-direct-debug-boundary.md)：开发环境受限 ASCII 调试、错误端口释放和 queued 语义。
22. [Dummy Engineering 直连手册](runbooks/dummy-engineering-direct.md)：本机网关启动、连接、使能、关节组发送、停止与退出流程。
23. [Aethor Arm ASCII v1 候选协议](protocols/aethor-arm-ascii-v1.md)：七轴 ID 映射、发现态、帧、并发、停止与动作编排契约；当前没有真实 adapter。
24. [Aethor_robo A1-U0 交接](handoffs/aethor-robo.md)：已完成的软件契约/模型诊断与仍被固件阻塞的真实网关边界。
25. [ADR-0010 有界串口双工运行时](decisions/0010-bounded-serial-duplex-runtime.md)：唯一持续 reader、P0–P3 有界 writer、背压、关闭与生产迁移边界。
26. [Aethor_robo A1-U1 交接](handoffs/aethor-robo-a1-u1.md)：已完成的调度软件门、双 Profile 终端入口，以及尚未接线的生产运行时。
27. [Aethor_robo A1-U2 交接](handoffs/aethor-robo-a1-u2.md)：Dummy 生产双工迁移、连续终端发送和仍未实现的 Aethor adapter。
28. [Aethor_robo A1-T0 交接](handoffs/aethor-robo-a1-t0.md)：双臂高频遥测合并、原子模型提交、逐关节显示新鲜度和 adapter 接缝。
29. [Aethor_robo A1-H0 交接](handoffs/aethor-robo-a1-h0.md)：主机侧 TypeScript/C# codec、跨语言 CRC/帧向量和仍禁用的终端发送边界。

## 状态约定

- `DONE`：交付物已落盘并通过列出的验收。
- `IN PROGRESS`：正在实施，不能视为可交付完成。
- `NOT STARTED`：仅有规划，尚未实现。
- `BLOCKED`：已记录外部阻塞与恢复条件。

当前状态以 [阶段路线图](roadmap.md) 为准。Aethor_robo A0 模型接入与双七轴本地控制台、A1-U0 候选契约与 ID 诊断、A1-U1/U2 双工基础、A1-T0 数字孪生实时内核和 A1-H0 主机协议 codec 均已完成；A1 总体仍等待 Aethor 固件实现、固件侧向量和只读会话 adapter。Dummy Phase 4 已完成监督只读 COM4 验收；Phase 6B-S 无生产接线执行内核已验证，但 Phase 5 Gate B 与 Phase 6B-H 仍被运动包络和独立授权阻止。Phase 7A 有界观测软件门和 Phase 8A 桌面软件门已验证，但 7B 实机长测与 8B 正式发布门未完成，因此 Dummy Phase 5–8 均保持 `IN PROGRESS`。协议只在 `protocols/` 维护；接口 Schema 只在 `shared/contracts/` 维护，阶段提示词不复制这些定义。
