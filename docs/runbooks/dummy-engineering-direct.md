# Dummy engineering 直连调试手册

## 用途与限制

本手册用于当前开发机上的 Dummy 六轴实机联调。它不会自动连接、使能或运动，也不代表 Phase 5 Gate B 完成。`QUEUED` 仅表示固件 FIFO 接受命令；软件停止不能替代物理急停。

禁止发送 HOME、RESET、RGB、模式 4/5、电流/PID、标定、reboot 或未列出的命令。Aethor_robo 不适用本手册。

## 启动

令牌只保存在未提交的 `apps/studio-web/.env.local` 和当前进程环境中，至少 32 个可打印 ASCII 字符。完成 Release build 后，推荐在仓库根目录执行统一入口：

```powershell
pnpm dev:engineering
```

它会启动隐藏的本机 gateway/frontend 进程并验证 `RobotGatewayV1.2 + engineering + directCommand + session offline`，日志和 PID 只写入被忽略的 `artifacts/dev/`。它不会枚举、连接或打开串口。若端口 5127 已有 owner，入口失败关闭，不复用未知进程。

需要使用与 Web 同一构建的桌面壳时，先生成本机开发包，再创建工程快捷方式：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File apps/studio-desktop/build-windows.ps1 -AllowDirty
powershell -NoProfile -ExecutionPolicy Bypass -File apps/studio-desktop/create-engineering-shortcut.ps1 `
  -PackageRoot artifacts/windows/AethorStudioV2-0.1.0-win-x64
```

桌面快捷方式显式携带 `--engineering`；无参数桌面仍为 `commandPolicy=disabled`。两者启动都不会自动连接 COM4。

在启动桌面前可只验证包内 engineering policy，不枚举或打开串口：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File apps/studio-desktop/smoke-packaged.ps1 `
  -PackageRoot artifacts/windows/AethorStudioV2-0.1.0-win-x64 `
  -EngineeringOffline
```

需要分别观察进程输出时，也可以在仓库根目录打开两个 PowerShell：

网关窗口：

```powershell
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$env:AETHOR_GATEWAY_SESSION_TOKEN = '<与前端 .env.local 相同的本机令牌>'
$env:AETHOR_GATEWAY_TOKEN_SOURCE = 'development'
$env:AETHOR_GATEWAY_COMMAND_POLICY = 'engineering'
pnpm gateway:dev
```

前端窗口：

```powershell
pnpm dev
```

启动本身不得打开 COM4。页面能力应显示 `ENGINEERING`，终端显示 `DIRECT READY`。

## 连接与初始核对

1. 确认物理急停可直接触达，机械臂工作区无人，结构和线缆无干涉；不要依赖软件按钮代替现场安全措施。
2. 在顶部串口组件手动选择预期端口并点击连接。若选错端口，即使状态为 stale/unknown 也应能点击“断开/释放”；不要反复连接多个端口。
3. 等待 `CONNECTED + VALID`，核对六个实测角、模式和 motor 状态。没有 valid measured feedback 时不得使能或运动。
4. 新 session 的第一帧只会把幽灵目标对齐到实测姿态一次。核对实体模型是否随手动扭动实机同方向变化；这一步才是关节索引/方向证据。
5. 在 motor disabled 时选择模式 1–3。当前建议继续使用已实测状态中的模式，不为调试随意切换。

## 最小运动调试

1. 点击“使能设备”，必须取得 `!START + #GETENABLE` 的反馈确认；仅 ACK 不够。
2. 回到“控制台”，确认六个目标仍等于当前实测值。
3. 将 Command speed 保持在低值（默认 `1 deg/s`）。界面的 100 deg/s 上界只是固件输入上界，不是安全建议。
4. 只对现场确认有净空的一轴设置小增量，其他五轴保持当前实测值；检查幽灵模型姿态、数值限位和预期方向。
5. 点击“下发整组关节角”并再次确认。结果应为 `QUEUED`；随后观察实体模型、实测数值和误差是否向目标收敛。
6. 若方向、索引、起始姿态、声音、线缆或反馈任何一项异常，立即使用物理急停；不要重发、HOME 或 RESET。
7. 调试结束点击“停止并去使能”，只有读回 disabled 后才断开串口。

## 终端

终端可直接发送：

```text
#GETJPOS
#GETMODE
#GETENABLE
!START
!STOP
!DISABLE
#CMDMODE 1
#CMDMODE 2
#CMDMODE 3
>j1,j2,j3,j4,j5,j6,speed
```

前端不会自行增加 TX/RX。发送成功与否以 C# 网关返回及真实协议帧为准。六轴命令必须包含第七个速度参数。

## 失败与清理

### J2 或全部关节停止更新

Dummy 回包 `#GETJPOS` 的第二个数值直接映射 `protocolIndex=1 → joint_2 → UI J2`，没有额外符号或索引转换。若 J2 与其他状态一起停止更新，先检查协议帧中是否在某条无回包命令后不再出现三查询轮询；这表示 I/O 所有权停滞，不应修改关节映射或伪造 J2。当前 adapter 已改为有界读窗口，direct 也进入可取消命令所有权；回归覆盖断开后重新连接并让 J2 从 `-70.85` 更新到 `-42.25`。

### 断开后的状态

成功断开后应像新的软件会话：session 为 offline/unavailable，active port、协议帧、命令历史、遥测、目标草稿和相机临时态清空，模型回到 Profile 软件启动姿态。已显式保存的动作程序、布局、偏好与导出文件保留。软件启动姿态不是实机 HOME，不得据此发送回位动作。

- 错误端口/无回包：点击断开，确认 session offline 后重新枚举；无需等待 validity 恢复。
- 请求超时或 transport error：物理结果未知，先物理急停，再检查串口和设备；不得自动重试运动。
- motor 明确 enabled 时普通断开会被拒绝：先执行停止并去使能，读回 disabled。
- 结束后确认页面 offline、网关无 active session；再用 `Ctrl+C` 结束网关。不要用进程强杀替代正常释放。

## 待记录的实机证据

- COM 端口和设备 InstanceId；
- 六个关节的索引、正方向、单位和起始反馈；
- 目标、速度、FIFO 应答、实测收敛曲线和最大误差；
- 停止/去使能回读与最终 offline；
- 任何未验证限制。不得把本次 engineering 结果写成正式运动包络。
