# DesktopBridgeV1

前端通过能力检测访问桌面壳，不假定自己运行在 WebView2 中。

```ts
interface DesktopBridgeCapabilities {
  available: boolean;
  minimize: boolean;
  toggleMaximize: boolean;
  close: boolean;
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

窗口消息固定为 `DesktopBridgeRequestV1/ResponseV1`，只允许 `minimize / toggleMaximize / close / beginDrag`。request ID 最长 128 字符；未知字段、未知动作和非当前应用 origin 全部拒绝。桥接不提供串口、文件、shell、任意 URL 或 raw 命令能力。

桥接操作返回显式成功或 `unsupported / invalidRequest / hostFailure`。普通浏览器中窗口按钮保持禁用，不通过全屏 API 或 `window.close()` 伪装原生成功。会话 token 只保存在桌面父进程环境和当前 WebView JavaScript 内存，不写入构建产物、local storage、URL 或日志。

同一动作存在在途请求时，前端复用该请求，避免重复最小化、切换最大化或关闭。`minimize / toggleMaximize / beginDrag` 等待 2 秒；`close` 等待 10 秒，以覆盖宿主最多 8 秒的安全网关退出。超时只返回 `hostFailure`，不能推断原生动作或设备状态成功。

`gateway=null` 只表示桌面壳以离线模式继续加载页面，不能提升为 `CONNECTED`。bootstrap 对象在应用脚本前注入并冻结；宿主只接受来自 `http://localhost` 虚拟主机的消息。
