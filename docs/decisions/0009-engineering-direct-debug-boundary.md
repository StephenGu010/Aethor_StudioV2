# ADR-0009：Dummy engineering 直连调试边界

## 状态

Accepted，2026-08-10。只适用于 Development 调试，不关闭 Phase 5 Gate B，也不等同于正式桌面启动策略或发布候选能力。

## 背景

Dummy 固件与旧上位机支持人工发送 ASCII 指令，但 `RobotGatewayV1.1` 只公开结构化命令。当前没有可信的四参数运动包络，正式 `jointGroup` 因而必须保持关闭；同时，前端管理员解锁只改变输入框状态，既不能解决实机调试，也会形成错误的权限暗示。错误 COM 口还可能停在 `connected + stale/unknown`，旧 UI 因要求 fresh + disabled 而无法释放。

## 决策

- wire contract 升级为 `RobotGatewayV1.2`，新增 `engineering` policy、`directCommand` capability、`DirectCommandRequest/Result` 和开发端点 `/api/v1/engineering/direct-command`。
- engineering 只允许 `ASPNETCORE_ENVIRONMENT=Development + tokenSource=development`。桌面无参数启动继续固定 `Production + desktop token + disabled`；本机开发包只有显式携带 `--engineering` 才切换到 Development engineering，且启动不会自动打开串口。supervised 仍要求 desktop token。
- 删除前端管理员机制，命令输入始终可编辑。离线只校验；只有能力协商明确返回 engineering direct 才能发送。
- C# 继续唯一拥有串口。direct 不是任意 raw 通道，只接受三个查询、`!START/!STOP/!DISABLE`、模式 1–3，以及恰好六个角度和一个显式速度的 `>` 命令。
- HOME/RESET、RGB、模式 4/5、电流/PID、标定、reboot、多行、控制字符和非 ASCII 均拒绝。Infrastructure 再次执行 payload allow-list。
- 六轴 direct 要求当前 session、valid measured feedback、有效模式、motor enabled、Profile 限位和 `0 < speed <= 100`。100 只来自固件输入范围，不是安全速度上限。
- FIFO 0–15 只返回 `queued + deviceQueued`；255 返回 rejected。direct 不返回“运动完成”，操作者必须观察 measured 反馈。
- direct 与结构化命令共享命令/串口互斥和有界超时；真实 TX/RX 进入协议帧，前端不得伪造。
- direct 也进入唯一命令所有权：结构化普通命令与 direct 互斥，停止并去使能会先取消 direct 再有界抢占。direct 超时、I/O 失败或无确认的状态改变命令会锁存联锁并把受影响状态降为 stale/unknown，不能继续普通运动。
- 普通断开只在命令在途或 motor 明确 enabled 时拒绝；成功打开后的 stale/unknown/faulted 错误会话允许释放。从未打开成功的端口直接恢复 offline，不创建需要再次点击“释放”的伪会话。
- 完成断开后清空当前会话协议/命令证据、连接状态、遥测历史和目标草稿，模型回到 Profile 软件启动姿态；显式保存的动作程序、布局和导出文件不受影响。该姿态不是实机 HOME 或安全回位。

## 后果

- 可以在不伪造四参数运动包络的前提下调试真实 Dummy，并保持“入队”和“到位”语义分离。
- engineering 不是正式工业运动验收，不能作为 Gate B、动作执行或发布候选的证据。
- direct 请求目前以有界协议 TX/RX 和 HTTP result 为证据，不进入结构化 `CommandAuditRecord`；需要正式可恢复的运动审计时必须走 supervised `jointGroup`。
- Aethor_robo 不受影响，仍无串口、协议或硬件命令能力。

## 验证

- parser/transport 拒绝越界、缺速度、HOME/RESET、RGB、电流和多行输入。
- fake transport 证明六轴 direct 只产生 queued，不产生 completed。
- UI 回归覆盖无管理员输入、离线禁发、engineering 发送和错误端口释放。
- 实机到位、零位、方向、速度和停止响应仍需按运行手册人工验证。
