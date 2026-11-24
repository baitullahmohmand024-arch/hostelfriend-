import { Capacitor } from '@capacitor/core';

export const CANONICAL_PUBLIC_APP_URL = 'https://facebook-like-mu.vercel.app';

/**
 * Returns true when running inside a native Capacitor container (e.g., Android/iOS APK),
 * and false when running in a standard desktop/mobile web browser or installed PWA.
 */
export function isNativePlatform(): boolean {
  try {
    return typeof window !== 'undefined' && Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * Returns true specifically when running inside the native Android Capacitor shell.
 */
export function isAndroidNative(): boolean {
  try {
    return isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

/**
 * Returns the canonical public app origin for shareable URLs.
 * - Native Android/Capacitor: always returns the canonical Vercel URL instead of https://localhost.
 * - Web/PWA: preserves the current window.location.origin.
 */
export function getPublicAppUrl(): string {
  if (isNativePlatform()) {
    return CANONICAL_PUBLIC_APP_URL;
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, '');
  }
  return CANONICAL_PUBLIC_APP_URL;
}

/**
 * Returns the base URL for /api/* requests.
 * - Web/PWA: returns '' so relative same-origin API calls stay unchanged.
 * - Native Android/Capacitor: returns the canonical Vercel origin.
 */
export function getApiBaseUrl(): string {
  return isNativePlatform() ? CANONICAL_PUBLIC_APP_URL : '';
}

/**
 * Resolves a relative API path (e.g., '/api/upload') for the active runtime environment.
 */
export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getApiBaseUrl()}${normalizedPath}`;
}
