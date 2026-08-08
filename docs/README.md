# Aethor Studio V2 文档中心

本目录是 `dummy-6dof` 首版的工程事实源。文档只描述已验证事实、已锁定决策和明确规划，不把未来能力写成已实现能力。

## 阅读顺序

1. [阶段制工程与 Git 工作流](engineering-workflow.md)：计划、实施、验证、handoff、本地提交和人工 push 的统一流程。
2. [阶段路线图](roadmap.md)：阶段 0–8 的目标、交付物和验收门槛。
3. [产品与安全边界](product-boundaries.md)：首版范围、硬件动作约束和明确排除项。
4. [系统架构](architecture.md)：当前结构、目标结构、依赖方向和状态所有权。
5. [Dummy ASCII v1](protocols/dummy-ascii-v1.md)：固件协议证据、允许命令和响应语义。
6. [验收矩阵](testing/acceptance-matrix.md)：自动化、模拟串口和实机监督验收。
7. [Phase 4 监督只读 COM4 验收](runbooks/phase-04-supervised-readonly-com4.md)：不可连接预检、现场授权、唯一连接动作、证据与清理步骤。
8. [阶段提示词](prompts/README.md)：可直接交给下一位工程师或 Codex 的执行任务。
9. [交接模板](handoffs/TEMPLATE.md)：每阶段结束时记录真实结果、证据和剩余风险。
10. [当前交接：Phase 4](handoffs/phase-04.md)：只读 C# 网关的软件证据、未打开 COM4 的安全事实和现场监督恢复入口。

## 状态约定

- `DONE`：交付物已落盘并通过列出的验收。
- `IN PROGRESS`：正在实施，不能视为可交付完成。
- `NOT STARTED`：仅有规划，尚未实现。
- `BLOCKED`：已记录外部阻塞与恢复条件。

当前状态以 [阶段路线图](roadmap.md) 为准。Phase 4 仍为 `IN PROGRESS`：软件门已落盘，真实 COM4 只读验收未执行。协议只在 `protocols/` 维护；接口 Schema 只在 `shared/contracts/` 维护，阶段提示词不复制这些定义。
