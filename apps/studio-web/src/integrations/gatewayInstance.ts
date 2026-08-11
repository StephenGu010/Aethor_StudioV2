import type { RobotGatewayV1 } from './robotGateway';
import { HttpRobotGateway } from './httpRobotGateway';
import { StaticShowcaseSource } from './staticShowcaseSource';
import { readDesktopBootstrap } from './desktopBridge';

export function createRobotGateway(
  environment: Pick<ImportMetaEnv, 'VITE_AETHOR_GATEWAY_URL' | 'VITE_AETHOR_GATEWAY_SESSION_TOKEN'> = import.meta.env,
  desktopBootstrap = readDesktopBootstrap()
): RobotGatewayV1 {
  const { baseUrl, sessionToken } = resolveRobotGatewayConfig(environment, desktopBootstrap);
  if (!baseUrl && !sessionToken) return new StaticShowcaseSource();
  if (!baseUrl || !sessionToken) return new StaticShowcaseSource('只读网关配置不完整；URL 与会话令牌必须同时提供');
  try {
    return new HttpRobotGateway({ baseUrl, sessionToken });
  } catch {
    return new StaticShowcaseSource('只读网关配置被拒绝；仅允许 loopback URL 和 32–256 字符会话令牌');
  }
}

export function resolveRobotGatewayConfig(
  environment: Pick<ImportMetaEnv, 'VITE_AETHOR_GATEWAY_URL' | 'VITE_AETHOR_GATEWAY_SESSION_TOKEN'>,
  desktopBootstrap: ReturnType<typeof readDesktopBootstrap>
) {
  // A valid desktop bootstrap is authoritative, including its explicit
  // gateway=null offline state. Build-time development settings must never
  // redirect a packaged WebView away from the child process owned by its shell.
  if (desktopBootstrap) {
    return {
      baseUrl: desktopBootstrap.gateway?.baseUrl ?? '',
      sessionToken: desktopBootstrap.gateway?.sessionToken ?? ''
    };
  }
  return {
    baseUrl: environment.VITE_AETHOR_GATEWAY_URL?.trim() ?? '',
    sessionToken: environment.VITE_AETHOR_GATEWAY_SESSION_TOKEN?.trim() ?? ''
  };
}

export const robotGateway = createRobotGateway();
