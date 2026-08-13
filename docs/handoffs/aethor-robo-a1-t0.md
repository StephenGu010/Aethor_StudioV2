# Aethor_robo A1-T0 交接：数字孪生实时内核

## 阶段结果

| 项目 | 结果 |
|---|---|
| 阶段 | A1-T0 |
| 状态 | `DONE` |
| 范围 | adapter 之后、React/Three.js 之前的双臂遥测实时投影 |
| 串口 | 未枚举、未打开、未发送命令 |
| 生产 adapter | 尚未实现；由 A1-H 继续 |
| 计划提交 | `phase(A1-T0): add Aethor twin realtime core` |

## 已完成

- `ingestAethorTwinMotorFrame` 是未来 C# adapter/SignalR 的唯一前端入口，页面和 store 不解析串口文本。
- `AethorTwinFrameCoordinator` 对左右臂分别执行 latest-frame-wins；20 ms 内的中间帧被有界合并，左右臂在同一个 Zustand 通知中原子提交。
- 入口按 `jointGroupId + controllerId + armId + bootId + frameSeq` 管理身份。重复/倒序、退休 boot 回流和同一会话身份串线在进入 React 前拒绝；Profile 切换会重置入口。
- 领域投影继续按 motor ID 1–7 映射，重复和越界只进入诊断。每个关节独立累加 `feedbackAgeMs + 前端停顿时间`；达到 250 ms 后保留最后角度并标为 stale，串联链灰显。
- 控制台展示入口/模型 Hz、合并/拒绝计数、左右臂 fresh/stale 状态；没有帧时为 `UNAVAILABLE / LOCAL PREVIEW`。
- `targetPositionsDeg` 不被实体反馈覆盖；拖拽与滑条仍只改变幽灵目标。

## 尚未完成

- Aethor 固件、CRC/parser 向量、C# codec、SignalR 事件和真实串口会话仍属于 A1-H/A2。
- 250 ms 是前端显示失效阈值，不是使能、下发、停止或运动完成的判据；硬件门必须使用固件/网关协商后的新鲜度与状态。
- 当前入口只有自动化测试调用方，控制台不能连接 Aethor_robo、读取、使能、停止或发送关节目标。

## 验证证据

| 项目 | 结果 |
|---|---|
| shared contracts | 98/98 |
| studio-web | 240/240 |
| robot-gateway | 122/122 |
| studio-desktop | 118/118 |
| legal inventory | 6/6 |
| 合计 | 584/584 |
| strict TypeScript | 通过 |
| production Web | 2657 modules |
| Playwright | 63/63；1366×768、1920×1080、2560×1440 |
| 浏览器实页 | 三档无实际溢出/重叠；WebGL/URDF ready；无 warn/error；默认 `UNAVAILABLE / LOCAL PREVIEW` |

本阶段未枚举或打开串口，未发送硬件命令。A1-U2 的本地提交已完成，但首次远端同步复核期间 GitHub TLS 握手失败；本阶段提交前需重新 fetch 并确认远端状态，禁止强推。

## 下一步

固件提交可追溯后执行 [A1-H](../prompts/aethor-robo-a1-h-firmware-adapter.md)：C# 持续 reader 解析 `TEL JOINT_STATE`，校验 CRC/身份/序号后投影为现有 `AethorArmMotorFrameV1`，再通过版本化实时事件调用本阶段入口。不得在页面添加第二套串口 parser，也不得把 `GET_JPOS` 与 `TEL` 解释成不同角度坐标系。
