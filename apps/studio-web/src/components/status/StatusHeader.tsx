import { ChevronDown, ShieldAlert } from 'lucide-react';
import type { RouteMeta } from '../../app/routeMeta';
import { dummyProfile } from '../../profile/dummyProfile';
import { Hint } from '../ui/Hint';

export function StatusHeader({ route }: { route: RouteMeta }) {
  return (
    <header className="statusHeader">
      <div className="pageIdentity">
        <h1>{route.title}</h1>
        <span>{route.subtitle}</span>
      </div>
      <button className="deviceSelector" type="button" aria-label="当前机器人配置" disabled>
        <span>
          <small>CURRENT PROFILE</small>
          <strong>{dummyProfile.displayName.toUpperCase()} · {dummyProfile.model.dof}-DOF</strong>
        </span>
        <ChevronDown size={15} />
      </button>
      <div className="headerTelemetry">
        <StatusMetric label="SERIAL" value="OFFLINE" tone="muted" />
        <StatusMetric label="MOTOR" value="UNKNOWN" tone="muted" />
        <StatusMetric label="FEEDBACK" value="SHOWCASE" tone="warning" />
        <StatusMetric label="LATENCY" value="N/A" tone="muted" />
        <StatusMetric label="URDF" value="LOADED" tone="ok" />
      </div>
      <Hint content="后端未连接，无法确认设备停机。请使用物理急停。">
        <button className="emergencyButton" type="button" disabled>
          <ShieldAlert size={16} />
          软件急停
        </button>
      </Hint>
    </header>
  );
}

function StatusMetric({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'warning' | 'muted' }) {
  return (
    <div className="statusMetric">
      <span className={`statusDot ${tone}`} />
      <span><small>{label}</small><strong>{value}</strong></span>
    </div>
  );
}

