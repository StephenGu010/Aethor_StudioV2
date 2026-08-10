# 阶段 0 提示词：基线与目录治理

先阅读 `00-common-context.md` 与路线图。目标是在不改变产品行为的前提下，把 D 盘仓库整理为单一、可复现的规范结构。

## 任务

1. 记录迁移前 Git 状态、工具链版本和前端 typecheck/unit/build/E2E 基线；依赖缺失时按锁文件安装。
2. 将 `Frontend → apps/studio-web`、`Desktop → apps/studio-desktop`、`Backend → services/robot-gateway`、`Contracts → shared/contracts`、`RobotProfiles → shared/robot-profiles`。
3. 建立根级 pnpm workspace 和统一脚本，但不引入没有消费者的工具或多余包装层。
4. 修正 Vite、TypeScript、测试、URDF/mesh 复制和所有文档链接。删除旧目录，禁止双份资源。
5. 保留 D 盘现有 `.git`；不要修改或删除 C 盘旧副本；不要访问 COM4。
6. 更新根 README、架构 ADR、CHANGELOG 和本阶段 handoff。

## 验收

- `rg` 检查不存在指向旧顶层目录的有效配置/文档链接（历史记录除外）。
- strict typecheck、全部单元测试、生产构建通过。
- Playwright 覆盖控制台、示波、终端、设备与模型，并至少在 1366×768、1920×1080、2560×1440 检查无浏览器控制台错误。
- Git 不包含 `node_modules/dist/test-results/playwright-report/coverage`。

只有全部通过才把路线图阶段 0 标为 `DONE`，并生成 `docs/handoffs/phase-00.md`；否则保持 `IN PROGRESS` 并准确记录阻塞。
