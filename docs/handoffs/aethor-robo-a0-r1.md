# Aethor_robo A0-R1 部署模型替换交接

## 阶段结论

| 项 | 结果 |
|---|---|
| 阶段 | A0-R1 部署模型替换 |
| 状态 | `DONE` |
| 日期 | 2026-08-13 |
| 来源 | `C:\Users\59436\Desktop\Aethor_Layout_deployed\`（只读迁移） |
| Profile | `aethor-robo-dual-7dof` / `Aethor_robo` |
| 硬件访问 | 无；未启动网关、未枚举或打开串口、未发送命令 |

## 完成内容

- 换入来源 `Layout11EX1.urdf` 和 17 个本体/双臂 STL，规范化为 `aethor_robo`、17 links、16 joints（14 revolute + 2 fixed）。
- 删除六个独立动量轮 link、continuous joint 和 STL；控制台模型树、事件、诊断与设备页不再显示轮链。
- 保持双臂控制映射：左臂 `j1…j7 / protocolIndex 0…6`，右臂 `j8…j14 / protocolIndex 7…13`；joint name、axis、分组、TCP 和 J1 零位约定不变。
- 将 Profile provenance 升为 v1.1 目录快照格式，记录 31 文件快照哈希、来源/规范化 URDF、17 个保留 mesh、动量轮排除项和 J1 兼容约定。
- 更新 1366×768、1920×1080、2560×1440 的控制台视觉基线；新模型在三档视口完整入镜，参考网格位于模型下方且控制区无重叠。

## 哈希与资源事实

| 对象 | SHA-256 |
|---|---|
| `Aethor_Layout_deployed/` 确定性目录快照 | `B55D39CDC540424391C72D535BD8D1CA0054907BC9009DBCE10A94CD167C2E57` |
| 来源 URDF | `90D002AEDBB448E606B77A3D297D80DFF20AE1387723140F849F47B620575E3F` |
| 规范化 URDF | `6F4DAC940EADBBC4D2019AF518C2C5369E622157E6EDE989ADF106AA7D53B7D7` |

逐 mesh 哈希见 `shared/robot-profiles/BuiltIn/aethor-robo-dual-7dof/provenance.json`。根命令 `pnpm profile:verify` 是当前完整性门。

## 验证证据

- `pnpm profile:verify`：1 URDF + 17 byte-identical STL mappings。
- `pnpm test`：contracts 124 + frontend 243 + gateway 129 + desktop 118 + legal inventory 6，共 620/620。
- `pnpm typecheck`：contracts 与 studio-web strict TypeScript 通过。
- `pnpm build`：Web 2658 modules、31 个静态 Profile 项复制成功；Gateway/Desktop Release 均 0 warning / 0 error。
- Playwright：三档共 63/63；资源请求 17/17，诊断 23 geometry / 22 material，重复挂载不累积资源。
- 桌面同步：从本阶段已提交 HEAD 构建 `artifacts/windows-a0-r1/AethorStudioV2-0.1.0-win-x64/`。包内为 17 个 STL、0 个 wheel 文件，URDF 哈希与 Profile 一致；engineering offline smoke 校验 691 项 manifest / 692 个实际文件，session 保持 offline，`serialPortOpened=false / hardwareCommandSent=false`，Gateway 正常退出。桌面 `Aethor Studio V2.lnk` 已指向该包。

## 仍需注意

- `satellite_base_link.STL` 的 CAD 组件清单含六个 wheel-shell 名称，轮壳外形已烘焙进底座。当前只保证“没有独立动量轮关节/mesh”；若视觉上也不能出现轮壳，需要 CAD 侧重新导出底座。
- 来源目录仍只有 BSD 声明，没有完整许可证条款；公开分发前继续补齐许可文本。
- 这次变更不新增 Aethor_robo adapter 或硬件能力。A1-H1 仍需固件提交、固件向量和只读 session adapter。
- 新包使用 `-AllowDirty`，因为仓库里保留了用户未跟踪的 `tmp/` 采证文件；manifest 仍固定记录本阶段提交，资格仅为 `development-dirty`，不能当正式发布候选。构建未删除、暂存或打包 `tmp/`。
- 更新快捷方式时旧桌面实例仍在运行，未强制结束。需先正常关闭旧窗口，再从桌面快捷方式启动，单实例机制才会加载新包。

## 下一步入口

协议接入继续从 [Aethor_robo 当前交接](aethor-robo.md) 和 [A1-H0 交接](aethor-robo-a1-h0.md) 进入；模型事实以 [Profile 档案](../profiles/aethor-robo.md) 与 `provenance.json` 为准。
