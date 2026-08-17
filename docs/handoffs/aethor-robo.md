# Aethor_robo 当前交接

## 阶段状态

| 项 | 值 |
|---|---|
| Track | A1-H1-S Aethor_robo 主机会话软件核心 |
| 状态 | `DONE` |
| A1 总体 | `IN PROGRESS`；A1-H1-S `DONE`，A1-H1-F 固件/只读生产 adapter 为 `BLOCKED` |
| 日期 | 2026-08-13 |
| 起始提交 | `7003510eb08fe9ae236125e340111217e6880ceb` |
| 上一阶段提交 | `f574e21 phase(A1-T0): add Aethor twin realtime core` |
| 当前阶段交接 | [aethor-robo-a1-h1-s.md](aethor-robo-a1-h1-s.md) |
| 最新模型修订 | [aethor-robo-a0-r1.md](aethor-robo-a0-r1.md)：17 links / 16 joints / 17 STL，14 关节映射不变，独立动量轮链路已移除 |
| 硬件访问 | 无；未枚举或打开 COM4，未发送任何硬件命令 |

## 2026-08-17 外部固件与 PRD 同步

- 外部固件仓库为 [StephenGu010/Aethor_robo_fw](https://github.com/StephenGu010/Aethor_robo_fw)，检查基线为 `db0818b15eb3c2bc7cdde5b34a548c6e69f47a9f`。
- 本次只读取该提交的 Git 对象。固件本地工作区已有大量未提交重构，未被修改、暂存、提交或推送。
- 该提交的正式 Type-C USB CDC 协议是 `aethor-text-v1`，采用可打印 ASCII、LF/CRLF 和可选十进制请求编号，不使用应用层 CRC。`aethor-arm-ascii-v1` 只作为迁移前兼容性回归资产。
- 用户提供的 18 份固件 PRD/阶段 handoff 已作为非权威参考快照收录到 [固件 PRD 导入说明](../references/aethor-robo-firmware-prd/IMPORT-MANIFEST.md)。快照不能覆盖当前 Studio 协议、契约和路线图。
- Studio 现有 H0/H1-S 仍实现 `aethor-arm-ascii-v1`，因此当前并不兼容该固件正式入口。Profile adapter 和硬件 capability 保持不变。

## 本阶段完成内容

- 新增 `AethorArmMotorFrameV1` TypeScript 类型和独立 JSON Schema。帧固定 Profile、左右臂、controller/arm/boot/sequence 身份，最多保留 32 个无序、部分、重复或范围外样本供领域诊断。
- 新增纯领域 motor reducer：`ID 1…7 → J1…J7`，与帧顺序/接线顺序无关；同一 boot 下倒序或重复 sequence 不覆盖新状态，新 boot 重新建立序列基准。
- 重复 ID 隔离为 `conflict` 且不应用数值；ID >7 只进入 `unexpectedMotorIds`；完整快照明确标记缺失，增量快照保留既有轴状态。左右臂帧合并到 14 轴实体姿态，不会覆盖目标草稿。
- 控制台按臂显示已观测电机数量以及 `OBSERVED/MISSING/STALE/ID CONFLICT`，并显示重复/范围外 ID。默认没有帧时仍为 `LOCAL PREVIEW / NO DATA`。
- 串联机械臂从第一个不确定关节起到末端使用独立灰色实体材质，清理时恢复原材质；目标幽灵模型不受影响。A0-R1 模型替换后的资源基线为 23 geometry / 22 material。
- 新增候选协议 `docs/protocols/aethor-arm-ascii-v1.md`，记录电机发现 mask、请求关联、遥测、停止、动作编排和未来持续 RX + 有界优先级 TX 的串口所有权设计。
- A1-U2 已将该运行时接入 Dummy 生产网关：唯一 reader/decoder、优先级 writer、结构化 response fence 和无回复 direct 队列共同运行；`/terminal` 可连续发送并按 request ID 展示 queued/sent/失败类结果。Aethor 分支仍只做候选模板校验，发送固定禁用。完整证据见独立 A1-U2 交接。
- A1-T0 已在未来 adapter 接缝之后增加每臂最新帧优先、20 ms 双臂原子提交和逐关节 250 ms 显示新鲜度；控制台展示入口/模型 Hz、合并与拒绝计数。Aethor 生产 adapter 和真实串口仍未实现。
- A1-H0 已新增共享 TypeScript 与独立 C# 无状态 codec，共同消费语言无关 CRC/REQ/frame/invalid 向量；终端快捷命令生成真实 CRC，手工输入显示具体 CRC/字段错误，发送继续禁用。
- A1-H1-S 已新增未注册生产 DI 的 C# 会话核心：严格递增 request ID 并发关联、HELLO/boot/session 身份、GET_JPOS/TEL 同一 ID/mask 投影、latest-only 下游投递、超时/孤立响应/重启探针和唯一资源释放均通过 fake transport。
- 更新路线图、架构、产品边界、Profile、契约索引、验收矩阵、变更记录和 A1-H 执行提示词。外部固件 PRD 已同步到 0.3.0-draft，但不属于本 Git 仓库。
- A0-R1 已换入 `Aethor_Layout_deployed/`：Profile 为 17 links / 16 joints / 17 STL，保持 14 关节映射，排除六个独立动量轮 link/joint/mesh；详见独立模型交接。

## 当前没有实现

- Profile adapter 仍为 `aethor-robo-pending`，硬件 capability 全部为 false。
- 已有未注册生产 DI 的 Aethor pending request/session core，但没有启动协调器、心跳、REST/SignalR 投影或真实串口入口。无状态 codec、会话 core 与共用双工调度基础设施都不能单独算作生产 adapter。
- 控制台的 `ingestAethorTwinMotorFrame` 是经过测试的 adapter 接缝；生产运行时仍没有调用者，不能解释为已获得实机反馈。
- 读取、使能、停止、七轴组下发和 Aethor 动作执行仍禁用。MIT/POS_VEL、真实限位/速度、同步到达和梯度速度尚无实机证据。
- 串口终端外壳已支持 Aethor CRC/帧本地校验；真实 TX/RX、连接和设备状态仍只属于 Dummy runtime。Dummy 已迁移到新双工调度器，Aethor 不得复用 Dummy codec。

## 验证证据

- `pnpm typecheck`：共享契约与严格前端 TypeScript 通过。
- `pnpm test`：A0-R1 后 contracts 124 + frontend 243 + gateway 129 + desktop 118 + legal inventory 6，共 620/620 通过；A1-H0 C# 定向 codec 7/7。
- `pnpm build`：Profile provenance 通过；Web 2658 modules；Gateway/Desktop Release 均 0 warning / 0 error。
- Playwright：1366×768、1920×1080、2560×1440 共 63/63 通过；关键操作区可见、禁用原因可聚焦、根页面无溢出、视觉基线已逐档审阅。
- 构建/测试 wrapper 明确报告 `serialPortOpened=false / hardwareCommandSent=false`。

## 已知风险

- Schema 允许异常 ID 是为了保留诊断证据，不表示这些 ID 可控制；未来 C# adapter 必须重复执行领域校验。
- 完全相同 CAN ID 的两个驱动未必能可靠计数，只能报告身份冲突候选，不能声称知道重复设备数量。
- 当前实体链灰显使用“首个不确定关节及其后全部 link”的保守投影；需在真实 URDF/CAN 反馈联调时确认每个关节的 link 归属仍与 Profile 一致。
- Studio 候选 `921600 baud`、CRC 帧与 50 Hz 遥测不属于固件基线 `db0818b` 的正式 `aethor-text-v1` 入口；不能把固件中的旧 CRC 回归资产当作生产兼容证据。
- Aethor_robo 当前来源目录仍缺完整 BSD 条款；底座 STL 还烘焙有 wheel-shell CAD 外形，若要彻底删除外观需重新导出底座。

## 下一步：A1-H1-F

1. 以固件提交 `db0818b` 的 `aethor-text-v1` 文档、正式 vectors 和实现为输入，形成 Studio 侧协议采用决策；不得把旧 `aethor-arm-ascii-v1` 回归资产误作正式入口。
2. 若 Studio 采用 `aethor-text-v1`，先定义独立版本化 codec/会话迁移方案并让两端消费同一 vectors；若固件恢复 CRC 协议，则必须提供新的正式入口、版本和固件侧证据。
3. 复用现有双工调度和数字孪生 ingest 接缝，新增与最终协议匹配的启动协调器和会话 owner；不得复制 Dummy reader/writer，也不得让两套 Aethor codec 同时成为生产入口。
4. 先以 fake transport 验证生产 REST/SignalR、心跳、部分/冲突/范围外 ID 和进程退出，再设计只读监督实机 runbook。
5. 未取得新的现场授权前，不打开 COM4、不使能、不发送运动或停止命令。A1-H 未关闭前，A1 不得标记 DONE。
