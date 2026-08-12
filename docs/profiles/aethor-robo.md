# Aethor_robo 双七轴档案与进度

## 身份与来源

| 字段 | 值 |
|---|---|
| 稳定 Profile ID | `aethor-robo-dual-7dof` |
| 显示名 | `Aethor_robo` |
| 规范 robot name | `aethor_robo` |
| 协议适配器 | `aethor-robo-pending` |
| 来源包 | `Layout11 EX1.zip` |
| 来源包 SHA-256 | `DCF82D4CB7DEB05B19F40320054172ADA51213F0182DB228D7E78D171D9406C1` |
| 来源 URDF SHA-256 | `E77E0B6E25C451B6171F1B6F03F8CE50BC185AC2CB5F7118F4E5C43DA866EC37` |
| 规范化 URDF SHA-256 | `0EC56041289B1C0C1F5F7382D3A82B25CED17716D561BDCCA87F2195C79984CA` |

来源 URDF 的 robot name 为 `Layout11 EX1`，声明 BSD，但压缩包内没有可核对的完整许可证文本。当前只能记录声明，不能扩大许可结论；正式对外交付前必须补齐来源与许可证原文。

## 规范化结果

- 共 23 links、22 joints、23 个 STL；规范化后没有重复 joint name，也没有缺失 mesh。
- 两个固定安装关节分别连接左右机械臂；可控组为 `left_arm_joint_1…7` 和 `right_arm_joint_1…7`，每组独立 TCP link。
- 六个 continuous wheel joints 保留在整机 URDF 中，但标记为 model-only，不进入控制、动作编排、示波或命令契约。
- 原 URDF 中重复的 `arm_Joint3` 和不一致命名已替换为稳定、唯一、方向明确的 snake_case 名称；几何、质量、惯量、origin 和 axis 未推断改写。
- 原始关节范围约为 `0…2π`，effort/velocity 均为 0。manifest 中保留等价 `0…360°` 仅供本地模型预览；它不是可信硬件限位、速度上限或安全姿态。

权威资源位于 `shared/robot-profiles/BuiltIn/aethor-robo-dual-7dof/`。`provenance.json` 记录来源 ZIP、原始/规范化 URDF 以及 23 个源 STL 到规范名称的逐文件 SHA-256；本次只读对账确认所有 STL 均为字节级一致的改名迁移。运行根命令 `pnpm profile:verify` 会流式复核当前 URDF/STL，并要求溯源记录、URDF 引用和磁盘资产集合完全一致。更详细的迁移与许可限制见该目录的 `NOTICE.md`。

## 当前能力

| 能力 | 状态 | 说明 |
|---|---|---|
| 整机 URDF/STL 加载 | SOFTWARE VERIFIED | Vite 复制 23 个 STL；Schema/URDF 映射与逐资产 SHA-256 溯源门通过；visual/collision 每个 URL 只解析一份共享 geometry |
| 左/右七轴本地 FK 预览 | SOFTWARE VERIFIED | 独立 14 轴 store；拖动、滑块、数值、键盘只改变幽灵模型；支持整机/左臂/右臂显式取景 |
| 电机发现帧与 ID 投影 | SOFTWARE VERIFIED | `AethorArmMotorFrameV1` 接受任意子集/顺序；ID 1–7 直接映射 J1–J7，重复/范围外 ID 诊断，缺失链灰显；目前仅有测试注入入口 |
| 串口、反馈、使能、停止、模式 | BLOCKED | 固件和规范指令集未完成 |
| 关节组硬件下发 | BLOCKED | 无可信限位、速度、完成确认和停止语义 |
| Aethor_robo 动作编排 | NOT STARTED | 当前 `ActionProgramV1` 只支持 Dummy 六轴 |
| 车轮控制 | OUT OF SCOPE | 首版只控制两个七轴机械臂 |

控制台默认显示本地预览；只有未来 adapter 提交的版本化电机帧才会按臂显示 `OBSERVED/MISSING/STALE/ID CONFLICT`。当前没有运行时 adapter，读取、下发和软件急停仍禁用。Dummy 的协议、会话、模式与停止语义不得复用。

本地 Profile 资产遇到一次浏览器 `NETWORK_CHANGED / failed fetch` 时可进行一次同源重试；持续失败、404、外部 URL 或解析错误仍显示模型失败。该恢复只属于打包 URDF/STL，不扩展到硬件或网关通信。

Aethor_robo URDF 的 visual/collision 会引用同一组 23 个大 STL。场景加载器按 URL 合并并发解析，使 46 个模型节点共享 23 份只读 geometry；实体材质在单模型内共享。目标幽灵不渲染 collision，每个受控关节共享一份可独立高亮的材质，其余模型节点共享基础幽灵材质。运行诊断（包含当前关节操纵器）由 `52 geometry / 98 material` 降为 `29 / 22`，路由重复挂载后保持稳定并按唯一引用释放。

关节目标更新只应用发生变化的关节，不重复更新静态模型姿态；相机联合包围盒只在模型就绪、整机/分组取景变化或显式重置相机时重算，连续拖动不会每帧遍历整机。工具窗位置只由对应 `FloatingToolWindow` 订阅，不能触发 3D 场景重渲染。

## 并行阶段

进度以 [路线图](../roadmap.md) 的 A0–A3 表为准：A0 模型与双臂控制台、A1-U0 上位机候选契约已完成；A1-H 等待固件和跨语言 adapter；A2 为只读网关；A3 为安全控制和动作编排。每个共享阶段的 handoff 都要记录对本 Profile 的影响。
