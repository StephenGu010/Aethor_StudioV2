# A1-U2 执行提示词：Dummy 串口运行时迁移

在 `D:\Aethor_robot\Aethor_StudioV2` 内继续工作。开始前完整阅读 `AGENTS.md`、项目 workflow skill、`docs/roadmap.md`、`docs/decisions/0010-bounded-serial-duplex-runtime.md`、`docs/handoffs/aethor-robo-a1-u1.md`、Dummy 协议和现有网关测试。

## 目标

把 Dummy 的全部物理串口读取和写入一次性迁移到 `SerialDuplexScheduler`。迁移完成后只能存在一个持续 reader 和一个 writer；终端 direct 请求在有界入队后立即返回，不因设备回包缺失阻止操作者继续输入。结构化使能、模式、停止和正式关节组仍保留现有匹配响应、完成证据、幂等审计与联锁语义。

## 必做

1. 为 Dummy adapter 建立单一 line decoder 和响应分发器。所有 RX 先记录协议证据、更新 session/joint 快照，再匹配等待者。
2. 无 request ID 的 Dummy 响应一次只允许一个需要匹配响应的 transaction fence；普通 direct terminal 不创建等待者，不拥有 reader 或 writer。
3. direct endpoint 返回明确 `queued`，不能把入队写成 `sent/transportWritten`；实际 TX 只在物理写成功后进入协议帧。失败、过期、淘汰和断开必须产生有界可见结果。
4. `STOP/DISABLE` 使用 P0；终端和结构化控制使用 P1 公平队列；轮询 P2；后台诊断 P3。P0 可以中断低优先级 response fence，但不能把被中断请求写成成功。
5. 队列满、重复 work ID、陈旧工作、拔线、handler fault 和关闭均有稳定终态；断开后没有 reader/writer/task/transport 残留。
6. 删除旧的直接 `transport.ReadAsync/WriteAsync` 调用和 `serialIoGate`，不能保留第二套隐藏 owner。
7. 前端终端允许多个已接受请求显示各自状态；发送按钮不因等待 RX 进入全局禁用。页面仍不添加伪造 TX/RX。
8. 更新 RobotGateway contract/schema、ADR、系统说明、诊断手册、路线图和 handoff。

## 验收

- fake transport 证明唯一 reader、物理写串行、P0 抢占、P1 公平、轮询不饿死、direct 连续入队、结构化请求匹配、迟到/无关回包、队列满、过期、拔线与关闭。
- 原有 Dummy gateway/desktop/frontend 全量回归通过，C# 0 warning/0 error。
- 三档 Playwright 检查终端多请求状态、无重叠/裁切/横向溢出和 console error。
- 不枚举、不打开 COM4，不启动生产硬件命令网关；测试 wrapper 必须报告 `serialPortOpened=false / hardwareCommandSent=false`。
- 完成后创建独立阶段提交并普通 push；`tmp/` 和生成物不得进入提交。
