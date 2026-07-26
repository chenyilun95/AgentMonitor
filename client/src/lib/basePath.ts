export function detectAppBasePath(pathname: string): string {
  const match = pathname.match(/^(\/labs\/[^/]+)(?:\/|$)/);
  return match?.[1] || '';
}

export const APP_BASE_PATH = detectAppBasePath(window.location.pathname);

export function withAppBasePath(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${APP_BASE_PATH}${normalizedPath}`;
}
