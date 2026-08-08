import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './app/AppShell';

const DeviceModelPage = lazy(() => import('./pages/device-model/DeviceModelPage').then((module) => ({ default: module.DeviceModelPage })));
const DigitalTwinPage = lazy(() => import('./pages/digital-twin/DigitalTwinPage').then((module) => ({ default: module.DigitalTwinPage })));
const ScopePage = lazy(() => import('./pages/scope/ScopePage').then((module) => ({ default: module.ScopePage })));
const TerminalPage = lazy(() => import('./pages/terminal/TerminalPage').then((module) => ({ default: module.TerminalPage })));
const ActionProgrammingPage = lazy(() => import('./pages/action-programming/ActionProgrammingPage').then((module) => ({ default: module.ActionProgrammingPage })));

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/twin" element={<PageBoundary><DigitalTwinPage /></PageBoundary>} />
        <Route path="/scope" element={<PageBoundary><ScopePage /></PageBoundary>} />
        <Route path="/terminal" element={<PageBoundary><TerminalPage /></PageBoundary>} />
        <Route path="/devices" element={<PageBoundary><DeviceModelPage /></PageBoundary>} />
        <Route path="/actions" element={<PageBoundary><ActionProgrammingPage /></PageBoundary>} />
        <Route path="/" element={<Navigate replace to="/twin" />} />
        <Route path="*" element={<Navigate replace to="/twin" />} />
      </Route>
    </Routes>
  );
}

function PageBoundary({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="routeLoading"><span className="statusDot warning" /> LOADING WORKSPACE</div>}>{children}</Suspense>;
}
