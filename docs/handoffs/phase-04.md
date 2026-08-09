# 阶段 4 交接

- 状态：`DONE`
- 完成日期：2026-08-09
- 实施者：Codex
- 仓库/分支：`Aethor_StudioV2 / main`
- 开始基线：`246b9996e43eb19e1be155e27cef10a5d5d38eca`
- 最近远端检查点：`f48222c0ee8d3a3282ac4f07ebc0831f3e80ec8a`
- 阶段完成提交主题：`phase(04): deliver supervised readonly gateway`

## 交付结论

Phase 4 已建立 .NET 10 单一串口所有者、loopback REST/SignalR、一次性会话令牌和前端只读设备会话，并在操作者现场监督下完成 Dummy COM4 的一次真实只读连接。实机仅发送 `#GETJPOS`、`#GETMODE`、`#GETENABLE`，未发送使能、停止、模式、raw、关节运动或其他状态改变命令。

本阶段不包含动力学、逆解、轨迹规划、动作执行或任何硬件控制权限。Phase 5 开始前必须重新取得现场授权，不能复用本次确认。

## 已交付

- `Domain → Application ← Infrastructure` 与 `Api` 分层；Domain 不依赖 HTTP、串口或前端类型。
- `ReadOnlyRobotGateway` 独占 session、transport、轮询任务、最新快照、容量 256 的协议历史和容量 128 的事件队列。
- Domain formatter 与 SerialPort adapter 双重精确白名单，只允许三个只读查询；115200、8-N-1、ASCII/LF、无 handshake、DTR/RTS 关闭。
- API 只监听 loopback；认证 API/Hub 与健康检查分离；REST 为权威快照，SignalR 为有界通知，故障后不自动重连。
- 前端 `HttpRobotGateway`、Zod 边界校验、超时/重连边界、安全 static fallback，以及设备页端口选择、只读连接/断开和有效反馈显示。
- 预检与离线 smoke：校验 PnP 身份、残留进程/listener、认证、能力、枚举、offline 状态、令牌日志和精确进程清理。
- 运维脚本回归保护：不可连接预检、approved loopback GET、无 connect 的离线 smoke、精确进程清理和根命令入口。
- 应用壳字体与比例调整、1366×768 内部滚动修复及三档 Win32 视觉基线。

## 真实硬件验收

证据位于已忽略且不提交的 `TestResults/phase-04-com4/20260809T023339Z/`。原始失败 summary 被完整保留；后续 `04b-readonly-audit.json` 与 `05b-disconnect-audit.json` 只做离线归一化和审计，没有重连设备。

| 项目 | 结果 |
|---|---|
| 现场授权 | 操作者在场、工作区净空、物理急停可触达、供电/姿态安全、COM4 身份和三查询范围均确认 |
| 设备身份 | `USB 串行设备 (COM4)`；PnP `OK`；`USB\VID_1209&PID_0D32&MI_00\7&2BF1B17E&0&0000` |
| 连接次数 | 一次 `/session/connect`，一次 `/session/disconnect`；没有重试 |
| 实际 TX | `#GETJPOS`、`#GETMODE`、`#GETENABLE`，没有第四种 payload |
| 实际 RX | `ok -7.97 -70.56 180.09 -3.56 3.26 0.03`；`ok 2 INT_POINT`；`ok 0` |
| 快照 | `connected / disabled / mode 2 / measured / valid`；六个关节值均有限 |
| 协议审计 | 6 帧，3 TX + 3 RX，方向交替、correlation 成对、0 error |
| 断开 | 返回 `offline / unavailable / unavailable`；一次 `serial.closed`，之后无 `serial.opened` |
| 清理 | 网关进程 0、5127 listener 0、stderr 空、COM4 PnP 仍为 `OK` |
| 禁止操作 | 未发送使能、停止、去使能、回零、复位、模式切换、raw 或运动命令 |

### 采证脚本误判

Windows PowerShell 5.1 把顶层 JSON 数组表示成带 `value/Count` 的 `PSObject` 适配对象，原执行器又直接用 `@()` 接收，最终把 6 帧误看成 1 个包装对象并失败。原始 JSON 中的 `value` 保留了全部 6 帧，离线审计后满足只读契约。仓库脚本已改为显式检查 `value` 并归一化为 `[object[]]`，同时增加回归测试；原失败记录没有被改写为成功。

## 软件验证

| 检查 | 结果 |
|---|---|
| `pnpm typecheck` | 通过 |
| `pnpm test` | shared 80 + frontend 61 + C# 28，共 169 项通过 |
| `pnpm build` | Vite/Profile 与 .NET Release 通过，0 warning / 0 error |
| 三档 Edge E2E | 1366×768、1920×1080、2560×1440 共 36/36 通过 |
| `gateway:smoke:offline` | live、401、只读 capabilities、COM4 仅枚举、offline session、运行中预检失败关闭、post-cleanup 通过、token 未进日志 |

## 关键决策

| 决策 | 原因 | 后续约束 |
|---|---|---|
| 单一 C# session/transport owner | 防止 UI、Hub 或 adapter 竞争串口 | Phase 5 必须扩展同一 owner |
| 双重精确查询白名单 | raw 和状态改变命令不属于 Phase 4 权限 | 不得通过终端或临时端点绕过 |
| REST 权威、SignalR 有界通知 | 实时通道可能断线或丢中间事件 | 断线后由 REST 恢复当前快照 |
| 打开后先 `connected + stale` | transport 可用不等于反馈有效 | 完整状态循环后才显示 `valid` |
| 故障释放且不自动重连 | 端口和现场状态可能已改变 | 每次重连均需操作者重新评估 |
| Loopback + opaque token | 限制本机进程边界 | Phase 8 再由桌面壳生成 production token |

完整设计见 [ADR-0003](../decisions/0003-readonly-gateway-boundary.md)，运行步骤见 [监督只读验收手册](../runbooks/phase-04-supervised-readonly-com4.md)。

## 已知限制

- `handle.exe` 未安装，无法直接观察 OS 串口句柄；释放结论来自 `serial.closed` 的代码顺序、运行日志、offline 终态以及进程/listener 清理。不得为补证而再次打开 COM4。
- 没有在真实设备上执行拔线或连续超时注入；这些故障路径由 fake transport/集成测试覆盖，真实断线恢复归入 Phase 7。
- C# DTO 仍为显式维护，Schema 变更必须同步两端测试。
- SignalR 队列采用 DropOldest，协议历史有界；慢客户端可能漏中间事件，REST 快照始终是恢复来源。
- 当前没有 WebView2 进程守护、发布日志留存或安装器；这些属于 Phase 8。

## 下一阶段启动清单

- [ ] 阅读公共上下文、路线图、本 handoff、ADR-0003 和 Dummy ASCII v1。
- [ ] 从本阶段完成提交复现 `pnpm typecheck`、`pnpm test`、`pnpm build`。
- [ ] 在 Phase 5 先定义命令仲裁、确认/超时、危险操作确认、停止链和审计契约。
- [ ] 任何真实使能、停止、模式或运动测试前重新取得操作者、净空、物理急停、供电、姿态与设备身份确认。
- [ ] 先 fake transport、再无负载台架、最后监督实机；任何失败不得显示成功。
- [ ] 自动流程只创建本地阶段提交，不得自动 push。
