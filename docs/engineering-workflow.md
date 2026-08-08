# 阶段制工程与 Git 工作流

本文件定义 Aethor Studio V2 的系统工程、计划、验证、handoff 和本地 Git 提交流程。产品事实仍由对应协议、Schema、架构和安全边界文档维护，本文不复制其定义。

## 事实源与参考边界

按以下顺序处理冲突：

1. `docs/product-boundaries.md`：产品与实机安全边界。
2. `docs/protocols/` 和 `shared/contracts/`：协议证据与机器可验证接口。
3. `docs/architecture.md` 和 `docs/decisions/`：所有权、依赖方向与已接受决策。
4. `docs/roadmap.md`、当前阶段提示词、上一阶段 handoff：阶段范围和真实进度。
5. 参考工程：只提供可验证的结构或工作方式，不覆盖以上事实源。

`D:\Aethor_robot\Aethor_Studio` 只读参考其 React 前端、Domain/Application/Infrastructure/API 后端分层和桌面启动边界，不迁移 MATLAB、Simscape 或旧产品状态。`StephenGu010/Aether_matlabv3` 只在能够读取真实内容后参考其流程；网络或权限不可用时必须明确记录，禁止凭仓库名称推断。

## 单一工作区

- 唯一项目根目录：`D:\Aethor_robot\Aethor_StudioV2`。
- 项目拥有的源码、文档、模型、配置、测试和自动化只写入该目录。
- 依赖缓存和构建产物必须可重新生成并保持忽略；不得把它们作为交付物搬到仓库外保存。
- 所有命令从项目根执行，路径以仓库相对路径写入文档和配置。

## 阶段生命周期

| 步骤 | 必须完成的动作 | 产出 |
|---|---|---|
| 1. 接入 | 检查 `git status`；阅读 `AGENTS.md`、路线图、公共上下文、上一 handoff、当前提示词和相关事实源 | 已确认的范围、基线提交和风险 |
| 2. 计划 | 将需求拆为可验证任务；标明不做项、外部依赖、硬件权限和退出门槛 | 当前执行计划 |
| 3. 实施 | 按“契约/所有权 → 实现 → UI/集成”的方向工作；保护用户已有改动 | 最小完整变更 |
| 4. 验证 | 先运行受影响的窄测试，再运行阶段门槛；涉及实机时严格执行监督 runbook | 可复现命令与结果 |
| 5. 同步 | 更新权威文档、`docs/CHANGELOG.md`、路线图状态和本阶段 handoff | 与代码一致的工程事实 |
| 6. 本地提交 | 审查 diff、精确暂存、检查 staged diff，创建一个清晰的阶段提交 | 本地 commit SHA |
| 7. 交接 | 报告结果、验证、风险、下一入口和本地 SHA；保持工作区干净 | 可独立继续工作的 handoff |

退出门槛未全部通过时不得标记 `DONE`。阻塞时记录已验证事实、未完成项和恢复条件，不用计划能力冒充已实现能力。

## 系统工程检查

每项跨层变更都要形成最短可追踪链：

```text
需求/风险 → 权威契约 → 状态或资源所有者 → 实现边界 → 测试证据 → handoff
```

- 在修改 UI 前确认状态来源和失败状态；静态展示源永不提升为真实连接或命令成功。
- 在修改协议前核对固定固件证据；未知 ACK、速度、安全位姿或运动完成语义保持未知。
- 在引入资源前定义创建、取消、断线、卸载和释放责任。
- 在改变公共命令、Schema、目录、启动方式或安全语义时同步最小权威文档。
- COM4 和真实运动必须由对应阶段授权，并在 handoff 记录端口、时间、原始命令、回包和现场条件。

## Git 规则

- 远端 `origin` 仅用于用户手动 fetch/pull/push；自动流程绝不执行 push、force-push 或创建远端分支。
- 默认尊重当前分支。需要隔离工作时使用 `codex/phase-NN-short-name`，但不为了单次文档修订无意义切分支。
- 阶段提交格式：`phase(NN): <已验证的结果>`，例如 `phase(01): lock dummy protocol contracts`。
- 一个阶段可以有必要的中间提交，但只有退出门槛通过、文档同步完成的提交才能称为阶段完成提交。
- 暂存前运行 `git status --short` 和 `git diff`；只暂存本阶段文件，再运行 `git diff --cached --check` 和 `git diff --cached --stat`。
- 禁止提交生成物、依赖、秘密、本机端口偏好和无关用户改动。提交失败时修复原因，不绕过检查。
- “自动 Git”只表示完成阶段时自动创建本地提交并报告 SHA；远端推送始终由用户执行。

推荐的本地收口顺序：

```powershell
git status --short
pnpm typecheck
pnpm test
pnpm build
# 按阶段补充 E2E、后端或实机验收
git add -- <本阶段文件>
git diff --cached --check
git diff --cached --stat
git commit -m "phase(NN): concise verified outcome"
git status --short --branch
```

## Handoff 最小内容

每阶段使用 `docs/handoffs/template.md`，至少记录：状态、日期、实施者、分支、开始基线、最终提交主题、目标与排除项、真实完成项、变更路径、验证证据、硬件操作、风险和下一阶段启动清单。

handoff 与阶段实现放在同一完成提交中，因此不在文件内写入该提交自身的 SHA；最终响应和 `git log -1` 提供精确 SHA。下一位实施者必须先复现关键检查，再开始新功能。
