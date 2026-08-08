# 阶段 1 交接

- 状态：`DONE`
- 日期：2026-08-08
- 实施者：Codex
- 仓库/分支：`D:\Aethor_robot\Aethor_StudioV2` / `main`
- 开始基线提交：`89d7bea`
- 最终提交主题：`phase(01): lock dummy protocol contracts`（精确 SHA 由最终响应和 `git log -1` 提供）

## 本阶段目标

把固定 Dummy 固件提交中的 ASCII 事实转为可测试、可审计、可供未来 C# 复用的共享契约；不打开 COM4，不实现真实串口或硬件动作。

## 已完成

- `shared/contracts` 成为独立 workspace，统一拥有 TypeScript wire types、JSON Schema、协议纯函数、状态机、transport port 和 fake。
- 前端删除 `src/contracts/types.ts` 副本，统一依赖 `@aethor/contracts`。
- 公共命令严格收敛为模式 1–3、核心系统/查询命令和 `>` 六轴关节组；排除项在共享 validator、Schema、Profile 和 UI 中均不可构造。
- parser 覆盖固件 ACK、六轴反馈、模式、使能、FIFO 余量/255 哨兵、error、未知行和数值错误。
- line decoder 覆盖随机分片、粘包、CR/LF、空行、非 ASCII、255/256 边界、不完整尾帧和取消，且内存有界。
- 命令状态机将 accepted、completed、failed、timedOut、cancelled、unconfirmed 分开；设备队列与 ACK 不能直接产生 completed。
- 会话状态机要求真实 transport/status evidence，展示数据无法产生 connected/enabled；断线立即清除 motor/mode 权限。
- 新增 `dummy-ascii-v1.vectors.json`，作为 Phase 4 C# adapter 的共同验收输入。

## 关键决策

| 决策 | 原因 | 影响 |
|---|---|---|
| 公共关节组只生成 `>` | 固件中 `>`/`&` 在模式 1–3 代码等价 | 动作编排不保留重复入口；`&` 只作为固件遗留事实 |
| 通用 `ok` 不是完成 | 模式 2 立即 ACK，模式 1/3 去使能也会退出等待 | completed 只能由查询或新鲜反馈确认 |
| `$0...` 仅内部且不等 ACK | 固件成功路径没有 `Respond` | 停止链必须继续 disable/readback，UI/raw 不能构造 `$` |
| JSON Schema 是 wire 权威 | 前端和未来 C# 需要同一跨进程边界 | C# DTO/adapter 必须从 Schema 并复用 vectors |

详细理由见 [ADR-0002](../decisions/0002-dummy-protocol-boundary.md)。

## 变更范围

- 共享契约：`shared/contracts/package.json`、`src/`、`tests/`、`conformance/` 和两个 V1 Schema。
- 前端：共享类型导入、Profile capabilities 校验、终端白名单/只读专家输入及测试。
- Profile：`dummy-6dof/manifest.json` 明确 `stop` 与 `[1,2,3]`。
- 文档：协议、网关、架构、产品边界、ADR、验收矩阵、路线图和变更记录。

## 验证证据

| 检查 | 命令/环境 | 结果 |
|---|---|---|
| 固件基线 | `git -C D:\Aethor_robot\dummy_ref rev-parse HEAD` | `5b9b602d...`，工作区 clean |
| 冻结依赖基线 | `pnpm install` 后锁文件更新 | 3 个 workspace project，Ajv 8.20.0 / ajv-formats 3.0.1 |
| 类型检查 | `pnpm typecheck` | contracts 与 studio-web 通过 |
| 单元/契约测试 | `pnpm test` | contracts 77、studio-web 33，共 110 项通过 |
| 生产构建 | `pnpm build` | 通过；复制 10 项 Dummy Profile 资源 |
| 浏览器验收 | `pnpm test:e2e` | Edge 三档视口 12 项通过 |
| JSON/Schema | Ajv 2020-12 + formats | 所有命名 wire contract 样例通过；排除模式和额外字段被拒绝 |

## 硬件操作

- 未打开 COM4 或其他串口。
- 未发送查询、使能、停止、去使能、回零、复位、模式或运动命令。
- fake transport 只在内存中记录有界字符串，不访问操作系统串口 API。

## 已知风险与限制

- 固件 README 宣称 `$` 成功返回 `ok`，但固定提交代码没有成功响应；当前以代码为准，仍需 Phase 5 监督台架留存原始证据。
- 固件没有可信速度上限、安全回位姿态和统一运动完成事件；`speedDegS` 仍只是契约字段，真实发送门保持关闭。
- 反馈收敛容差、HOME/RESET 完成判据和模式 3 点列行为尚未经实机验证，不得宣传为已完成能力。
- C# 类型生成、真实串口所有权、超时调度和 loopback API 尚未实现，符合 Phase 1 范围。

## 下一阶段启动清单

- [ ] 阅读公共上下文、路线图、本 handoff、ADR-0002 和 Dummy 协议文档。
- [ ] 复现 `pnpm typecheck`、`pnpm test` 和终端白名单 E2E。
- [ ] 优先进入 Phase 2，修正字体、密度、布局比例并增加动作编排空路由；继续保持硬件离线。
- [ ] Phase 4 开始前让 C# 生成 DTO 并复用 conformance vectors，不复制新的命令表。
- [ ] 任何 COM4 操作仍需重新取得用户现场授权。
