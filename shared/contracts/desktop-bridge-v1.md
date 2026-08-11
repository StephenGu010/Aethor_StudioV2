# DesktopBridgeV1

前端通过能力检测访问桌面壳，不假定自己运行在 WebView2 中。

```ts
interface DesktopBridgeCapabilities {
  available: boolean;
  minimize: boolean;
  toggleMaximize: boolean;
  close: boolean;
  exportDiagnostics: boolean;
}
```

桌面壳在任何应用脚本执行前注入一次 `DesktopBootstrapV1`：

```ts
interface DesktopBootstrapV1 {
  contractVersion: '1.0';
  gateway: {
    baseUrl: string;        // 仅 loopback origin
    sessionToken: string;   // 本次进程 32–256 printable ASCII
  } | null;                 // 网关启动失败时仍允许离线 UI
  capabilities: DesktopBridgeCapabilities;
}
```

窗口消息固定为 `DesktopBridgeRequestV1/ResponseV1`，只允许 `minimize / toggleMaximize / close / beginDrag / exportDiagnostics`。request ID 最长 128 字符；未知字段、未知动作和非当前应用 origin 全部拒绝。`exportDiagnostics` 只打开原生 ZIP 保存对话框，并由桌面壳写入经过再次脱敏的有界日志快照和运行环境摘要；它不能读取任意文件、选择输入文件、访问 shell、打开任意 URL 或发送串口命令。

桥接操作返回显式成功或 `unsupported / invalidRequest / hostFailure`。普通浏览器中窗口按钮保持禁用，不通过全屏 API 或 `window.close()` 伪装原生成功。会话 token 只保存在桌面父进程环境和当前 WebView JavaScript 内存，不写入构建产物、local storage、URL 或日志。

同一动作存在在途请求时，前端复用该请求，避免重复最小化、切换最大化、关闭或导出。`minimize / toggleMaximize / beginDrag` 等待 2 秒；`close` 等待 10 秒，以覆盖宿主最多 8 秒的安全网关退出；`exportDiagnostics` 等待 120 秒，以容纳人工选择文件位置和有界 ZIP 写入。超时只返回 `hostFailure`，不能推断原生动作、文件或设备状态成功。

诊断包固定为 `aethor.diagnostics.bundle.v1`。内容只有 `README.txt`、`manifest.json` 和最多五份 `logs/desktop.log[.1-4]`；每份日志不超过 6 MiB，总日志不超过 30 MiB。manifest 不保存导出路径、用户目录、PID、命令行或 session，ZIP 不包含串口终端导出、协议历史、命令审计、关节目标、Profile/URDF/STL 或 WebView 用户数据。导出前会再次遮蔽已注册的精确令牌、常见 token/header 形式和当前用户目录。保存取消或写入失败返回 `ok=false`，不会留下部分目标包。

`gateway=null` 只表示桌面壳以离线模式继续加载页面，不能提升为 `CONNECTED`。bootstrap 对象在应用脚本前注入并冻结；宿主只接受来自 `http://localhost` 虚拟主机的消息。
