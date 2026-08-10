import { Maximize2, Minus, Square, X } from 'lucide-react';
import { desktopBridge, type DesktopBridgeV1 } from '../../integrations/desktopBridge';
import { Hint } from '../ui/Hint';

export function DesktopChrome({ bridge = desktopBridge }: { bridge?: DesktopBridgeV1 }) {
  const native = bridge.capabilities.available;

  return (
    <header
      className={native ? 'desktopChrome desktopChrome-native' : 'desktopChrome'}
      onPointerDown={(event) => {
        if (event.button === 0 && !(event.target as Element).closest('.desktopWindowControls')) {
          void bridge.beginDrag();
        }
      }}
      onDoubleClick={(event) => {
        if (!(event.target as Element).closest('.desktopWindowControls')) void bridge.toggleMaximize();
      }}
    >
      <div className="desktopChromeIdentity">
        <span className="brandGlyph" aria-hidden="true" />
        <span className="desktopChromeProduct">Aethor Studio <strong>V2</strong></span>
      </div>
      <div className="desktopWindowControls" aria-label="窗口控制">
        <WindowControl
          label={native ? '最小化窗口' : '最小化需要 WebView2 桌面壳'}
          disabled={!bridge.capabilities.minimize}
          onClick={() => bridge.minimize()}
        >
          <Minus size={14} />
        </WindowControl>
        <WindowControl
          label={native ? '最大化或还原窗口' : '最大化需要 WebView2 桌面壳'}
          disabled={!bridge.capabilities.toggleMaximize}
          onClick={() => bridge.toggleMaximize()}
        >
          {native ? <Square size={12} /> : <Maximize2 size={13} />}
        </WindowControl>
        <WindowControl
          label={native ? '关闭 Aethor Studio V2' : '关闭需要 WebView2 桌面壳'}
          disabled={!bridge.capabilities.close}
          onClick={() => bridge.close()}
          danger
        >
          <X size={14} />
        </WindowControl>
      </div>
    </header>
  );
}

function WindowControl({
  label,
  disabled,
  danger,
  children,
  onClick
}: {
  label: string;
  disabled: boolean;
  danger?: boolean;
  children: React.ReactNode;
  onClick: () => Promise<boolean>;
}) {
  return (
    <Hint content={label}>
      <button
        className={danger ? 'windowControl danger' : 'windowControl'}
        type="button"
        disabled={disabled}
        aria-label={label}
        onClick={() => void onClick()}
      >
        {children}
      </button>
    </Hint>
  );
}
