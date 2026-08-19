import { NavLink } from 'react-router-dom';
import { routes } from '../../app/routeMeta';
import { getRobotProfileOption } from '../../profile/profileCatalog';
import { useActiveRobotProfileStore } from '../../stores/useActiveRobotProfileStore';

export function Sidebar() {
  const activeProfileId = useActiveRobotProfileStore((state) => state.activeProfileId);
  const activeProfile = getRobotProfileOption(activeProfileId).profile;
  return (
    <aside className="sidebar">
      <div className="sidebarBrand">
        <div className="sidebarBrandLockup" aria-label="Aethor Studio V2">
          <div className="wordmark">AETHOR STUDIO</div>
          <div className="wordmarkVersion">V2</div>
        </div>
      </div>
      <nav className="primaryNav" aria-label="主要工作区">
        {routes.map((route) => {
          const Icon = route.icon;
          return (
            <NavLink
              key={route.path}
              to={route.path}
              className={({ isActive }) => (isActive ? 'navItem active' : 'navItem')}
            >
              <span className="navSequence">{route.sequence}</span>
              <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
              <span>
                <strong>{route.title}</strong>
                <small>{route.subtitle}</small>
              </span>
            </NavLink>
          );
        })}
      </nav>
      <div className="sidebarFooter">
        <div><span>VERSION</span><strong>0.1.0</strong></div>
        <div><span>PROFILE</span><strong title={activeProfile.displayName}>{activeProfile.displayName}</strong></div>
        <div className="offlineBadge"><span className="statusDot muted" /><span>SHOWCASE DATA /<br />SERIAL OFFLINE</span></div>
      </div>
    </aside>
  );
}
