import { Outlet, useLocation } from 'react-router-dom';
import { DesktopChrome } from '../components/chrome/DesktopChrome';
import { Sidebar } from '../components/navigation/Sidebar';
import { GlobalSafetyAlert } from '../components/status/GlobalSafetyAlert';
import { StatusHeader } from '../components/status/StatusHeader';
import { GatewaySessionCoordinator } from '../integrations/GatewaySessionCoordinator';
import { AethorTwinTelemetryCoordinator } from '../integrations/AethorTwinTelemetryCoordinator';
import { dummyProfile } from '../profile/dummyProfile';
import { useActiveRobotProfileStore } from '../stores/useActiveRobotProfileStore';
import { useGatewayRuntimeStore } from '../stores/useGatewayRuntimeStore';
import { routeForPath } from './routeMeta';

export function AppShell() {
  const location = useLocation();
  const route = routeForPath(location.pathname);
  const activeProfileId = useActiveRobotProfileStore((state) => state.activeProfileId);
  const isDummyActive = activeProfileId === dummyProfile.profileId;
  const hasRuntimeNotice = useGatewayRuntimeStore((state) => isDummyActive && (state.latchedSafetyResult !== null
    || state.commandAuditStatus === 'error'
    || state.transportWarning !== null
    || (state.session.source === 'measured' && state.session.validity !== 'valid')
    || (state.jointState.source === 'measured' && state.jointState.validity !== 'valid')));

  return (
    <div className="desktopSurface">
      <DesktopChrome />
      {isDummyActive && <GatewaySessionCoordinator />}
      {!isDummyActive && <AethorTwinTelemetryCoordinator />}
      <div className="appFrame">
        <Sidebar />
        <div className={`appWorkspace${hasRuntimeNotice ? ' hasRuntimeNotice' : ''}`}>
          <StatusHeader route={route} />
          {isDummyActive && <GlobalSafetyAlert />}
          <main className="pageHost" aria-label={route.title}>
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
