# ADR-0007：桌面进程与桥接边界

- 状态：Accepted
- 日期：2026-08-09
- 范围：Phase 8A Windows 桌面软件门

## 背景

前端需要在 Windows WebView2 中获得窗口控制能力，并使用本机 C# 网关，但浏览器页面不能直接拥有进程、串口或任意原生调用权限。桌面壳还必须保证一次启动只有一个实例、会话令牌不落盘、网关只监听 loopback，并在退出时不遗留子进程。

## 决策

1. `AethorStudioV2.Desktop` 是唯一桌面生命周期所有者；它启动并监督 `AethorStudioV2.Api`，但不拥有机器人领域状态。
2. 每次启动生成 32 字节加密随机会话令牌和随机 loopback 端口。令牌只通过子进程环境与 WebView2 启动脚本进入内存，不写入 URL、日志、local storage 或发布清单。
3. Web 内容通过虚拟主机 `http://localhost` 加载。导航、新窗口、权限和外部拖放均默认拒绝；只有包内资源和显式 loopback 网关连接可用。
4. `DesktopBridgeV1` 只暴露 `minimize / toggleMaximize / close / beginDrag`。请求严格校验版本、ID、动作和来源；浏览器模式不模拟原生成功。
5. 网关使用 Windows Job Object 的 `KILL_ON_JOB_CLOSE` 作为异常退出兜底。正常关闭先调用受令牌保护的 `POST /api/v1/host/shutdown`；只有无串口会话或设备已明确 disabled 才接受关闭，否则桌面壳失败关闭并保持窗口可见。
6. 本机状态统一放在 `%LOCALAPPDATA%\Aethor Studio V2`，包含有界日志、WebView2 数据、RobotProfiles、CrashDumps、Temp、布局版本和窗口位置。窗口位置恢复必须限制到当前显示器可见区域。
7. 8A 只产出自包含 win-x64 便携开发包。安装器、代码签名、升级/卸载、四档 DPI、网关崩溃重启和监督硬件回归属于 8B，不能由便携包冒充。
8. 桌面对自有子网关的 readiness 和安全关闭请求必须直连 loopback，固定绕过用户/系统代理并拒绝重定向。代理环境不能成为本机进程生命周期的一部分，也不能要求操作者以 `NO_PROXY` 修补产品行为。

## 结果

- 前端不依赖 WinForms 类型，桌面壳也不绕过 `RobotGatewayV1` 建立硬件通道。
- 关闭行为可能因设备 disable 状态不明确而被拒绝，这是有意的安全语义；物理急停仍是唯一独立安全装置。
- Job Object 只能证明子进程随父进程回收，不能证明设备物理状态；任何 COM4 结果仍需单独现场验收。
- WebView2 使用 loopback 跨源访问网关时，CORS 只允许显式 origin、方法和 SignalR 所需请求头，不使用 `AllowAnyOrigin` 或 `AllowAnyHeader`。
- 网关意外退出后只允许一次显式离线重启；旧桌面退出后，新进程必须携带 `--offline`，且不得创建网关或串口会话。

## 已验证证据

- 74 项桌面单元测试覆盖参数、路径、令牌、桥接、日志、窗口恢复、端口、代理隔离和进程启动边界。
- 当前自包含开发包共 688 个文件，其中 manifest 逐文件校验 687 项；离线 smoke 证明网关 ready、命令策略 disabled、会话 offline、关闭 202 且进程退出。`Legal/` 集中包含两个 Profile 的 NOTICE/provenance，以及 93 个生产组件的 SPDX 2.3 清单和法律附件；6 个包内许可正文缺口被机器摘要与 release verifier 明确阻断，不能冒充正式候选。
- 实际 WebView2 运行证明 REST、SignalR negotiate 与 hub 连接成功，运行段无 console error 或 Web exception；正常关闭后桌面与网关进程均为 0。
- 在 `HTTP_PROXY/HTTPS_PROXY=http://127.0.0.1:7877` 且无 `NO_PROXY` 的真实环境中，修复前桌面连续三个候选均健康检查超时；修复后单个候选取得 `/health/ready` 200 并稳定。终止该子网关后原生面板阻断工作区，真实点击“以离线模式重新启动”得到唯一 `--offline` 桌面、零网关，清理后两类进程均为 0。
