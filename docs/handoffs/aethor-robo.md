# Aethor_robo 当前交接

## 状态

- Track：A0 模型接入与双臂控制台
- 状态：`DONE`
- 日期：2026-08-10
- 硬件访问：无；本轮未新启动或访问网关，未打开 COM4、未发送命令；既有未知 COM4 会话保持原样
- 起始提交：`e7dc9b6d706b198b04c1bfebab5b2071a92ba01a`
- 阶段提交主题：`phase(A0): complete dual-arm model console`

## 已完成的软件事实

- 来源 ZIP 已只读审计并迁移到 `aethor-robo-dual-7dof` 内置 Profile；23 个 STL 和规范化 URDF 均在仓库内使用相对路径。
- `provenance.json` 已固定来源 ZIP、原始/规范化 URDF 与 23 个 STL 的逐文件 SHA-256；本次外部源包对账证明 23 个规范化 STL 与源条目字节一致。根 `pnpm profile:verify` 流式复核当前文件，并在 provenance、URDF 引用或磁盘资产覆盖漂移时失败关闭。
- Profile 明确声明左、右两组各七轴；固定安装关节和六个车轮关节不进入控制组。
- 规范路由由 `/twin` 改为 `/console`，旧地址只重定向；页面显示 Aethor_robo 整机和独立的 14 轴本地目标草稿。
- 顶栏 `Current profile` 已成为整机级选择器，可在 `Aethor_robo` 与 `Dummy` 间切换；Aethor_robo 内部仍以左右臂 tab 选择七轴组。切换会清空两台设备的隐藏目标草稿和 Dummy runtime/遥测，Aethor_robo 不挂载 Dummy 会话协调器，也不能使用 Dummy engineering direct。
- 全局串口入口在 Aethor_robo 下固定显示“不适用”，不枚举、不连接，也不复用 Dummy adapter；顶栏工程状态只显示 `MOTOR / FEEDBACK / MODE` 的明确未接入值。
- 左右臂 tab 每次只编辑一组七轴；模型点选、旋转环、滑块、数值与键盘编辑不调用 Dummy gateway。
- 场景提供“整机 / 左臂 / 右臂”显式取景；左右臂取景按 Profile 关节组的实际/幽灵联合包围盒计算，并同步对应控制组，恢复整机后相机距离回到原值。
- 顶栏和主操作区如实显示硬件未实现；读取、关节组下发和软件急停固定禁用。
- 动作编排仍为 Dummy 六轴专属，不与 Aethor_robo 草稿同步。
- 首次实页检查发现固定 `fog far=7` 会把自动相机距离约 8.04 的整机完全雾化；已在场景层移除固定距离雾化，使 Profile 尺度不再影响可见性。
- 完整 E2E 曾捕获本机网络切换导致 11 个 loopback STL 请求出现 `net::ERR_NETWORK_CHANGED`。同源只读 Profile 资产现只重试一次；三档人为中断验证均恢复，持续失败测试仍进入 `URDF LOAD FAILED`，硬件/API 不使用该策略。
- visual/collision 对 23 个 STL 的 46 次解析已改为单模型生命周期内按 URL 合并；46 个节点共享 23 份 geometry，实体材质共享。目标 collision 不参与绘制，目标材质按 14 个受控关节与一个基础组共享且仍可独立高亮。运行诊断由 `52 / 98` 降为 `29 geometry / 22 material`（含操纵器），三档重复挂载和一次网络中断恢复均保持稳定。
- 控制台不再订阅完整 workbench store；工具窗拖动只更新对应窗口，不重绘 3D 场景。关节姿态使用差量更新，相机包围盒仅在模型就绪、取景变化或显式重置时重算，连续目标输入不会每次遍历整机。
- R3F 的 `Canvas fallback` 原先作为 `canvas` 子节点被 Windows 可访问性树读取，导致模型 READY 时仍报告 `WEBGL INITIALIZATION FAILED`。该伪告警已移除；真实 WebGL 缺失、渲染异常和上下文丢失继续走独立错误状态，三档 E2E 明确断言 READY 与场景失败节点不能并存。
- 参考网格改为基于完整整机世界包围盒自适应：位于模型最低点下方 6% 模型高度（8–30 cm），覆盖 2 倍 X/Z 足迹且不小于 6 m；左右臂取景不改变该参考尺度。Profile UI 统一显示 `Aethor_robo`，顶部名称单行裁切；字体栈与大小写规则已按屏幕 UI/Windows 语义收束。紧凑顶栏使用 `MOTOR / N/A` 与 `FEEDBACK / NO DATA`，完整未接入语义保留在 title，状态值不能越入相邻列。
- Windows 包现在把 Aethor_robo NOTICE 与机器可读 `provenance.json` 集中放入 `Legal/`，package smoke 和发布候选校验器缺项即失败；完整许可条款仍缺失，因此这只关闭包内溯源断链，不解除公开分发阻塞。

## 完成证据与后续边界

- A0 当前退出门为 contracts 93 + frontend 184 + gateway 82 + desktop 79 + legal inventory 1，共 439/439；Profile 溯源、strict TypeScript、Web 2639 modules、隔离 gateway Release 与 desktop Release build 均通过，C# 0 warning/0 error；三档 Playwright 63/63 通过。
- 三档 E2E 同时校验整机 Profile 切换、草稿复位、能力隔离、参考平面低于整机至少 8 cm 且覆盖 2 倍足迹、Profile 名称不越框、顶栏状态不越列、根文档不溢出、关节滚动区/固定提示/下发区无重叠、23 份 geometry 共享、同源资产一次恢复、按需帧收敛与重复挂载资源释放。E2E 会先重建当前 Web，旧 `dist` 不能冒充阶段证据。
- 交互压力采样从优化前 24 次输入中位约 350 ms / 最大约 439 ms 降至中位约 237 ms / 最大约 281 ms；这是本机软件 GPU 的对比采样，不宣称硬件级 WCET。
- 来源压缩包只有 BSD 声明，没有完整许可证文本；正式分发前需补齐。
- A1 被固件和规范指令集阻塞。开始 A1 前必须获得可追溯固件提交、帧格式、双臂寻址、限位/速度、反馈时序、停止和错误语义。
- A2/A3 未开始。不得先接 Dummy 串口适配器试运行，也不得用来源 URDF 的 `0…2π` 和零 velocity 推断实机安全包络。

## 下一位工程师启动清单

1. 阅读 `docs/product-boundaries.md`、`docs/architecture.md`、`docs/profiles/aethor-robo.md` 和本交接。
2. 检查工作树和 A0 阶段提交；不要修改或重写已验证的来源哈希和资产映射。
3. 开始 A1 前核对固件提交与独立协议证据；任一缺失时保持 `BLOCKED`，不创建串口发送路径。
4. 后续共享 UI/模型优化仍须运行根 `pnpm profile:verify`、`pnpm test`、`pnpm build` 和 `pnpm test:e2e`，确认 `/console` 零硬件网络/零命令。
5. 每个阶段 handoff 分别记录 Dummy 与 Aethor_robo 的实际影响。
