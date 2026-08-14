# Aethor_robo 双七轴档案与进度

## 身份与来源

| 字段 | 值 |
|---|---|
| 稳定 Profile ID | `aethor-robo-dual-7dof` |
| 显示名 | `Aethor_robo` |
| 规范 robot name | `aethor_robo` |
| 协议适配器 | `aethor-robo-pending` |
| 当前来源 | `Aethor_Layout_deployed/` 目录快照 |
| 目录快照 SHA-256 | `B55D39CDC540424391C72D535BD8D1CA0054907BC9009DBCE10A94CD167C2E57` |
| 来源 URDF SHA-256 | `90D002AEDBB448E606B77A3D297D80DFF20AE1387723140F849F47B620575E3F` |
| 规范化 URDF SHA-256 | `6F4DAC940EADBBC4D2019AF518C2C5369E622157E6EDE989ADF106AA7D53B7D7` |

目录快照包含 31 个文件、共 125181249 bytes；确定性哈希算法记录在 Profile 的 `provenance.json`。来源 `package.xml` 声明 BSD，但没有可核对的完整许可证文本，正式对外交付前仍需补齐许可证原文。

## 规范化结果

- 当前内置模型为 17 links、16 joints、17 个 STL：14 个 revolute 关节和 2 个固定安装关节，没有 continuous joint，也没有独立动量轮 mesh。
- 双臂稳定映射不变：`left_arm_joint_1…7` 对应 `j1…j7 / protocolIndex 0…6`，`right_arm_joint_1…7` 对应 `j8…j14 / protocolIndex 7…13`；显示名、轴向和左右 TCP link 均保持不变。
- 两个 J1 延续现有控制 Profile 的零位约定：`rpy=0 0 0`、预览范围 `0…2π`。其余几何、质量、惯量、关节 origin、axis 和来源 limit 来自新部署导出。
- 来源 URDF 中的 `wheel_Link1…6`、`wheel_Joint1…6` 及六个独立 STL 已明确排除，不进入模型树、控制、动作编排、示波或命令契约。
- `satellite_base_link.STL` 的来源 CAD 组件清单仍包含六个 wheel-shell 名称，说明轮壳外形已经烘焙进底座 STL。若要连外壳几何一起删除，必须重新导出 CAD 底座，单纯删除 URDF wheel joint 无法做到。
- 来源 effort/velocity 均为 0。manifest 的 `0…360°` 只用于当前本地预览，不是可信硬件限位、速度上限或安全姿态。

权威资源位于 `shared/robot-profiles/BuiltIn/aethor-robo-dual-7dof/`。`provenance.json` 记录目录快照、原始/规范化 URDF、17 个保留 STL 的逐文件 SHA-256 和动量轮排除清单。根命令 `pnpm profile:verify` 会要求溯源记录、URDF 引用和磁盘 STL 集合完全一致。

## 当前能力

| 能力 | 状态 | 说明 |
|---|---|---|
| 整机 URDF/STL 加载 | SOFTWARE VERIFIED | Vite 复制 17 个 STL；17 links / 16 joints 结构、关节映射和逐资产 SHA-256 门通过 |
| 左/右七轴本地 FK 预览 | SOFTWARE VERIFIED | 独立 14 轴 store；拖动、滑块、数值、键盘只改变幽灵模型；支持整机/左臂/右臂取景 |
| 电机发现帧与 ID 投影 | SOFTWARE VERIFIED | `AethorArmMotorFrameV1` 允许任意子集/顺序；ID 1–7 直接映射每臂 J1–J7，冲突、范围外与缺失均可诊断 |
| 数字孪生实时投影 | SOFTWARE VERIFIED | 每臂最新帧优先、双臂原子提交、模型更新上限 50 Hz；逐关节 250 ms 新鲜度 |
| 主机协议 codec | SOFTWARE VERIFIED | TypeScript/C# 独立实现 CRC、REQ formatter、wire parser 和有界行解码 |
| 主机会话软件核心 | SOFTWARE VERIFIED | fake transport 下完成 request/session/boot、GET_JPOS/TEL ID 投影、latest-only 投递和资源释放；未注册生产 DI |
| 串口、反馈、使能、停止、模式 | BLOCKED | 固件证据、生产 adapter 与监督实机尚未完成 |
| 关节组硬件下发 | BLOCKED | 无可信限位、速度、完成确认和停止语义 |
| Aethor_robo 动作编排 | NOT STARTED | 当前 `ActionProgramV1` 只支持 Dummy 六轴 |
| 动量轮控制 | OUT OF SCOPE | Profile 不包含独立动量轮链路 |

控制台默认显示本地预览；只有未来 adapter 提交的版本化电机帧才会按臂显示 `OBSERVED/MISSING/STALE/ID CONFLICT`。当前没有运行时 adapter，读取、下发和软件急停仍禁用。Dummy 的协议、会话、模式与停止语义不得复用。

本地 Profile 资产遇到一次浏览器 `NETWORK_CHANGED / failed fetch` 时可进行一次同源重试；持续失败、404、外部 URL 或解析错误仍显示模型失败。该恢复只属于打包 URDF/STL，不扩展到硬件或网关通信。

Aethor_robo visual/collision 按 URL 共享 17 份只读 geometry；实体模型共享材质，目标幽灵不绘制 collision，并按 14 个受控关节共享可独立高亮材质。包含当前关节操纵器的诊断基线为 23 geometry / 22 material。路由重复挂载后资源计数稳定并按唯一引用释放。

关节目标只更新变化的关节；相机联合包围盒仅在模型就绪、整机/分组取景变化或显式重置时重算。工具窗位置变化不能触发 3D 场景重渲染。

## 并行阶段

进度以 [路线图](../roadmap.md) 的 A0–A3 表为准：A0-R1 部署模型更新、A1-U0 候选契约、A1-U1/U2 双工基础、A1-T0 数字孪生实时内核、A1-H0 主机 codec 和 A1-H1-S 会话软件核心已完成；A1-H1-F 等待固件证据和只读生产 adapter。A2 为只读网关，A3 为安全控制和动作编排。
