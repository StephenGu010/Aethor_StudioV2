import { NavLink } from 'react-router-dom';
import { routes } from '../../app/routeMeta';

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebarBrand">
        <div className="wordmark">AETHOR STUDIO</div>
        <div className="wordmarkVersion">V2</div>
        <p>ROBOTICS ENGINEERING<br />CONTROL WORKSPACE</p>
      </div>
      <nav className="primaryNav" aria-label="主要工作区">
        {routes.map((route) => {
          const Icon = route.icon;
          return (
            <NavLink key={route.path} to={route.path} className={({ isActive }) => (isActive ? 'navItem active' : 'navItem')}>
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
        <div><span>PROFILE</span><strong>DUMMY-6DOF</strong></div>
        <div className="offlineBadge"><span className="statusDot muted" /><span>SHOWCASE DATA /<br />SERIAL OFFLINE</span></div>
      </div>
    </aside>
  );
}
