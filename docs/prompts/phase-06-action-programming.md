# 阶段 6 提示词：动作编排与单点示教

目标是提供专业、可版本化的六轴点位动作编辑和两种明确分开的执行模型，不实现动力学或轨迹规划。按 ADR-0005 分为离线 Phase 6A、反馈确认式软件内核 6B-S、Development engineering 人工运行 6B-E，以及 Gate B 后的监督执行 6B-H。

## Phase 6A：离线文档与编辑器（已实现，需持续回归）

1. 定义 `ActionProgramV1` JSON Schema：稳定 ID/名称/版本、robot profile、六轴点位、模式 1–3、可选等待条件、备注和来源；拒绝错误 DOF、非有限角度和不支持模式，但不用 Profile/URDF 范围裁剪点位。
2. 实现新建、复制、重命名、点位增删/排序、单步预览、导入导出和 350 ms 防抖自动保存；离开工作区和删除点位不弹未保存确认。当前不存在 V0；未知版本显式拒绝。未来新增版本时必须提供迁移，不能静默改写。
3. “采集当前点”只在真实连接、反馈新鲜且六轴完整时写入编辑草稿；静态展示只能生成明确标记的示例，不伪装实机示教。
4. 本机持久化只包含自动保存时复验通过的文档；损坏记录隔离并告警。`#GETJPOS` 实测点必须在采集、保存、导入导出、预览和 6B-S command port 交接中保持六轴原值；手动/SHOWCASE 点也只校验六个有限数。导入文件在读取前执行 1 MiB 上限。
5. 离线、SHOWCASE 或普通 disabled 网关下保持 `NO EXECUTION PATH`；只有 6B-E 全部门满足时才开放运行。前端不得用浏览器定时器遍历点位。

### 6A 验收

- Schema round-trip、未知版本、任意有限六轴值原样保留、错误 DOF、来源、文件上限、自动保存、持久化恢复、冲突、退出无拦截、删除点位无确认、导出与对象 URL 清理测试通过。
- 三档视口覆盖新建、点位编辑、自动保存、刷新恢复和零 fetch/XHR/WebSocket 硬件流量。
- 不打开 COM4，不发送任何查询、状态改变或运动指令。

## Phase 6B-S：逐点执行软件内核（已实现；不得生产接线）

1. C# Application 独立 owner 通过 `IActionProgramCommandPort` 顺序消费点位；没有 DI 注册、REST/SignalR、RobotGateway adapter 或前端入口。
2. 首点和模式变化先取得模式 `completed + feedbackConfirmed`；当前关节组取得同等级证据后才开始 `durationAfterConfirmed` 并推进。
3. SHOWCASE、Aethor_robo、错误 DOF、非有限角度、非正速度和不匹配 checkpoint 在 port 接管前拒绝；Profile 范围外的有限值必须原样交给 port。
4. 停止、命令超时、弱证据或内部故障终止序列并至多调用一次有界 stop-and-disable；未确认停止不得显示 Stopped。
5. 恢复仅接受同一 program revision、session 与计划指纹，从最后确认点之后继续；这不是固件队列暂停。

### 6B-S 验收

- fake port 覆盖逐点成功、弱证据拒绝、停止/停止未确认、恢复、并发拒绝、命令等待超时、内部故障和 dispose。
- API 路由、DI、前端网络请求与串口写入均保持不变。

## Phase 6B-E：engineering 人工运行（已实现；持续回归）

1. `ActionProgramRunStartRequestV1` 必须是 authored program revision、session、速度、循环和点位数组的深快照；SHOWCASE 和空程序在取得命令所有权前拒绝。
2. C# `EngineeringActionProgramRuntime` 是唯一 owner。当前点必须达到 `sent + transportWritten` 才可推进；不等待 FIFO、`ok` 或到位。基础等待为启动/上一点设备角到目标的最大角差除以 `speedDegS`，再加 `postDispatchWaitMs`。
3. 新建程序默认 20 deg/s。单次运行全部点位写入后为 `finishedUnconfirmed`；循环持续到操作员停止。所有完成状态的 `physicalCompletionConfirmed` 恒为 false。
4. 启动要求当前 Dummy session 与六轴 `#GETJPOS` 新鲜有效、电机 enabled、全部点位模式与当前 mode 一致。六个有限设备角原样传输，不应用旧 Profile/URDF 范围。
5. 操作员停止、结构化停止、终端 `!STOP/!DISABLE`、断开或 dispose 必须取消未来点位并尝试写入 `!STOP`、`!DISABLE`。两行都写入才是 `stoppedUnconfirmed`；写入失败也必须释放 owner。
6. REST/SignalR 提供权威快照；前端按 session 与时间拒绝旧事件，session identity 改变时清空。草稿继续编辑不能改变正在运行的快照。

### 6B-E 验收

- contracts/Zod/C# fake-port/React 覆盖默认速度、循环、无损设备角、深快照、逐点写入、并发冲突、乱序事件、停止失败、外部停止和断开清理。
- UI 只显示 transport-written/physical-unconfirmed 语义，不把估算等待写成“已到位”。
- 软件验证不得打开 COM4；实机结果由操作者另行复核。

## Phase 6B-H：监督硬件接线（未开始；依赖 Gate B）

1. runner 采用逐点调度：独立 owner 只在当前点取得 `completed + feedbackConfirmed` 后发送下一点。不得像旧 PySide 工具那样预先灌满队列或用固定 sleep 冒充完成。
2. 定义开始、停止、停止后从最后确认点恢复、失败和断线语义。固件当前不支持真正暂停，因此不得声称“队列暂停”。
3. 运行前显示摘要、范围和风险确认；运行中锁定冲突命令，记录每点命令 ID、发送、确认与错误。
4. `durationAfterConfirmed` 只在到位确认后开始；任何未知、失败、超时、取消或断线都终止序列并进入安全处置。

### 6B-H 验收

- fake serial 覆盖逐点成功、拒绝、超时、断线、停止和恢复；停止后无遗留待发队列。
- 实机只执行用户审核过的低风险短动作；物理急停可达。
- 自动保存错误必须可见；关闭/切换设备不弹未保存提示，在途动作保护仍由未来 6B-H 单独定义。

持续更新 `docs/handoffs/phase-06.md`。6B-E 可以独立交付为 engineering 工具，但只有反馈确认式 6B-H、Gate B 实机证据和清理均完成后，Phase 6 总体才标记 DONE。
