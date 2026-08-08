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

桥接操作返回显式成功或不支持结果。普通浏览器中窗口按钮保持禁用，不通过全屏 API 或 `window.close()` 伪装原生成功。

