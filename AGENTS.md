# Aethor Studio V2 工程约定

本文件作用于整个仓库。

- 唯一权威工作区是 `D:\Aethor_robot\Aethor_StudioV2`。项目源码、配置、文档、模型和工程自动化不得写到该目录之外。
- 开始规划、实施、验收、交接或提交任一阶段前，必须完整读取 `.codex/skills/aethor-studio-workflow/SKILL.md` 并遵循其中流程。
- 以 `docs/product-boundaries.md`、`docs/architecture.md`、`docs/protocols/`、`shared/contracts/` 和 `docs/roadmap.md` 为事实源；参考工程不能覆盖 V2 已锁定的边界。
- 所有开发与验证命令从仓库根执行。保持 `apps/`、`services/`、`shared/`、`docs/` 的依赖方向，不恢复旧顶层目录。
- 每个完成的阶段必须同步路线图、变更记录和 handoff，通过该阶段验收后创建本地 Git 提交，并在刷新远端、确认没有领先或分叉后普通 push 到 `origin` 对应分支。禁止 force-push；`IN PROGRESS`、`BLOCKED` 或 checkpoint 不得冒充阶段交付推送。
- 不提交 `node_modules`、构建产物、日志、测试报告、临时文件、凭据或本机配置。
- 除非阶段文档明确授权且用户正在现场监督，不得打开 COM4 或发送任何硬件指令。
