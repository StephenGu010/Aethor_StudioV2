export interface StaticAssetRetryContext {
  assetUrl: string;
  documentUrl: string;
  attempt: number;
  error: unknown;
}
export function shouldRetrySameOriginStaticAsset({
  assetUrl,
  documentUrl,
  attempt,
  error
}: StaticAssetRetryContext) {
  if (attempt >= 1 || !isSameOrigin(assetUrl, documentUrl)) return false;
  const targetStatus = getTargetStatus(error);
  if (targetStatus === 0) return true;
  return isNetworkFetchError(error);
}

function isSameOrigin(assetUrl: string, documentUrl: string) {
  try {
    return new URL(assetUrl, documentUrl).origin === new URL(documentUrl).origin;
  } catch {
    return false;
  }
}

function getTargetStatus(error: unknown) {
  if (!error || typeof error !== 'object' || !('target' in error)) return undefined;
  const target = error.target;
  if (!target || typeof target !== 'object' || !('status' in target)) return undefined;
  return typeof target.status === 'number' ? target.status : undefined;
}

function isNetworkFetchError(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const name = 'name' in error && typeof error.name === 'string' ? error.name : '';
  const message = 'message' in error && typeof error.message === 'string' ? error.message : '';
  return name === 'TypeError' && /fetch|network/i.test(message);
}
