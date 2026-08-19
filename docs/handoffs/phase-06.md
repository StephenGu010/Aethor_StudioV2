# 阶段 6 交接：Dummy 动作编排

- 状态：`IN PROGRESS`
- 子阶段：`6A EDITOR VERIFIED / 6B-S SUPERVISED CORE VERIFIED / 6B-E ENGINEERING RUNNER IMPLEMENTED / 6B-H NOT STARTED`
- 日期：2026-08-19
- 分支：`codex/phase-06-engineering-action-runner`
- 本轮基线：`d63481d`

## 当前成果

Dummy 六轴动作页已经从离线编辑器扩展为可用于桌面 engineering 调试的手动示教与动作编排工具：

- 通过“采集当前点”按 `#GETJPOS` 顺序原样保存六个编码器设备角；不取绝对值、不归一化，也不应用旧 Profile/URDF 角度范围。
- 手动点同样只要求六个有限数。实测采集点只读，避免误改后仍被标记为 measured capture。
- 动作文档 350 ms 防抖自动保存；页面切换时刷新待保存内容。退出和删除点位不弹未保存确认。
- 新建程序默认 20 deg/s；程序可选择单次或循环。循环设置随文档保存。
- 目标预览把六个设备角原样加载到 Dummy 幽灵模型，不发送串口；实体模型仍由实测反馈驱动。
- authored 程序在 engineering 会话满足条件后可运行；SHOWCASE 程序和点位始终不可运行。
- 桌面首次启动没有活动动作时，运行快照端点返回规范 JSON `null`；前端不再把 200 空响应误报成“无法访问本机机器人网关”。初始权威恢复失败会继续按有界节拍重试，恢复成功后再建立唯一 SignalR 通道，因此一次瞬态失败不会永久锁死本次 WebView 会话。

## 执行模型

本阶段没有修改固件，也没有把固件队列号、最终 `ok` 或关节反馈当作运行许可。C# `EngineeringActionProgramRuntime` 使用以下模型：

1. 前端自动保存当前文档，然后提交 program ID、revision、session、速度、循环和全部点位的深快照。
2. C# 取得本次动作运行所有权；草稿之后的编辑不会改变正在运行的快照。
3. 每个点位格式化为 `>j1,j2,j3,j4,j5,j6,speed`，只有对应 direct 结果达到 `sent + transportWritten` 才进入等待并调度下一点。
4. 等待时间为“上一设备角到当前点的最大绝对角差 / speed”加点位附加等待。首点使用启动时的新鲜 `#GETJPOS` 快照。
5. 单次运行结束为 `finishedUnconfirmed`；循环持续到操作员停止。两种状态都不表示机械臂已到位。
6. 停止会先取消未来点位，再依次尝试写入 `!STOP`、`!DISABLE`。两行均写入后为 `stoppedUnconfirmed`；任一步未写入为 `failed`，但运行所有权仍会释放。

停止不仅取消 C# 等待：若当前点位仍在串口 writer 队列中，调度器会原子撤销它；若 writer 已经取得该点位，则等待这次不可撤销的 transport 写入结束后，再发送停止链。后台 `#GETJPOS/#GETMODE/#GETENABLE` 查询可以继续，但不会有旧动作点位落在 `!STOP/!DISABLE` 之后。每次运行另有服务端 execution nonce；重复使用客户端 `runId` 不会命中上一轮 direct 结果。

结构化停止、串口终端 `!STOP/!DISABLE`、断开和 runtime dispose 都会先取消动作运行，避免停止之后继续发送点位。运行期间查询仍可用，其他外部状态改变或运动命令由网关拒绝。

## 启动条件

运行按钮只有同时满足以下条件才启用：

- 当前文档为 authored，至少一个点位，且没有 SHOWCASE 点位；
- 当前网关为 `engineering` 且支持 direct；
- 当前会话为 connected/valid 的 `dummy-6dof`；
- 当前六轴关节帧为 fresh `measured + valid`；
- 电机已确认 enabled；
- 当前模式为 1–3，且全部点位 mode 与当前模式一致；
- `0 < speedDegS <= engineeringJointSpeedMaxDegS`；
- 每个点位恰好包含六个有限设备角。
- 每个格式化后的 `>` 行不超过固件队列项允许的 63 个 ASCII 字符，估算等待可由运行时表示。

网关会重复同样的状态校验。动作程序同一时刻只允许一个运行快照；并发开始返回 409，不会覆盖当前运行状态。

## 公共接口

新增契约：

- `ActionProgramRunWaypointV1`
- `ActionProgramRunStartRequestV1`
- `ActionProgramRunSnapshotV1`
- `ActionProgramRuntimeStateV1`

REST：

- `GET /api/v1/engineering/action-program/run`
- `POST /api/v1/engineering/action-program/run/start`
- `POST /api/v1/engineering/action-program/run/stop`

SignalR：

- `actionProgramRunSnapshot(ActionProgramRunSnapshotV1)`

`physicalCompletionConfirmed` 在该 engineering 契约中恒为 `false`。结构无效的请求返回 HTTP 400，不生成不符合快照契约的 rejected 状态；会话/使能/模式等运行前置条件不满足时才返回合法的 rejected 快照。前端按 session 和 `updatedAtUtc` 忽略陈旧事件，session identity 改变或断开时清空运行态。

API JSON 绑定与 Schema 同步拒绝未知字段、缺少的构造字段和数字枚举。跨运行快照时间戳由 C# 保证单调，即使系统 UTC 回拨也不会让新运行被上一轮终态压住；无时间戳的空 REST 结果不能清除已观察到的活动运行。

## 代码所有权

- 文件契约与 TypeScript 类型：`shared/contracts/`
- 动作文档校验、编辑、自动保存和 UI：`apps/studio-web/src/domain`、`stores`、`pages/action-programming`
- REST/SignalR adapter：`apps/studio-web/src/integrations`
- engineering 运行状态机：`services/robot-gateway/src/AethorStudioV2.Application/EngineeringActionProgramRuntime.cs`
- 串口命令仲裁：`services/robot-gateway/src/AethorStudioV2.Application/RobotGateway.cs`
- API 与事件：`services/robot-gateway/src/AethorStudioV2.Api/`

原 `ActionProgramRunner` 继续作为未来反馈确认式监督内核，只使用未注册的 `IActionProgramCommandPort`。它要求逐点 `completed + feedbackConfirmed` 并支持 checkpoint；不要把 engineering 的估算等待并入该内核。

## 验证

软件回归覆盖：

- 任意有限六轴设备角的 Schema、自动保存、导入导出、刷新恢复、预览和 C# 交接；
- measured capture 对 `#GETJPOS` 原值的保持；
- 默认 20 deg/s、循环开关、开始/停止 UI 和不可变提交快照；
- transport-written 逐点推进、估算节拍、循环停止、并发开始冲突；
- 停止写入失败仍尝试 disable、释放 owner，不遗留未来点位；
- 阻塞 writer 下撤销排队动作、重复 run ID 的新物理写入、63 字符队列边界和跨语言往返数值；
- 严格 HTTP JSON 绑定、停止/终态竞争、事件慢订阅合并、时钟回拨和空 REST 快照竞态；
- SignalR/REST 契约校验、乱序事件拒绝和 session 切换清理；
- Web、Gateway 与 Desktop Release 构建和桌面包同步。

本轮最终结果为 contracts 131、frontend 257、gateway 178、desktop 118、legal inventory 6，共 690/690；三档 Playwright 63/63。disabled 与 engineering offline 两种包级 smoke 均验证空运行快照为 `application/json` 的 `null`、网关 ready、session offline、正常关闭，以及 `serialPortOpened=false/hardwareCommandSent=false`。

最终测试数量和构建结果记录在本轮 `docs/CHANGELOG.md`。本轮软件验证没有打开 COM4，也没有发送查询、状态改变或运动命令。

## 仍未完成

- Phase 6B-H 的反馈确认式监督执行、逐点到位审计和 checkpoint 生产接线。
- Dummy 的可信到位容差、稳定窗口、总超时与监督实机证据。
- Aethor_robo 动作文档和运行器；当前动作页只服务 Dummy 六轴。
- 动力学、轨迹规划、碰撞判断、逆解和末端拖拽。

## 交接检查

1. 从本文件、`shared/contracts/action-program-v1.md`、`robot-gateway-v1.md` 和 ADR-0005 开始阅读。
2. 不把 `finishedUnconfirmed/stoppedUnconfirmed` 改写成到位或设备确认。
3. 不在前端增加第二套循环、串口队列或浏览器定时 runner。
4. 不恢复旧 J2/J3 等 Profile 角度约束到动作保存或 engineering direct 链路。
5. 修改公共接口、运行生命周期或桌面启动方式时，同步契约、架构、runbook、测试矩阵和本 handoff。
