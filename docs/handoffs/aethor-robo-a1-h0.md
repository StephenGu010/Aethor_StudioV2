# Aethor_robo A1-H0 交接：主机协议 codec 软件门

- 状态：`DONE`
- 日期：2026-08-13
- 仓库/分支：`Aethor_StudioV2 / main`
- 开始基线提交：`f574e21f4ad7d806dbed5f2bde956365e8a103a4`
- 最终提交主题：`phase(A1-H0): add Aethor host protocol codec`

## 本阶段目标

在不依赖未完成固件、不注册生产 adapter、不访问串口的边界内，完成 `aethor-arm-ascii-v1` 主机侧 CRC、REQ formatter、wire parser、有界行解码和语言无关向量，并让串口终端复用该事实源。

## 已完成

- `shared/contracts/src/aethorArmAsciiV1.ts` 实现 CRC-16/CCITT-FALSE、15 个 REQ operation 白名单、字段唯一性、uint32 序号、7 类 wire frame 和 512-byte 行解码。
- `services/robot-gateway/.../AethorArmAsciiProtocol.cs` 以独立 C# 实现重算同一向量；没有调用 TypeScript，也没有注册 DI、transport 或后台任务。
- `shared/contracts/conformance/aethor-arm-ascii-v1.vectors.json` 固定 CRC、REQ、有效 frame 和无效 frame 结果；`123456789 → 29B1` 作为算法外部标准锚点。
- 接收解码支持碎包、粘包、LF 与 CRLF；孤立 CR、控制字符、非 ASCII、超长输入和未结束尾帧以有界 preview 丢弃。
- Aethor_robo 终端快捷命令由共享 formatter 生成真实 CRC；手工输入显示具体 CRC/字段错误。`SET_STREAM` 使用正式 `rate_hz` 与 `fields` 字段；没有引入草案不支持的日常 `SET_MODE`。
- CRC/格式结果与 adapter 能力门分层显示；有效帧显示 request/operation，错误帧不再被“adapter pending”提示覆盖。

## 未完成与下一步

- 固件 parser、固件侧 vectors、UART 波特率/吞吐、50 Hz 遥测和错误行为尚无可追溯实现证据；主机 codec 通过不等于固件兼容。
- 没有 pending request registry、HELLO/boot/session 状态机、心跳、重复请求幂等、帧回绕、生产 DI、REST/SignalR 投影或真实串口入口。
- 下一阶段为 A1-H1：取得固件 commit，让固件消费现有向量，再用 fake transport 实现只读会话 adapter；结构化使能、STOP、运动和动作编排继续后置。

## 关键决策

| 决策 | 原因 | 影响 |
|---|---|---|
| 将 A1-H 拆为 H0/H1 | 主机无状态 codec 不依赖固件运行时，可以独立关闭；会话兼容不能猜测 | 软件进度不再被整体阻塞，同时不把主机结果冒充固件证据 |
| TypeScript/C# 独立实现，共享预期结果 | 防止两端调用同一实现形成伪一致 | 固件后续必须消费同一 vectors |
| line decoder 只接受 LF/CRLF | 防止孤立 CR 静默切帧造成解析分歧 | 异常字节明确丢弃并可诊断 |
| 不注册生产 adapter | 当前没有固件身份、会话或行为证据 | Aethor 连接、TX/RX 和所有硬件 capability 保持禁用 |

## 变更范围

- 契约：`shared/contracts/src/aethorArmAsciiV1.ts`、`conformance/aethor-arm-ascii-v1.vectors.json`。
- C# Domain：`AethorArmAsciiProtocol.cs` 及跨语言 conformance 测试。
- 前端：Aethor 终端 formatter/validator、快捷命令和诊断层次。
- 文档：协议、架构、产品边界、Profile、路线图、验收矩阵和当前交接。

## 验证证据

| 检查 | 命令/环境 | 结果 |
|---|---|---|
| 共享契约 | `pnpm --filter @aethor/contracts typecheck && pnpm --filter @aethor/contracts test` | 124/124 |
| 前端组件/领域 | `pnpm --filter @aethor/studio-web test` | 241/241 |
| C# 定向 codec | isolated gateway test + `--filter AethorArmAsciiConformanceTests` | 7/7，0 warning/error |
| C# Gateway 全量 | `pnpm gateway:test` 等价隔离命令 | 129/129，零串口/硬件命令 |
| Desktop 全量 | `pnpm desktop:test` 等价隔离命令 | 118/118，零串口/硬件命令 |
| 实页终端 | in-app browser，1366×768 / 1920×1080 / 2560×1440 | 无根横向溢出、关键元素裁切或 console warning/error；发送 disabled |
| 全仓测试 | `pnpm test` | contracts 124 + frontend 241 + gateway 129 + desktop 118 + legal 6，共 618/618 |
| 完整构建 | `pnpm typecheck && pnpm build` | strict TypeScript；Web 2658 modules；Gateway/Desktop Release 0 warning / 0 error |
| 生产 E2E | `pnpm test:e2e` | 三档视口 63/63；Profile 切换、终端真实 CRC、资源释放、布局与更新后视觉基线通过 |

完整测试、构建和 Playwright 已在提交前复核通过。首次 E2E 暴露旧的 `<CRC16>` 断言与上一阶段未同步的离线控制台截图基线；检查实际图像确认没有布局回归后，同步断言与三档基线并全量复跑 63/63。

## 硬件操作

- 是否枚举或打开串口：否。
- 是否发送查询、状态改变或运动命令：否。
- 本阶段没有连接 COM4，也没有启动 Aethor 生产网关。

## 已知风险与限制

- `921600`、50/100 Hz、心跳 250 ms 和看门狗 1000 ms 仍是协议草案值，必须由固件与 USB-UART 实测。
- 当前 parser 只证明 wire envelope；七轴数值、mask、身份、业务状态和完成语义需在 H1 session/adapter 层二次验证。
- `aethor-robo-pending` Profile ID 和全 false capability 保持不变。

## 下一阶段启动清单

- [ ] 取得可追溯固件 commit、任务所有权和串口协议实现。
- [ ] 在固件 CI/单测中消费 `aethor-arm-ascii-v1.vectors.json`。
- [ ] 补齐重复请求、request ID 回绕、boot/session、业务错误和遥测向量。
- [ ] 复用 `AethorArmAsciiProtocol` 与 `SerialDuplexScheduler`，不要新增页面或 Infrastructure parser。
- [ ] 先完成 fake transport 与资源关闭证据；实机前重新取得现场授权。
