# Aethor_robo A1-H1-S 交接：主机会话软件核心

- 状态：`DONE`
- 日期：2026-08-13
- 仓库/分支：`Aethor_StudioV2 / main`
- 开始基线提交：`3d97be4dd987df3af37cf81c0dd9335f50518af6`
- 最终提交主题：`phase(A1-H1-S): add Aethor host session core`

## 本阶段目标

在不连接串口、不注册生产 adapter 的前提下，把 Aethor 无状态 codec 接入已有双工调度基础设施，完成 request/session/boot 关联、只读关节快照投影、高频遥测解耦和确定性资源释放。固件兼容与真实只读会话保留为后续硬件门。

## 已完成

- Application 新增 `AethorArmSerialSession`：一个 decoder、一个持续 reader、一个有界优先 writer；最多 64 个 pending 请求按严格递增 request ID 关联，RSP/ERR 可乱序返回。
- `HELLO` 严格校验 product、protocol、DOF、controller、arm、uint32 session/boot_id、firmware、MIT/POS_VEL modes 和 1–100 Hz 上限。重复 HELLO 会取消旧请求；boot_id 变化清空身份和全部在途请求。
- 手工终端使用 `QueueValidatedUnobserved`：只接受通过 Aethor codec 的单条 REQ，完成条件为物理 write，不等待回包、不占用 response fence。
- Domain 新增 `AethorArmMotorFrameProjector`，让 `GET_JPOS` 与 `TEL JOINT_STATE` 共用同一投影。ID 1–7 只按 mask 应用；缺失值不使用，冲突值隔离，范围外 ID 通过独立字段保留。
- `AethorArmMotorFrameV1` 增加可选 `identityConflict` 与 `unexpectedMotorIds`，既保留固件 mask 证据，也不需要伪造重复样本或范围外电机角度。
- 高频帧先进入容量为一的 latest-only 槽，生产事件泵通过单消费者 pull API 取出最新帧。慢消费者只合并旧帧，串口 parser 与 dispose 都不等待 UI/SignalR 回调。
- 会话 probe 包含 pending、valid/invalid、correlated/orphan、projected/published/coalesced/rejected、timeout、boot reset 和底层调度队列/资源状态。异常日志按首条及每 100 条采样，不记录协议正文。
- dispose 覆盖不响应 read cancellation 的 transport：先关闭句柄，再等待 reader/writer/dispatcher 和遥测投递收束；全部 pending 取消，close/dispose 各执行一次。

## 验证证据

| 检查 | 结果 |
|---|---|
| C# Gateway 全量 | 145/145；0 warning/error；`serialPortOpened=false / hardwareCommandSent=false` |
| 共享契约 | 125/125 |
| Aethor 前端 coordinator + ID reducer 定向 | 13/13；全量 245/245 |
| strict TypeScript | shared contracts 与 studio-web 通过 |
| 关键并发 | 乱序双查询、重复/退休 ID、无回包终端公平性、重复 HELLO、boot reset、timeout/late orphan 通过 |
| 高频路径 | 200 帧在下游暂不拉取时全部完成解析，最新帧槽丢旧保新，pending 保持 0 |
| 资源路径 | 两个在途请求关闭时均取消，transport close/dispose 各一次 |

## 当前没有实现

- `AethorArmSerialSession` 没有注册到 DI、`RobotGatewayV1`、REST、SignalR 或 Desktop；Production 和 engineering 都无法创建它。
- Profile adapter 仍是 `aethor-robo-pending`，串口枚举/连接、TX/RX、实测反馈、使能、停止和七轴运动 capability 全为 false。
- 没有心跳 owner、完整 `HELLO → GET_INFO → GET_CONFIG → GET_STATE → GET_JPOS → SET_STREAM` 启动协调器、GET_MOTORS 年龄合并或状态能力发布。
- 没有固件 commit、固件侧 conformance vectors、921600/50–100 Hz 吞吐证据或 COM 实机验证。
- ACK/DONE 结构化命令状态机与动作编排不在本阶段。

## 关键决策

完整决策见 [ADR-0011](../decisions/0011-aethor-host-session-boundary.md)。特别注意：Aethor 帧有 request ID，不能复制 Dummy 的 response fence；request ID 在一个物理会话内不可复用；慢下游不能运行在串口解析线程；软件核心通过不等于固件兼容。

## 下一步：A1-H1-F

1. 取得可追溯 Keil/CubeMX/FreeRTOS 固件 commit，并让固件消费共享 conformance vectors。
2. 冻结实际串口参数、HELLO/GET_CONFIG 字段、GET_MOTORS age、帧回绕、重复请求幂等和错误码行为。
3. 在现有 session 外新增启动协调器与心跳 owner；不得新增 reader、writer 或 codec。
4. 将版本化 motor frame 经受管事件边界接入 `ingestAethorTwinMotorFrame`，先用 fake transport 做 REST/SignalR 与资源测试。
5. 编写只读监督 runbook，取得新的现场授权后才能打开目标 COM；结构化 ENABLE/STOP/MOVE 继续后置。

## 硬件操作

- 未枚举或打开 COM4。
- 未发送查询、状态改变或运动命令。
- 所有 transport 行为均来自测试内存 fake。
