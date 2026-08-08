import { Maximize2, Minus, Square, X } from 'lucide-react';
import { unavailableDesktopBridge } from '../../integrations/desktopBridge';
import { Hint } from '../ui/Hint';

export function DesktopChrome() {
  const bridge = unavailableDesktopBridge;

  return (
    <header className="desktopChrome">
      <div className="desktopChromeIdentity">
        <span className="brandGlyph" aria-hidden="true" />
        <span className="desktopChromeProduct">Aethor Studio <strong>V2</strong></span>
        <span className="desktopChromeMode">FRONTEND SHOWCASE</span>
      </div>
      <div className="desktopWindowControls" aria-label="窗口控制">
        <WindowControl label="最小化需要 WebView2 桌面壳" disabled={!bridge.capabilities.minimize}>
          <Minus size={14} />
        </WindowControl>
        <WindowControl label="最大化需要 WebView2 桌面壳" disabled={!bridge.capabilities.toggleMaximize}>
          {bridge.capabilities.available ? <Square size={12} /> : <Maximize2 size={13} />}
        </WindowControl>
        <WindowControl label="关闭需要 WebView2 桌面壳" disabled={!bridge.capabilities.close} danger>
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
  children
}: {
  label: string;
  disabled: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Hint content={label}>
      <button className={danger ? 'windowControl danger' : 'windowControl'} type="button" disabled={disabled} aria-label={label}>
        {children}
      </button>
    </Hint>
  );
}
