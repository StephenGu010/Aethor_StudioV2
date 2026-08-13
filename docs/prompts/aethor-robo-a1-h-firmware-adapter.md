# Aethor_robo A1-H：固件证据与跨语言适配

## 任务

在不修改 Dummy adapter 的前提下，实现并验证 `aethor-arm-ascii-v1` 的固件 parser/formatter、跨语言测试向量和 C# 独立 adapter。先完成 fake transport 与只读观测，未经新鲜现场授权不得打开真实串口或发送任何状态改变命令。

## 开始前必须阅读

1. `docs/protocols/aethor-arm-ascii-v1.md`
2. `shared/contracts/aethor-arm-gateway-v1.schema.json`
3. `docs/profiles/aethor-robo.md`
4. `docs/architecture.md`
5. `docs/handoffs/aethor-robo.md`
6. 可追溯的 Keil/CubeMX/FreeRTOS 固件 commit 与固件侧协议文档

若第 6 项缺失，记录阻塞并停止，不要用 UI、URDF 或 Dummy 行为补写协议事实。

## 实施要求

- 固件冻结 CRC、最大行长、请求幂等、boot/session、GET_INFO/CONFIG/STATE/JPOS/MOTORS、HEARTBEAT、TEL/EVT、STOP/DISABLE 与错误码；生成可由 TypeScript/C# 共用的 vectors。
- ID 映射只接受 `1…7 → J1…J7`。测试任意子集、到达乱序、ID >7、身份冲突、反馈陈旧和完整七轴；异常值不得覆盖模型。
- C# 继续是串口唯一 owner。Aethor adapter 使用持续 RX reader 与有界优先级 TX writer，写锁不能跨越响应等待；pending request 只按 request/boot/session 关联完成。
- Dummy 和 Aethor 共享可复用的串口生命周期/日志基础设施，但 codec、会话状态、命令能力和反馈 DTO 不共享语义。不得修改 `RobotGatewayV1.4` 的 Dummy 契约来迁就 Aethor。
- 第一交付只开放只读 HELLO/查询/遥测投影；结构化使能、运动、STOP、动作编排在独立监督阶段前保持 capability false。
- 端口断开、固件 reboot、sequence 倒退、reader/writer 取消和宿主关闭都必须有有界收束与资源释放测试。

## 验证门

- TypeScript Schema/领域测试与 C# parser/formatter/vector/fake transport 全通过。
- 50 Hz 合成遥测下，终端人工请求、心跳和查询不会互相饥饿；P0 STOP/DISABLE 可抢占待写的低优先级项。
- 重复/范围外/缺失电机在控制台有稳定诊断，目标草稿不被反馈覆盖，Three.js 资源重复挂载不增长。
- `pnpm typecheck`、`pnpm test`、`pnpm build`、三档 Playwright 通过；未获授权时证据明确 `serialPortOpened=false / hardwareCommandSent=false`。
- 生成更新后的 `docs/handoffs/aethor-robo.md`；只有固件证据和跨语言门全部关闭才把 A1 标为 DONE。
