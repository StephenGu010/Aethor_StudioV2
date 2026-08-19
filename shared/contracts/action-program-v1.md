# ActionProgram V1

## 边界与状态

[`action-program-v1.schema.json`](action-program-v1.schema.json) 是 Dummy 动作文档的 file Schema 权威源，`src/actionProgram.ts` 提供对应 TypeScript 类型。文档支持离线创建、校验、自动保存、导入导出和 Dummy 本地目标草稿预览；engineering 运行时会把通过校验的 authored revision 映射为独立的 `ActionProgramRunStartRequestV1` 不可变快照。文件格式本身不拥有串口，也不适用于 Aethor_robo 双七轴机械臂。

`ActionProgramV1` 只适用于 `dummy-6dof`。文件可使用 `.aethor-action.json` 后缀，但本质是 UTF-8 JSON；导出不等于安装、部署或实机审核。

## 文档结构

| 字段 | 规则 |
|---|---|
| `schemaVersion` | 固定为 `1.0`；其他版本显式拒绝，不静默迁移 |
| `programId` | UUID，作为导入冲突与本地 revision 的稳定身份 |
| `name` | 1–80 字符，不能全为空白 |
| `revision` | 1–2147483647 的整数；显式覆盖同一稳定 ID 时递增 |
| `profileId` | 固定为 `dummy-6dof` |
| `jointCoordinateSystem` | 固定为 `dummy-device-joints-v1`；表示点位与 `#GETJPOS`、固件关节命令使用同一设备角 |
| `createdAtUtc/updatedAtUtc` | UTC ISO 8601；更新时间不得早于创建时间 |
| `source` | `authored` 或 `showcaseExample` |
| `speedDegS` | 程序级默认关节速度，`0 < speedDegS <= 100`；新建默认 20 deg/s，执行时仍须服从网关能力上限 |
| `loopEnabled` | 循环执行偏好；新建默认 `false`，engineering 运行时为 `true` 时持续循环，直到操作者停止 |
| `notes` | 最多 2000 字符 |
| `waypoints` | 0–256 个 `ActionWaypointV1`，顺序即预览和运行快照中的调度顺序 |

每个点位包含唯一 UUID、名称、恰好六个 `positionsDeg`、模式 1–3、备注、来源和可选的到位后等待。六轴顺序按 Profile 的 `protocolIndex`，角度单位为 degree。动作文档对所有来源只要求六个有限设备角，不应用 Profile 或 URDF 限位，不裁剪、归一化或改写角度。`measuredCapture` 从 `#GETJPOS` 按原顺序逐值复制；手动点也可输入任意有限值。J3 点位 90° 对应 URDF 模型 0°；模型偏置只在渲染边界使用，不写入动作文件，也不进入串口 payload。缺少 `jointCoordinateSystem` 的早期本地记录会在恢复时隔离，避免将旧模型角静默解释为实机设备角。

动作点位有效不等于当前硬件一定接受该目标。未来真实执行时，runner 必须原样把六轴值交给当前网关；网关/固件可以按当次设备能力拒绝命令，但不得静默改写点位。

`postArrivalWait` 只有两种形式：

```json
{ "kind": "none" }
```

```json
{ "kind": "durationAfterConfirmed", "durationMs": 500 }
```

字段名为 V1 历史兼容名称。监督执行内核只在 `feedbackConfirmed` 后使用它；当前 engineering 人工运行模式没有到位证据，因此映射为“按最大关节角差和程序速度估算的运动时间之后，再附加等待 `durationMs`”，UI 明确显示为估算运动后附加等待。

`durationMs` 范围为 1–600000。未来执行器只能在当前点取得网关 `completed + feedbackConfirmed` 后开始计时；它不是动作完成判据，也不能替代反馈收敛。

## 来源真实性

| 点位 `source` | `capturedAtUtc` | 含义 |
|---|---|---|
| `manual` | 必须为 `null` | 来自目标草稿或人工编辑，未由设备反馈确认 |
| `measuredCapture` | 必须为 UTC 时间 | 只记录当时新鲜、有效、profile 匹配的六轴实测反馈；六个值按 `#GETJPOS` 原样保留 |
| `showcaseExample` | 必须为 `null` | 静态展示值，不是实机示教点或安全姿态 |

程序级 `showcaseExample` 和点位级来源不会因导入、导出或预览而被改写。静态展示数据不得生成 `measuredCapture`。

## 校验、持久化与兼容性

- 导入文件上限为 1 MiB；在读取内容前先按文件大小拒绝超限输入。
- JSON 必须拒绝未知字段、重复点位 ID、错误 DOF、非有限数、不支持模式和不一致来源时间。点位角度不受 Profile/URDF 范围校验；数据链路必须保持六个有限值不变。
- 本机动作库使用版本化 local storage；编辑停止 350 ms 后自动重验并保存，页面切换或关闭时同步尝试刷新待保存内容，不显示未保存离开确认。点位删除也直接写入自动保存流程。库最多 64 个文档、序列化总量最多 4 MiB，Schema 无效或超限写入明确失败并保留当前内存草稿。
- 启动恢复时逐条重新校验持久化记录，并要求存储 key 与 `programId` 一致；无效记录被隔离并显示告警。超出容量时只恢复更新时间较新的可容纳记录，并汇总提示较旧记录需从导出文件恢复。
- 导入与现有 `programId` 冲突时仍由操作者确认覆盖；这属于稳定 ID 冲突处理，不是未保存离开提示。未经确认不得改写既有 revision。
- `speedDegS`、`loopEnabled` 是 V1 的向后兼容可选输入；旧 V1 文件缺少时分别规范化为 `20` 和 `false`，重新导出时写入显式值。
- 当前不存在合法的 V0 文档，因此没有可执行迁移。未来新增 Schema 版本时必须提供显式、有测试的迁移路径；未知版本继续失败关闭。

示例见 [`examples/dummy-action-program-v1.example.json`](examples/dummy-action-program-v1.example.json)，该示例明确标记为 SHOWCASE，不能作为实机动作或安全回位姿态。

## Engineering 运行与监督执行

当前 `/actions` 可在 Dummy `engineering` 会话中提交 `ActionProgramRunStartRequestV1`。前端提交 program ID、revision、session、20 deg/s 默认速度、循环开关和逐点设备角的深快照；C# `EngineeringActionProgramRuntime` 独占本次串口调度，只有当前点的 direct 结果达到 `sent + transportWritten` 才开始估算等待并进入下一点。它不等待固件队列号、最终 `ok` 或 `#GETJPOS` 收敛，结束状态固定为 `finishedUnconfirmed`；这表示全部 payload 已写入，不表示实机到位。循环只由 C# 运行时拥有，页面刷新或草稿继续编辑不会改变正在运行的快照。

运行要求 authored 程序、非 SHOWCASE 点位、当前 Dummy session 为 connected/valid、六轴 `#GETJPOS` 新鲜有效、电机已确认 enabled、全部点位模式与当前模式一致，且速度不超过网关 engineering 上限。六个有限设备角按最短往返文本写入，不套用旧 Profile/URDF 范围；最终运动行必须适配固件 64-byte 队列项，即最多 63 个 ASCII 字符。停止会取消尚未调度点位，并从串口 writer 队列撤销尚未写出的当前点位；已开始的原子写入收束后，再依次尝试 `!STOP` 与 `!DISABLE`。只有两行都写入 transport 才显示 `stoppedUnconfirmed`，仍不声称设备已停或去使能。

原 `ActionProgramRunner` 保留为未来监督执行内核，仍要求逐点 `completed + feedbackConfirmed` 和 Gate B 的可信完成策略。engineering 人工运行模式没有替代该路径，也不提供 checkpoint、自动恢复、路径规划、碰撞判断或到位证明。
