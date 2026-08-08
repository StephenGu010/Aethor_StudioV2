# ADR-0001：按应用、服务与共享资产划分仓库

- 状态：Accepted
- 日期：2026-08-08

## 背景

当前 `Frontend/Contracts/RobotProfiles/Backend/Desktop` 扁平目录可以支撑原型，但在加入 C# 服务、WebView2 和多机器人 Profile 后，所有权与依赖方向不够明确。

## 决策

阶段 0 将仓库统一为 `apps/`、`services/`、`shared/`、`docs/` 四个顶层边界：

- `apps/studio-web`：浏览器可运行的产品前端。
- `apps/studio-desktop`：Windows WebView2 宿主。
- `services/robot-gateway`：独占硬件和命令状态的 C# 服务。
- `shared/contracts`：跨进程 DTO、JSON Schema 与生成规则。
- `shared/robot-profiles`：内置和受管机器人资源。
- `docs`：决策、协议、路线图、验收证据和交接。

根目录只保留仓库级配置、统一脚本、锁文件、许可证和入口 README。

## 约束

- 完成迁移前先记录基线；移动后同一提交内修复引用并通过测试。
- 不保留兼容性复制目录或双份资源。
- 前端不得反向成为协议真相源；串口实现不得进入 UI 包。
- 阶段文档不能复制 Schema 或固件命令表，只链接权威文件。

## 后果

优点是目录所有权和发布单元清晰，第二种机器人可作为 Profile/adapter 增量加入。代价是阶段 0 会产生一次路径变化，所有开发命令和 CI 必须同步更新。

## 回滚

迁移前的 C 盘副本保留作只读回退。若阶段 0 验证失败，只回退该阶段的目录迁移；不得通过长期保留新旧目录规避修复。

