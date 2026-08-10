# ActionProgram V1

## 边界与状态

[`action-program-v1.schema.json`](action-program-v1.schema.json) 是 Dummy 动作文档的 wire/file Schema 权威源，`src/actionProgram.ts` 提供对应 TypeScript 类型。当前只实现离线创建、校验、显式保存、导入导出和 Dummy 本地目标草稿预览；本文档不定义串口写入或逐点执行 API，也不适用于 Aethor_robo 双七轴机械臂。

`ActionProgramV1` 只适用于 `dummy-6dof`。文件可使用 `.aethor-action.json` 后缀，但本质是 UTF-8 JSON；导出不等于安装、部署或实机审核。

## 文档结构

| 字段 | 规则 |
|---|---|
| `schemaVersion` | 固定为 `1.0`；其他版本显式拒绝，不静默迁移 |
| `programId` | UUID，作为导入冲突与本地 revision 的稳定身份 |
| `name` | 1–80 字符，不能全为空白 |
| `revision` | 1–2147483647 的整数；显式覆盖同一稳定 ID 时递增 |
| `profileId` | 固定为 `dummy-6dof` |
| `createdAtUtc/updatedAtUtc` | UTC ISO 8601；更新时间不得早于创建时间 |
| `source` | `authored` 或 `showcaseExample` |
| `notes` | 最多 2000 字符 |
| `waypoints` | 0–256 个 `ActionWaypointV1`，顺序即未来执行顺序 |

每个点位包含唯一 UUID、名称、恰好六个 `positionsDeg`、模式 1–3、备注、来源和可选的到位后等待。六轴顺序按 Profile 的 `protocolIndex`，角度单位为 degree，并重复校验 Dummy manifest 限位。

`postArrivalWait` 只有两种形式：

```json
{ "kind": "none" }
```

```json
{ "kind": "durationAfterConfirmed", "durationMs": 500 }
```

`durationMs` 范围为 1–600000。未来执行器只能在当前点取得网关 `completed + feedbackConfirmed` 后开始计时；它不是动作完成判据，也不能替代反馈收敛。

## 来源真实性

| 点位 `source` | `capturedAtUtc` | 含义 |
|---|---|---|
| `manual` | 必须为 `null` | 来自目标草稿或人工编辑，未由设备反馈确认 |
| `measuredCapture` | 必须为 UTC 时间 | 只记录当时新鲜、有效、profile 匹配的六轴实测反馈 |
| `showcaseExample` | 必须为 `null` | 静态展示值，不是实机示教点或安全姿态 |

程序级 `showcaseExample` 和点位级来源不会因导入、导出或预览而被改写。静态展示数据不得生成 `measuredCapture`。

## 校验、持久化与兼容性

- 导入文件上限为 1 MiB；在读取内容前先按文件大小拒绝超限输入。
- JSON 必须拒绝未知字段、重复点位 ID、错误 DOF、非有限数、越限角度、不支持模式和不一致来源时间。
- 本机动作库使用版本化 local storage，只保存经过显式保存且再次校验的文档；草稿、选择和预览状态不持久化。库最多 64 个文档、序列化总量最多 4 MiB，超限保存明确拒绝。
- 启动恢复时逐条重新校验持久化记录，并要求存储 key 与 `programId` 一致；无效记录被隔离并显示告警。超出容量时只恢复更新时间较新的可容纳记录，并汇总提示较旧记录需从导出文件恢复。
- 导入与现有 `programId` 冲突时必须由操作者确认覆盖；未经确认不得改写既有 revision。
- 当前不存在合法的 V0 文档，因此没有可执行迁移。未来新增 Schema 版本时必须提供显式、有测试的迁移路径；未知版本继续失败关闭。

示例见 [`examples/dummy-action-program-v1.example.json`](examples/dummy-action-program-v1.example.json)，该示例明确标记为 SHOWCASE，不能作为实机动作或安全回位姿态。

## Phase 6B 执行前置条件

当前前端没有 action runner，也不调用 `RobotGatewayV1`。C# Phase 6B-S 纯软件内核已经通过 fake command port 验证逐点 `completed + feedbackConfirmed`、有界停止和 checkpoint，但没有 DI/API/真实 adapter，因此不是本文件的 wire 执行能力。未来 Phase 6B-H 至少需要 Phase 5 Gate B 关闭、完整运动包络、受管运行计划 wire contract、逐点命令审计、取消/停止与断线恢复语义；任何 `unconfirmed/failed/timedOut/cancelled` 都必须停止序列，不能预灌队列或以固定 sleep 推进下一点。
