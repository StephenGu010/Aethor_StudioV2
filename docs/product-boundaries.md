# 产品与安全边界

## 首版目标

`Aethor Studio V2` 首版服务两类控制对象：一台 `dummy-6dof` 六轴机械臂，以及一台 `aethor-robo-dual-7dof` 空间机器人上的左、右两个七轴机械臂。Dummy 已有独立协议和经监督只读/状态控制验证；Aethor_robo 当前只有规范化整机模型、双七轴关节分组和本地目标预览，固件、规范指令集、反馈、速度/限位与硬件安全语义均未完成。两条产品线不得共享未经证明的协议或运行时状态。

## 首版工作区

- 控制台：Aethor_robo 整机实体/目标幽灵模型，左、右七轴机械臂分组选择和拖动，模型树与显示工具窗。当前只做本地正向运动学预览，不存在反馈、硬件读取或下发路径；六个车轮只参与模型展示，不进入控制组。
- 数据示波：关节反馈、目标与误差；静态阶段明确标记 `SHOWCASE`，配置网关后绝不以展示帧填补空缓冲。
- 串口终端：协议帧查看、筛选、导出和离线格式校验；输入无需管理员解锁。只有本机 `engineering` 网关声明 direct capability 且 Dummy 已连接时可发送受限白名单，前端不直接访问串口。
- 设备与模型：设备、URDF、关节映射、限位、协议能力和资源来源。
- 动作编排：Phase 6A 支持版本化 JSON、点位编辑/排序、来源校验、显式本机保存、导入导出、受门控的实测单点采集和目标草稿预览；6B-S 只提供无生产接线的 C# 逐点执行内核，页面持续显示无执行路径；6B-H 实机接线未实现。

## 已锁定操作规则

- 一次只允许一个硬件会话。Dummy 网关与 Aethor_robo 本地控制台状态分离；Aethor_robo 未完成独立适配器前不能连接。
- 顶栏 `Current profile` 切换整台设备；Aethor_robo 页面内的左臂/右臂只切当前七轴控制组。切换 Profile 会撤销隐藏目标草稿和旧运行时遥测，不会自动连接、断开、停止或发送命令。
- Dummy 仍连接、重连、存在安全联锁或未确认去使能时，不允许切换到 Aethor_robo；操作者必须先停止并确认 disabled，再人工断开。Aethor_robo 激活时，示波和动作编排显示 Dummy 专属能力边界；终端显示独立的 Aethor 候选协议校验界面，但不消费 Dummy 网关状态、协议帧或发送能力。
- Dummy 顶栏提供全局串口选择器：只通过 `RobotGatewayV1` 刷新端口、手动选择、显式连接和安全断开；它与设备页共享同一运行时 session，不拥有串口。COM4 只是当前可枚举端口，不得自动打开。Aethor_robo 激活时不枚举或连接串口。
- Dummy 新硬件 session 的首个可信 `measured + valid` 六轴帧允许一次性把幽灵目标对齐到实测姿态，避免展示位成为初始下发草稿；操作者首次编辑后，后续反馈不得覆盖目标。该行为不验证物理原点、关节方向或安全起始位。
- Aethor_robo 关节滑块和 3D 拖动只做本地目标预览；读取、下发和软件急停均固定禁用。未来即使接入硬件，也必须显式选择左臂或右臂并下发完整七轴组，不能从当前预览状态自动发送。
- 真实动作只有在连接有效、反馈新鲜、设备已使能、目标合法、无在途命令且安全门通过时可用。
- 静态展示数据永远不能产生 `CONNECTED`、`ENABLED`、`COMMAND ACCEPTED` 或 `E-STOP SUCCEEDED`。
- 允许的 Dummy 结构化模式仅为 1–3；详情以 [Dummy ASCII v1](protocols/dummy-ascii-v1.md) 为准。
- 动作“暂停”不能伪装成固件队列暂停。首版必须采用诚实的逐点调度和确认语义。
- 动作文档结构/限位合法不等于动作安全、路径安全或可执行；SHOWCASE 点位和人工草稿不得冒充实机示教或安全姿态。

## 受管 Profile 包边界

- `.aethor-robot` 仅在浏览器内校验和显示 manifest 摘要；选择新文件会取消并废弃旧校验结果，页面卸载也会终止在途任务。
- 压缩包与声明解包总量分别限制为 250 MiB，最多 2,048 个文件，`manifest.json` 最多 1 MiB，目标 URDF 最多 8 MiB；ZIP 元数据越界时不会展开 mesh。错误列表最多保留 64 项并报告省略数量。
- 包内路径按 Windows 文件系统语义拒绝穿越、绝对路径、ADS/保留名、尾随点/空格和大小写冲突；外部 URL、缺失资源、重复关节、DOF/索引/限位错误同样失败关闭。
- `PACKAGE STRUCTURE VALID` 只证明 manifest/URDF 结构与 mesh 路径存在；当前前端不展开 STL 内容，也不代表已安装、已持久化、可连接或可控制。未来 C# Profile 安装服务必须重新验证原始字节并写入应用数据目录，不能复用前端判定作为授权。

## Phase 6A / 6B-S 当前边界

- `ActionProgramV1` 仅接受 `dummy-6dof`、`dummy-device-joints-v1` 六轴设备角、模式 1–3 和最多 256 个点位；详情以 [ActionProgram V1](../shared/contracts/action-program-v1.md) 为准。
- 只有 connected、profile 匹配、source measured、valid 且六轴完整的当前反馈才能采集为 `measuredCapture`；静态展示只能产生 `showcaseExample`。
- 本机动作库只保存显式确认过的文档 revision；草稿、当前选择和预览不持久化。导出不等于安装或设备审核。
- C# `ActionProgramRunner` 只通过 fake command port 验证逐点、停止和 checkpoint 语义；没有 DI、REST/SignalR、真实 RobotGateway adapter、串口写入或前端运行态。运行按钮固定禁用。
- 6B-S checkpoint 不是固件暂停，只允许同一 program revision、session 与计划指纹从最后确认点后恢复。Phase 5 Gate B 未关闭前不得增加 6B-H 生产路径。

## Phase 7A 当前边界

- `GatewaySessionCoordinator` 仍是唯一 SignalR owner；REST、SignalR 和手动权威刷新统一经 runtime store 进入遥测历史，页面不得新建订阅。
- 只收集当前 `dummy-6dof` session 的 `measured + valid` 六轴帧；同序号、倒序、错误 profile、陈旧或非法帧拒绝。序号缺口单独计数。
- 每个信号最多保存 120 秒 × 40 Hz = 4800 点；六轴 actual/target/error 共 18 路，理论上限 86400 点。默认窗口 60 秒，图表前台最多 10 Hz、隐藏时最多 1 Hz。
- 目标序列标记 `COMMANDED` 只表示当前前端目标意图，不代表设备 ACK；误差为 `COMPUTED`。会话断开或 identity 改变清空历史，同 session 重连/陈旧时保留最后可信历史并明确标记 `STALE`。
- 协议日志最多 256 帧并按稳定 ID 去重；“清空视图”只隐藏当时已有帧，不删除网关审计或阻止新帧。网关已配置但无帧时显示空缓冲，不回退 SHOWCASE。
- `RobotGatewayV1.4` 的默认与生产策略仍无直发能力。Development-only `engineering` 提供受限 direct 端点：只接受 Dummy 查询、启停/去使能、模式 1–3 和带显式速度的六轴目标；不接受任意 raw 字节。HTTP 入队显示 `QUEUED · GATEWAY ACCEPTED`，物理写入显示 `SENT · MANUAL CONFIRM`，均不表示设备确认或到位。
- 错误 COM 口造成 `connected + stale/unknown` 时允许释放串口；只有命令在途或电机已确认 enabled 才拒绝普通断开。释放端口不等于机械臂安全状态确认。

## Phase 8A 当前边界

- 桌面壳只拥有窗口、进程、短期令牌、应用数据路径和 WebView2 生命周期；机器人 session、串口和命令仍由 C# `RobotGateway` 独占。
- 桌面无参数启动固定 `commandPolicy=disabled`，启动网关不枚举、不连接 COM4。仅本机开发包的显式 `--engineering` 入口启用 Development 调试，仍不自动打开串口，也不构成发布候选能力。WebView2 只通过 `http://localhost` 虚拟主机和随机 loopback 网关通信。
- 桌面壳只接受 WebView2 Stable Runtime，并在创建任何机器人网关进程前离线探测其版本；缺失或被覆盖为非 Stable channel 时只显示原生前置条件面板，不联网下载、不启动网关。
- bridge 只允许最小化、最大化/还原、关闭和拖动；普通浏览器不模拟原生能力。关闭只有在离线或明确 disabled 时接受。
- 当前包是 `development-dirty` 便携验证产物，不是安装器或正式发布候选。签名、升级/卸载、四档 DPI、多显示器与硬件回归均属于 8B。

## Phase 5 当前边界

- 启动前端或网关不得自动打开任何串口；枚举到 COM4 只说明 Windows 当前可见该端口。
- 默认 command policy 为 `disabled`。Development token 不能开启控制；只有未来桌面壳来源令牌与 `supervised` 配置同时成立时才可能宣告硬件能力。
- API 只提供结构化命令，没有 raw 串口端点。前端必须先协商 capabilities，后端仍重复校验 session、反馈、使能、限位、速度和单在途条件。
- 结构化命令的物理结果一旦未确认、失败或超时，普通控制被锁存；只允许停止并去使能。成功读回 disabled 或重新建立人工确认的新 session 才恢复。Development-only engineering 六轴直发采用人工确认，不进入该结构化联锁。
- 当前 session 的 REST 命令历史也是结构化控制的前端许可门；未恢复、正在恢复或恢复失败时，普通结构化命令与 supervised 关节组保持禁用，停止并去使能不被该门阻断。结构化命令 HTTP 响应丢失按物理结果未知处理，不得直接重试。engineering 六轴请求失败时页面不自动重发、不推断是否写入，由操作者查看真实 TX 和实机后决定。
- SignalR 重连、关闭或契约错误会保留 Dummy 最后实测关节值但立即标记 `STALE`，并在所有工作区显示全局告警；重连通知不等于恢复，必须重新取得 REST 权威快照。Aethor_robo 控制台不消费该 Dummy 状态，也不得显示为真实反馈。
- 当前没有可信 Dummy 四参数运动包络，`jointGroup` 默认不在 supported capabilities；速度上限、到位容差、连续稳定窗口和总超时必须同时由可追溯证据提供，不得从 URDF、旧上位机或展示数据推断。
- FIFO 接受不等于动作完成；只有六轴实测误差连续处于批准容差内达到稳定窗口才可显示 `completed + feedbackConfirmed`。超时或查询失败锁存联锁并要求停止去使能。
- 固件 HOME/RESET 会阻塞协议处理线程，可能妨碍 STOP 抢占；生产配置不宣告、不执行这两项。
- 串口刚打开时允许显示 `CONNECTED / STALE`，但关节值必须保持 `UNAVAILABLE`，直到收到契约有效的新鲜六轴反馈。
- 查询超时、拔线、I/O 错误或不支持的模式不得触发自动串口重连；网关释放端口并要求操作者重新评估后手动连接。
- COM4 只有在操作者、机械臂净空、物理急停、供电、当前姿态、端口身份和本次命令范围全部现场确认后才能打开。Phase 4 授权不能复用于 Phase 5，Gate A 状态控制授权也不能复用于 Gate B 运动授权。
- 2026-08-09 Gate A 已验证一次使能、停止并去使能、模式 1–3 和恢复模式 2；未发送关节目标，断开前为 measured/valid、disabled、mode 2。该历史结果不扩大当前 capability，也不构成 Gate B 授权。
- 2026-08-10 的现场准备只执行 COM4 枚举与配置检查：端口身份匹配、PnP `OK`、网关进程/listener 为 0，脚本明确返回 `serialPortOpened=false`、`networkRequestSent=false`。这不等于连接或 Gate B 授权。

## 软件停止语义

当前网关的防御式停止链为：`!STOP → $0,0,0,0,0,0 → !DISABLE → #GETENABLE`。其中 `$0...` 是无成功 ACK 的内部 best-effort 步骤，不能通过 UI/公共 API 构造，也不能阻塞后续去使能与读回。只有最终读回使能为 `0` 才能显示“已去使能”；否则显示未确认并引导使用物理急停。

## 明确不包含

- 动力学、轨迹规划器、碰撞求解、末端拖拽、IK 和笛卡尔控制。
- MATLAB、Simscape、ROS、MoveIt、Zero-G、阻抗和连续示教录制。
- RGB、模式 4/5、电流/PID、标定、reboot 的结构化控制面板。
- 从现有 URDF 推断速度、effort 或安全回位姿态。
- 在后端缺席时模拟串口连接、设备回包、命令成功或急停成功。

## Aethor_robo 当前硬边界

- 稳定 Profile ID 为 `aethor-robo-dual-7dof`，显示名为 `Aethor_robo`；协议适配器暂记为 `aethor-robo-pending`，所有硬件 capability 为 false。
- 控制组仅包含 `left_arm_joint_1…7` 与 `right_arm_joint_1…7`。固定安装关节和六个连续车轮关节不进入控制、动作编排、示波或命令契约。
- 原 URDF 中的 `0…2π` 范围、零 effort、零 velocity 只能作为来源事实和本地模型预览信息，不能视为实机机械限位、速度上限或安全回位姿态。
- Aethor_robo 必须新增独立协议适配器、会话状态、七轴组命令和实机验收证据；不得复制 `dummy-6dof` 的模式 1–3、串口格式、限位或停止语义。
- A1-U0 已允许通过版本化测试帧验证任意电机子集和顺序：只按 ID 1–7 映射关节，范围外/冲突 ID 仅提示，从第一个不确定关节起将实体链灰显。该测试入口不枚举端口、不创建连接，也不使任何真实命令可用。
- A1-T0 已完成数字孪生高频入口：固件 50–100 Hz 帧可以丢旧保新，前端模型最多 50 Hz 提交；左右臂同一显示周期原子更新。250 ms 无新鲜单轴反馈时仅冻结末姿态并灰显，不把历史值继续标作实测新鲜数据。
- 当前动作编排仍只接受 Dummy 六轴文档。Aethor_robo 双臂动作格式与执行器必须等规范指令集和硬件完成后另行版本化。
