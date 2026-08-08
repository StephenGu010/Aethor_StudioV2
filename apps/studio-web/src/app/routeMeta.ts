import { Box, Cable, ChartNoAxesCombined, ListChecks, type LucideIcon, Waypoints } from 'lucide-react';

export interface RouteMeta {
  path: string;
  sequence: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
}

export const routes: RouteMeta[] = [
  { path: '/twin', sequence: '01', title: '数字孪生', subtitle: 'TWIN CONSOLE', icon: Box },
  { path: '/scope', sequence: '02', title: '数据示波', subtitle: 'SIGNAL SCOPE', icon: ChartNoAxesCombined },
  { path: '/terminal', sequence: '03', title: '串口终端', subtitle: 'SERIAL TERMINAL', icon: Cable },
  { path: '/devices', sequence: '04', title: '设备与模型', subtitle: 'DEVICE & MODEL', icon: Waypoints },
  { path: '/actions', sequence: '05', title: '动作编排', subtitle: 'ACTION PROGRAM', icon: ListChecks }
];

export function routeForPath(pathname: string): RouteMeta {
  return routes.find((route) => route.path === pathname) ?? routes[0]!;
}
