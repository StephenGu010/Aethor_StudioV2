# 阶段 0 交接

- 状态：`DONE`
- 日期：2026-08-08
- 仓库：`D:\Aethor_robot\Aethor_StudioV2`
- 分支：`main`
- 基线提交：`412682c`（前端、共享契约、模型与阶段 0 目录治理）
- 工程治理提交：`phase(00): establish repository workflow`（精确 SHA 由 `git log -1` 提供）

## 本阶段目标

在不改变产品行为、不访问硬件的前提下，将 D 盘仓库整理为单一、可复现的应用/服务/共享资产结构。

## 已完成

- `Frontend → apps/studio-web`
- `Desktop → apps/studio-desktop`
- `Backend → services/robot-gateway`
- `Contracts → shared/contracts`
- `RobotProfiles → shared/robot-profiles`
- 新增根 `package.json`、`pnpm-workspace.yaml` 和唯一 `pnpm-lock.yaml`，根脚本统一转发到 `@aethor/studio-web`。
- Vite、Vitest、TypeScript 已统一读取 `shared/robot-profiles/BuiltIn`；构建仍复制 Dummy URDF 与 7 个 STL。
- `.gitignore` 改为与目录无关的生成物规则；旧顶层目录和重复锁文件均不存在。
- README、架构、契约入口、路线图与 CHANGELOG 已同步到新路径。
- 新增项目内阶段工作流 skill、单一工作区约束、Git 文本规则、提交模板和“本地提交、人工 push”约定。
- 已核实并将阶段 0 迁移遗留在仓库外的依赖备份移入 Windows 回收站；项目源码和权威资产未受影响。

## 关键决策

| 决策 | 原因 | 影响 |
|---|---|---|
| 根目录拥有 workspace、脚本和锁文件 | 保持开发入口唯一 | 后续所有命令从仓库根执行 |
| 不保留旧目录兼容副本 | 防止资源和契约双重事实源 | 外部脚本如仍引用旧路径必须显式迁移 |
| 阶段 0 不新增功能 | 降低结构迁移的回归范围 | UI、Schema 和硬件能力保持原样 |

## 验证证据

| 检查 | 命令 | 结果 |
|---|---|---|
| 冻结安装 | `pnpm install --frozen-lockfile` | 通过，2 个 workspace project、202 个 package |
| 类型检查 | `pnpm typecheck` | 通过，严格 TypeScript |
| 单元测试 | `pnpm test` | 7 个文件、23 项通过 |
| 生产构建 | `pnpm build` | 通过，复制 10 项 Profile 资源 |
| E2E | `pnpm test:e2e` | Edge 三档视口共 12 项通过 |
| 路径治理 | 旧目录、重复锁文件、有效旧路径扫描 | 通过 |
| 文档 | Markdown 相对链接与编码扫描 | 通过 |
| 页面复验 | 本地生产构建 `/twin` | `URDF LOADED/READY`，控制台无 error |
| 项目 skill | `quick_validate.py .codex/skills/aethor-studio-workflow` | 通过；`openai.yaml` 可解析 |
| Git 治理 | 本地 config、remote、diff 与 staged 检查 | `origin` 指向 V2；自动 push 未配置 |

E2E 覆盖 1366×768、1920×1080、2560×1440；检查四个主要路由的离线安全状态、目标/反馈隔离、终端离线校验，以及规范 URL 下的 Dummy URDF 与全部 7 个 STL。

## 硬件操作

- 未打开 COM4。
- 未发送查询、使能、停止、回零、复位、模式或运动命令。
- 当前仍只有 `StaticShowcaseSource`，不存在真实 C# 网关。

## 已知限制

- 当前开发 shell 需要 Node.js 24.15+ 位于 PATH；本次验证使用 Codex 提供的 Node 24 运行时。
- `apps/studio-desktop` 与 `services/robot-gateway` 仍只有边界说明，符合阶段 0 范围。
- 指定的 `Aether_matlabv3` GitHub 参考仓库在本次治理时无法通过网络/公开页面读取；未据此臆造流程细节，后续获得访问权限后再做差异审计。
- C 盘旧工作副本已核对为无更新的迁移前副本，但当前 Codex 任务仍持有该目录句柄，Windows 拒绝将其移入回收站；关闭本任务并从 D 盘仓库重新打开后再回收 `C:\Users\59436\Documents\Aethor_studioV2`。在此之前它不是事实源，也不得再写入。

## 下一阶段启动清单

- [ ] 阅读 `docs/prompts/00-common-context.md` 和 `docs/prompts/phase-01-protocol-and-contracts.md`。
- [ ] 复现 `pnpm typecheck` 与 `pnpm test`。
- [ ] 以固定 `dummy_ref` 提交核对 parser/formatter 和命令状态机。
- [ ] 阶段 1 继续禁止打开 COM4。
- [ ] 检查阶段 0 本地提交与干净工作区；由用户决定何时 push。
- [ ] 从 D 盘重新打开任务后回收被当前应用占用的 C 盘旧工作副本。
