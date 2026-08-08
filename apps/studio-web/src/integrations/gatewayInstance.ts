import type { RobotGatewayV1 } from './robotGateway';
import { HttpRobotGateway } from './httpRobotGateway';
import { StaticShowcaseSource } from './staticShowcaseSource';

export function createRobotGateway(environment: Pick<ImportMetaEnv, 'VITE_AETHOR_GATEWAY_URL' | 'VITE_AETHOR_GATEWAY_SESSION_TOKEN'> = import.meta.env): RobotGatewayV1 {
  const baseUrl = environment.VITE_AETHOR_GATEWAY_URL?.trim() ?? '';
  const sessionToken = environment.VITE_AETHOR_GATEWAY_SESSION_TOKEN?.trim() ?? '';
  if (!baseUrl && !sessionToken) return new StaticShowcaseSource();
  if (!baseUrl || !sessionToken) return new StaticShowcaseSource('只读网关配置不完整；URL 与会话令牌必须同时提供');
  try {
    return new HttpRobotGateway({ baseUrl, sessionToken });
  } catch {
    return new StaticShowcaseSource('只读网关配置被拒绝；仅允许 loopback URL 和 32–256 字符会话令牌');
  }
}

export const robotGateway = createRobotGateway();
