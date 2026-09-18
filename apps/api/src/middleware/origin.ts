export function isAllowedWebOrigin(origin: string, configuredOrigin: string): boolean {
  if (origin === configuredOrigin) return true;
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && url.hostname.endsWith('.kasuro-pos-web.pages.dev');
  } catch {
    return false;
  }
}
