import { Cable, ChartNoAxesCombined, ListChecks, PanelsTopLeft, type LucideIcon, Waypoints } from 'lucide-react';

export interface RouteMeta {
  path: string;
  sequence: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
}

export const routes: RouteMeta[] = [
  { path: '/console', sequence: '01', title: '控制台', subtitle: 'Robot control console', icon: PanelsTopLeft },
  { path: '/scope', sequence: '02', title: '数据示波', subtitle: 'Signal scope', icon: ChartNoAxesCombined },
  { path: '/terminal', sequence: '03', title: '串口终端', subtitle: 'Serial terminal', icon: Cable },
  { path: '/devices', sequence: '04', title: '设备与模型', subtitle: 'Device & model', icon: Waypoints },
  { path: '/actions', sequence: '05', title: '动作编排', subtitle: 'Action program', icon: ListChecks }
];

export function routeForPath(pathname: string): RouteMeta {
  if (pathname === '/twin') return routes[0]!;
  return routes.find((route) => route.path === pathname) ?? routes[0]!;
}
