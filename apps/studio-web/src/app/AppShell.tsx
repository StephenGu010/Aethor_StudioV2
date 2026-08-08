import { Outlet, useLocation } from 'react-router-dom';
import { DesktopChrome } from '../components/chrome/DesktopChrome';
import { Sidebar } from '../components/navigation/Sidebar';
import { StatusHeader } from '../components/status/StatusHeader';
import { routeForPath } from './routeMeta';

export function AppShell() {
  const location = useLocation();
  const route = routeForPath(location.pathname);

  return (
    <div className="desktopSurface">
      <DesktopChrome />
      <div className="appFrame">
        <Sidebar />
        <div className="appWorkspace">
          <StatusHeader route={route} />
          <main className="pageHost" aria-label={route.title}>
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}

