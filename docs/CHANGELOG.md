# 变更记录

## 2026-08-08 - 阶段 1：Dummy 协议、契约与安全状态机

需求：
- 以固定 `dummy_ref` 提交为证据，将 Dummy 六轴协议收敛为工业可审计的共享契约，不访问 COM4。

改动：
- 将 `shared/contracts` 建为 `@aethor/contracts` workspace，前端删除重复类型并改为消费共享类型。
- 新增模式 1–3 公共白名单、`>` 六轴 formatter、response parser、255 字符有界行解码、命令/会话纯状态机和有界 fake transport。
- JSON Schema 新增 `unconfirmed`、UTC 结果时间、完整 Profile capabilities、模式 1–3 限制和 `OperationEvent`；Dummy manifest 同步为明确能力数组。
- 新增跨语言 conformance vectors 与 ADR-0002；前端离线校验不再接受 RGB、模式 4/5、标定、PID、reboot、`&`、`@` 或通用 `$`。
- 固化源码差异：运动 FIFO 单项 64 bytes；固件有效行上限实际为 255；`$0...` 成功路径没有 ACK，只能作为未来停止链内部 best-effort 写入。

验证：
- `pnpm typecheck`：共享契约与前端均通过。
- `pnpm test`：共享契约 77 项、前端 33 项通过。
- `pnpm build`：通过，Dummy Profile 10 项资源复制成功。
- `pnpm test:e2e`：Edge 三档视口 12 项通过，离线发送保持禁用，模式 5 显示 INVALID。
- 未打开 COM4，未发送查询、使能、停止或运动命令。

待完善：
- C# DTO 生成和 adapter 对 vectors 的复用在 Phase 4 落地；速度上限、反馈收敛容差、HOME/RESET 完成语义仍待后续监督验收。

新增约定：
- 设备 FIFO 数字或 `ok` 只增加命令 evidence，不直接等于物理完成；终态不能被迟到 ACK 覆盖。

## 2026-08-08 - 阶段 0：工程治理与本地 Git 流程

需求：
- 所有 V2 工程文件只保存在 D 盘权威仓库；建立可交接的系统工程、计划、handoff 和 Git 流程。

改动：
- 新增根 `AGENTS.md`、项目内 `aethor-studio-workflow` skill 和阶段制工程工作流文档。
- 新增 `.gitattributes`、`.editorconfig` 与 `.gitmessage`，统一文本、编辑和提交约定。
- 明确完成阶段自动创建本地 commit，但绝不自动 push；远端推送由用户手动执行。
- 保留规范的 `apps/services/shared/docs` 结构，只借鉴 `Aethor_Studio` 的分层边界，不恢复旧目录。
- 清理阶段 0 迁移留在仓库外的 `node_modules` 备份和 skill 生成临时文件，均移入 Windows 回收站。

验证：
- Git 远端为 `StephenGu010/Aethor_StudioV2.git`，当前分支为 `main`。
- 项目 skill 通过官方 `quick_validate.py`，界面 YAML 可解析。
- Node.js 24.14.0 / pnpm 11.16.0 下 typecheck、23 项单元测试和生产构建通过。
- 指定 `Aether_matlabv3` 参考仓库因网络/公开访问不可用，未臆造其内容。
- 本次只修改工程治理文件和文档，未改产品代码、未打开 COM4、未发送硬件命令。

## 2026-08-08 - Dummy 分阶段路线图与交接体系

需求：
- 完成 Dummy 六轴平台分阶段实施计划，使工程可安全交接并收敛目录结构。

改动：
- 将 `D:\Aethor_robot\Aethor_StudioV2` 确立为权威工作副本；C 盘旧副本仅保留回退。
- 新增阶段 0–8 路线图、逐阶段执行提示词、验收矩阵、handoff 模板与进行中的阶段 0 交接。
- 接受 `apps/services/shared/docs` 目标目录 ADR；实际代码移动和 D 盘测试复验仍属于阶段 0 未完成工作。
- 将首版范围收敛为 `dummy-6dof`、模式 1–3、手动 COM4、显式整组关节下发和版本化动作 JSON。
- 根据指定固件提交补充停止、队列、模式和 ACK 的真实语义。

验证：
- 本次文档整理未打开串口，也未发送查询、使能、停止或运动命令。
- D 盘 TypeScript strict、23 项 Vitest、生产构建和 Edge 三档视口 9 项 Playwright 均通过；目录迁移后的再次复验仍属于阶段 0 退出门槛。

## 2026-08-08 - 阶段 0：目录治理完成

需求：
- 将扁平原型目录迁移为规范的应用、服务与共享资产边界，并提供根级可复现命令。

改动：
- 完成 `apps/studio-web`、`apps/studio-desktop`、`services/robot-gateway`、`shared/contracts`、`shared/robot-profiles` 迁移。
- 新增根 pnpm workspace、统一脚本和唯一锁文件；移除旧路径和子项目 workspace 配置。
- 修正 Vite/Vitest/TypeScript 的 Profile 路径，并同步 README、架构、路线图与阶段 handoff。
- 修正生产构建中 Dummy Profile 的重复目录层级，并新增 URDF/7 个 STL 的公开 URL 回归测试。

验证：
- `pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm test:e2e` 全部通过。
- 23 项单元测试和 Edge 三档视口 12 项 E2E 通过；生产构建复制 10 项 Dummy Profile 资源。
- 旧顶层目录与重复锁文件不存在；未打开 COM4，未发送硬件命令。

踩坑：
- 机械移动后的旧 pnpm junction 仍指向迁移前位置；已将旧生成目录移出仓库并从根锁文件干净安装，源码未受影响。
- 静态复制目标原先重复包含 `dummy-6dof`，页面状态测试未覆盖真实资源 URL；现由生产预览 E2E 直接请求 URDF/STL 防止回归。

新增约定：
- 所有前端命令从仓库根执行；不再接受 `Frontend/Contracts/RobotProfiles/Backend/Desktop` 兼容副本。

## 2026-08-07 - 前端优先平台骨架

需求：
- 建立展示级 Windows 机械臂调试平台，先完成四个前端工作区并预留 C#/WebView2 边界。

改动：
- 新增 React/Vite 工程、版本化契约、Dummy 受管 Profile、架构与协议文档。
- 明确静态展示数据与真实设备状态隔离。
- 实现数字孪生、数据示波、串口终端、设备与模型四个工作区，并按工作区拆分 Three.js 与 ECharts 资源。
- 将 `URDFDummy4.urdf` 与 7 个 STL 规范化为 `dummy.urdf`、`base_link/link_1…6`、`joint_1…6` 和小写 mesh 路径。
- 增加 `.aethor-robot` 前端校验、共享 JSON Schema、只读 `StaticShowcaseSource` 与不可用 `DesktopBridgeV1`。

验证：
- `node node_modules/typescript/bin/tsc -b --pretty false`：通过。
- `node node_modules/vitest/vitest.mjs run`：7 个测试文件、23 项测试通过。
- `node node_modules/@playwright/test/cli.js test`：Edge 下 3 个视口、9 项 E2E 通过。
- `node node_modules/vite/bin/vite.js build`：通过；发布包包含 `dummy.urdf` 与 7 个 STL。
- 内置浏览器逐页检查四个路由；Dummy URDF 显示 `URDF READY`，中文、图表和离线安全状态正常。

踩坑：
- Safety First 与 `dummy_ref` 对 RGB 协议描述冲突；V2 固定以指定 `dummy_ref` 提交为准。
- 原 URDF 第四关节为 `Join4` 且 velocity/effort 为零，迁移时只修正名称，不推断动态上限。

待完善：
- C# 串口服务、SignalR 实时通道、WebView2 原生桥接和第二台机械臂 Profile。

新增约定：
- 展示数据不得生成任何真实连接、使能、命令接受或急停成功状态。
