# Aethor_robo 当前交接

## 阶段状态

| 项 | 值 |
|---|---|
| Track | A1-T0 Aethor_robo 数字孪生实时内核 |
| 状态 | `DONE` |
| A1 总体 | `IN PROGRESS`；A1-H 固件/跨语言 adapter 为 `BLOCKED` |
| 日期 | 2026-08-13 |
| 起始提交 | `7003510eb08fe9ae236125e340111217e6880ceb` |
| 上一阶段提交 | `91fd9e9 phase(A1-U0): add Aethor motor discovery contract` |
| 当前阶段交接 | [aethor-robo-a1-u2.md](aethor-robo-a1-u2.md) |
| 硬件访问 | 无；未枚举或打开 COM4，未发送任何硬件命令 |

## 本阶段完成内容

- 新增 `AethorArmMotorFrameV1` TypeScript 类型和独立 JSON Schema。帧固定 Profile、左右臂、controller/arm/boot/sequence 身份，最多保留 32 个无序、部分、重复或范围外样本供领域诊断。
- 新增纯领域 motor reducer：`ID 1…7 → J1…J7`，与帧顺序/接线顺序无关；同一 boot 下倒序或重复 sequence 不覆盖新状态，新 boot 重新建立序列基准。
- 重复 ID 隔离为 `conflict` 且不应用数值；ID >7 只进入 `unexpectedMotorIds`；完整快照明确标记缺失，增量快照保留既有轴状态。左右臂帧合并到 14 轴实体姿态，不会覆盖目标草稿。
- 控制台按臂显示已观测电机数量以及 `OBSERVED/MISSING/STALE/ID CONFLICT`，并显示重复/范围外 ID。默认没有帧时仍为 `LOCAL PREVIEW / NO DATA`。
- 串联机械臂从第一个不确定关节起到末端使用独立灰色实体材质，清理时恢复原材质；目标幽灵模型不受影响。材质纳入 Three.js 资源计数，没有改变默认 29 geometry / 22 material 基线。
- 新增候选协议 `docs/protocols/aethor-arm-ascii-v1.md`，记录电机发现 mask、请求关联、遥测、停止、动作编排和未来持续 RX + 有界优先级 TX 的串口所有权设计。
- A1-U2 已将该运行时接入 Dummy 生产网关：唯一 reader/decoder、优先级 writer、结构化 response fence 和无回复 direct 队列共同运行；`/terminal` 可连续发送并按 request ID 展示 queued/sent/失败类结果。Aethor 分支仍只做候选模板校验，发送固定禁用。完整证据见独立 A1-U2 交接。
- A1-T0 已在未来 adapter 接缝之后增加每臂最新帧优先、20 ms 双臂原子提交和逐关节 250 ms 显示新鲜度；控制台展示入口/模型 Hz、合并与拒绝计数。Aethor 生产 adapter 和真实串口仍未实现。
- 更新路线图、架构、产品边界、Profile、契约索引、验收矩阵、变更记录和 A1-H 执行提示词。外部固件 PRD 已同步到 0.3.0-draft，但不属于本 Git 仓库。

## 当前没有实现

- Profile adapter 仍为 `aethor-robo-pending`，硬件 capability 全部为 false。
- 没有 Aethor C# codec、pending request registry、REST/SignalR 投影或真实串口入口。共用持续 RX/优先 TX 调度器已在 Dummy 生产路径验证，但不能算作 Aethor adapter。
- 控制台的 `ingestAethorTwinMotorFrame` 是经过测试的 adapter 接缝；生产运行时仍没有调用者，不能解释为已获得实机反馈。
- 读取、使能、停止、七轴组下发和 Aethor 动作执行仍禁用。MIT/POS_VEL、真实限位/速度、同步到达和梯度速度尚无实机证据。
- 串口终端外壳已支持 Aethor 候选校验；真实 TX/RX、连接和设备状态仍只属于 Dummy runtime。Dummy 已迁移到新双工调度器，Aethor 不得复用 Dummy codec。

## 验证证据

- `pnpm typecheck`：共享契约与严格前端 TypeScript 通过。
- `pnpm test`：contracts 98 + frontend 225 + gateway 113 + desktop 118 + legal inventory 6，共 560/560 通过；A1-U1 双工调度器 10/10。
- `pnpm build`：Profile provenance 通过；Web 2653 modules；Gateway/Desktop Release 均 0 warning / 0 error。
- Playwright：1366×768、1920×1080、2560×1440 共 63/63 通过；关键操作区可见、禁用原因可聚焦、根页面无溢出、视觉基线已逐档审阅。
- 构建/测试 wrapper 明确报告 `serialPortOpened=false / hardwareCommandSent=false`。

## 已知风险

- Schema 允许异常 ID 是为了保留诊断证据，不表示这些 ID 可控制；未来 C# adapter 必须重复执行领域校验。
- 完全相同 CAN ID 的两个驱动未必能可靠计数，只能报告身份冲突候选，不能声称知道重复设备数量。
- 当前实体链灰显使用“首个不确定关节及其后全部 link”的保守投影；需在真实 URDF/CAN 反馈联调时确认每个关节的 link 归属仍与 Profile 一致。
- 候选 `921600 baud`、50 Hz 遥测、CRC 字段和错误码尚未由固件与跨语言 vectors 冻结。
- Aethor_robo 来源包仍缺完整 BSD 条款，公开分发限制不变。

## 下一步：A1-H

1. 取得可追溯的 Keil/CubeMX/FreeRTOS 固件 commit，并按 `docs/prompts/aethor-robo-a1-h-firmware-adapter.md` 复核任务所有权。
2. 在固件与仓库间冻结 CRC/parser/formatter/error/回绕/幂等测试向量；不得从 Dummy 协议补推。
3. 复用已在 Dummy 生产路径验证的双工调度基础设施，实现独立 C# Aethor codec 与 pending request registry；不得把 Dummy codec 当成生产 adapter。
4. 先以 fake transport 验证部分/乱序/冲突/范围外 ID、终端公平性、心跳和进程退出，再设计只读监督实机 runbook。
5. 未取得新的现场授权前，不打开 COM4、不使能、不发送运动或停止命令。A1-H 未关闭前，A1 不得标记 DONE。
