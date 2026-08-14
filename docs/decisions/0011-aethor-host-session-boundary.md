# ADR-0011：Aethor 主机会话与遥测投递边界

- 状态：Accepted
- 日期：2026-08-13
- 适用阶段：A1-H1-S

## 背景

`aethor-arm-ascii-v1` 已有无状态 TypeScript/C# codec，但固件仓库尚未提供可追溯实现与跨端向量。主机仍需先证明请求关联、重启清理、部分电机投影、高频遥测和关闭释放不会复制 Dummy 的无标签 response fence，也不会让慢 UI/SignalR 消费者反压串口解析。

## 决策

1. `AethorArmSerialSession` 只接管一个已经打开的 `IAsciiTransport`，复用 `SerialDuplexScheduler` 的唯一 reader 和有界优先 writer；本阶段不注册生产 DI，也不改变 Profile capability。
2. 主机生成的 request ID 在单个物理串口会话内严格递增且不复用。pending registry 最多 64 项，只拥有响应完成源，不拥有 writer；`RSP/ERR` 按 request ID 乱序关联。手工终端写入只等待物理写结果，不建立 pending 项。
3. `HELLO` 必须验证 product、protocol、DOF、controller、arm、session、boot_id、firmware、modes 与 stream_max_hz。重复 HELLO 更新会话并取消旧在途请求；boot_id 变化清除身份和全部 pending，重新握手前不投影反馈。
4. `GET_JPOS` 与 `TEL JOINT_STATE` 使用同一个 `AethorArmMotorFrameProjector`。固定七项 `q_deg` 只通过 mask 解释：缺失位不生成样本，valid 位更新模型，conflict 位隔离；范围外 ID 放在 `unexpectedMotorIds`，不伪造没有角度槽的电机样本。
5. 协议没有在 `GET_JPOS/JOINT_STATE` 中携带 `age_ms` 时，网关把有效的原子快照接收时刻作为年龄零点；无效/冲突项使用上界 65535。若固件提供七项 `age_ms`，主机严格校验并保留。`GET_MOTORS.age_ms` 的后续合并仍需固件证据。
6. 串口解析只写入容量为一的 latest-only 遥测槽；唯一生产事件泵通过 `WaitForLatestMotorFrameAsync` 主动拉取，不把下游回调放进 session 资源链。慢消费者会合并旧帧并增加 `CoalescedMotorFrames`，不会阻塞 RSP/ERR/EVT 解析或串口关闭。前端仍有每臂 20 ms/50 Hz 第二层模型提交上限。
7. 探针以累计计数和首条/每 100 条异常采样记录 invalid、orphan、projection rejection、timeout、boot reset、projected/published/coalesced；不为每条正常遥测写日志，不记录串口正文。
8. dispose 先取消 pending，再关闭 transport 解除 I/O，等待 scheduler，完成遥测拉取通道，最后清空 decoder/身份。测试只使用 fake transport。

## 结果

- 主机会话软件核心可以独立验收，并为固件联调提供稳定边界。
- Aethor 生产连接、REST/SignalR、心跳、能力发布和实机反馈仍不存在；`aethor-robo-pending` 与全部硬件 capability 保持不变。
- 固件 commit、固件侧 vectors 和监督只读实机验证进入 A1-H1-F，不能由本 ADR 的软件测试替代。
