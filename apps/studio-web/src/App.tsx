import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './app/AppShell';
import { ProfileWorkspaceGate } from './components/workbench/ProfileWorkspaceGate';
import { dummyProfile } from './profile/dummyProfile';

const DeviceModelPage = lazy(() => import('./pages/device-model/DeviceModelPage').then((module) => ({ default: module.DeviceModelPage })));
const ConsolePage = lazy(() => import('./pages/console/ConsolePage').then((module) => ({ default: module.ConsolePage })));
const ScopePage = lazy(() => import('./pages/scope/ScopePage').then((module) => ({ default: module.ScopePage })));
const TerminalPage = lazy(() => import('./pages/terminal/TerminalPage').then((module) => ({ default: module.TerminalPage })));
const ActionProgrammingPage = lazy(() => import('./pages/action-programming/ActionProgrammingPage').then((module) => ({ default: module.ActionProgrammingPage })));

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/console" element={<PageBoundary><ConsolePage /></PageBoundary>} />
        <Route path="/twin" element={<Navigate replace to="/console" />} />
        <Route path="/scope" element={<PageBoundary><ProfileWorkspaceGate supportedProfileId={dummyProfile.profileId} workspaceName="数据示波"><ScopePage /></ProfileWorkspaceGate></PageBoundary>} />
        <Route path="/terminal" element={<PageBoundary><ProfileWorkspaceGate supportedProfileId={dummyProfile.profileId} workspaceName="串口终端"><TerminalPage /></ProfileWorkspaceGate></PageBoundary>} />
        <Route path="/devices" element={<PageBoundary><DeviceModelPage /></PageBoundary>} />
        <Route path="/actions" element={<PageBoundary><ProfileWorkspaceGate supportedProfileId={dummyProfile.profileId} workspaceName="动作编排"><ActionProgrammingPage /></ProfileWorkspaceGate></PageBoundary>} />
        <Route path="/" element={<Navigate replace to="/console" />} />
        <Route path="*" element={<Navigate replace to="/console" />} />
      </Route>
    </Routes>
  );
}

function PageBoundary({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="routeLoading"><span className="statusDot warning" /> LOADING WORKSPACE</div>}>{children}</Suspense>;
}
