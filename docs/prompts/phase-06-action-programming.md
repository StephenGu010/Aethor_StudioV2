# 阶段 6 提示词：动作编排与单点示教

目标是提供专业、可版本化、可审计的六轴点位动作编辑和受控执行，不实现动力学或轨迹规划。按 ADR-0005 分为不触达硬件的 Phase 6A、无生产接线的 Phase 6B-S，以及 Gate B 后的 Phase 6B-H；不得因为软件内核完成而提前宣称动作可运行。

## Phase 6A：离线文档与编辑器（已实现，需持续回归）

1. 定义 `ActionProgramV1` JSON Schema：稳定 ID/名称/版本、robot profile、六轴点位、模式 1–3、可选等待条件、备注和来源；拒绝未知 DOF、非法限位和不支持模式。
2. 实现新建、复制、重命名、点位增删/排序、单步预览、dirty 状态、导入导出和显式保存。当前不存在 V0；未知版本显式拒绝。未来新增版本时必须提供迁移，不能静默改写。
3. “采集当前点”只在真实连接、反馈新鲜且六轴完整时写入编辑草稿；静态展示只能生成明确标记的示例，不伪装实机示教。
4. 本机持久化只包含显式保存且复验通过的文档；损坏记录隔离并告警。导入文件在读取前执行 1 MiB 上限。
5. 页面必须保持 `NO EXECUTION PATH / PHASE 6B LOCKED`，不得调用网关命令或创建定时 runner。

### 6A 验收

- Schema round-trip、未知版本、越限/错误 DOF、来源、文件上限、持久化恢复、冲突、dirty guard、导出与对象 URL 清理测试通过。
- 三档视口覆盖新建、点位编辑、显式保存、刷新恢复和零 fetch/XHR/WebSocket 硬件流量。
- 不打开 COM4，不发送任何查询、状态改变或运动指令。

## Phase 6B-S：逐点执行软件内核（已实现；不得生产接线）

1. C# Application 独立 owner 通过 `IActionProgramCommandPort` 顺序消费点位；没有 DI 注册、REST/SignalR、RobotGateway adapter 或前端入口。
2. 首点和模式变化先取得模式 `completed + feedbackConfirmed`；当前关节组取得同等级证据后才开始 `durationAfterConfirmed` 并推进。
3. SHOWCASE、Aethor_robo、错误 DOF/限位、非正速度和不匹配 checkpoint 在 port 接管前拒绝。
4. 停止、命令超时、弱证据或内部故障终止序列并至多调用一次有界 stop-and-disable；未确认停止不得显示 Stopped。
5. 恢复仅接受同一 program revision、session 与计划指纹，从最后确认点之后继续；这不是固件队列暂停。

### 6B-S 验收

- fake port 覆盖逐点成功、弱证据拒绝、停止/停止未确认、恢复、并发拒绝、命令等待超时、内部故障和 dispose。
- API 路由、DI、前端网络请求与串口写入均保持不变。

## Phase 6B-H：监督硬件接线（未开始；依赖 Gate B）

1. runner 采用逐点调度：独立 owner 只在当前点取得 `completed + feedbackConfirmed` 后发送下一点。不得像旧 PySide 工具那样预先灌满队列或用固定 sleep 冒充完成。
2. 定义开始、停止、停止后从最后确认点恢复、失败和断线语义。固件当前不支持真正暂停，因此不得声称“队列暂停”。
3. 运行前显示摘要、范围和风险确认；运行中锁定冲突命令，记录每点命令 ID、发送、确认与错误。
4. `durationAfterConfirmed` 只在到位确认后开始；任何未知、失败、超时、取消或断线都终止序列并进入安全处置。

### 6B-H 验收

- fake serial 覆盖逐点成功、拒绝、超时、断线、停止和恢复；停止后无遗留待发队列。
- 实机只执行用户审核过的低风险短动作；物理急停可达。
- 关闭/切换设备前有未保存和在途动作保护。

持续更新 `docs/handoffs/phase-06.md`。只有 6A 与 6B 全部退出门、Gate B 实机证据和清理均完成后，Phase 6 才能标记 DONE 并创建阶段提交。
