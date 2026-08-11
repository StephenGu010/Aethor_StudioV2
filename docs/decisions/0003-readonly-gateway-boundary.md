# ADR-0003：Phase 4 只读网关边界

- 状态：Accepted
- 日期：2026-08-08

> Phase 4 的只读结论保持为历史事实；Phase 5 对同一个 gateway owner 的受监督命令扩展见 [ADR-0004](0004-supervised-command-boundary.md)。

## 背景与约束

Dummy 六轴当前连接在 Windows COM4，但固件没有完整的运动完成、安全回位和硬件动态上限证据。Phase 4 的目的只是建立可信 transport/会话边界并读取状态，不能因为已经能打开串口就提前暴露运动、使能或 raw command。前端、未来桌面壳和 C# 进程之间还需要一个可测试、可替换且不会监听局域网的版本化边界。

## 决策

1. `ReadOnlyRobotGateway` 是进程内唯一串口 session、transport、轮询任务、最新状态和协议历史所有者；页面、SignalR Hub 和基础设施 adapter 都不能创建第二个所有者。
2. Phase 4 串口写入采用两层白名单：Domain 只能格式化 `#GETJPOS/#GETMODE/#GETENABLE`，Infrastructure 只接受这三个带 LF 的精确 ASCII payload。API 不提供 raw 或任何状态改变端点。
3. API 使用 Kestrel `ListenLocalhost`。`/api/v1` 与 `/hubs/robot-v1` 必须通过同一 opaque session token；开发令牌只允许 Development，生产令牌只能由未来桌面壳声明为 `desktop` 来源。
4. REST session/joint-state 是权威快照；SignalR 是容量 128 的有界通知通道，协议历史默认容量 256。拥塞时可以丢弃旧通知，但不能丢失或篡改权威状态。
5. 串口打开只证明 transport 可用，session 先进入 `connected + stale`；完整有效查询循环后才进入 valid。从未取得句柄的打开失败释放临时 transport、保留关联错误并恢复 `offline`；成功打开后的连续三次查询超时或 transport 故障进入 `faulted` 并释放资源。不自动串口重连。
6. 网关启动不枚举、不连接；COM4 只能由设备页人工选择，并且必须在单独的现场监督门之后执行。

## 已考虑的替代方案

- **浏览器/Web Serial 直接连接**：拒绝。会绕过 C# 单一所有者、桌面生命周期和统一审计边界。
- **Phase 4 暴露通用 raw terminal**：拒绝。无法从协议层证明 raw 输入不会改变状态或运动。
- **连接后自动重连**：拒绝。拔线、端口身份变化或机械臂现场状态改变后，自动恢复会绕过人工安全判断。
- **把静态展示源模拟成已连接设备**：拒绝。会让展示数据污染真实 session 与安全联锁。
- **为每个 SignalR 客户端保留无界事件**：拒绝。长时运行会造成不可控内存增长，且通知不应成为第二个状态源。

## 后果与风险

- Phase 4 能验证跨进程、串口生命周期和真实反馈来源，同时明确阻断运动权限。
- SignalR 拥塞或中断时，客户端可能漏掉中间事件；UI 必须显示遥测警告并从 REST 恢复当前状态。
- 当前 Windows 端口目录只保证 `portName`，`hardwareId` 可以为空；实机 handoff 必须另外记录操作系统确认的设备身份。
- Desktop 进程守护和生产令牌注入仍属于 Phase 8；开发运行不能宣称应用退出后原生守护已经验收。
- Phase 5 必须扩展同一个 C# session owner，不能新增前端直连或第二条 raw 命令路径。

## 验证与回滚

- fake serial 覆盖并发连接、占用、分片/粘包/乱码/半帧、超时、拔线、重复连接/断开、有界历史和资源释放。
- 安全测试覆盖 loopback origin、令牌 transport、Development/production token source 与精确串口 payload 白名单。
- 前端测试覆盖配置缺失、外部 URL 拒绝、只读连接/断开、陈旧反馈隐藏和所有 Phase 5 动作禁用。
- 若实机监督验收发现协议与固定固件证据冲突，立即断开 COM4，保持 Phase 4 `IN PROGRESS`，以 `StaticShowcaseSource` 为安全回退；不得放宽白名单临时绕过。
