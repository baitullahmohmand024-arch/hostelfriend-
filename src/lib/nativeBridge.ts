import { Browser } from '@capacitor/browser';
import { Share } from '@capacitor/share';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { isNativePlatform } from './nativePlatform';
import { ThemeDefinition } from './theme';

export interface NativeShareInput {
  title: string;
  text: string;
  url: string;
  dialogTitle?: string;
}

export type NativeShareOutcome = 'shared' | 'cancelled' | 'unsupported';

function isCancellationError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const record = err as { name?: string; message?: string; code?: string };
  const msg = String(record.message || '').toLowerCase();
  return (
    record.name === 'AbortError' ||
    msg.includes('cancel') ||
    msg.includes('abort') ||
    msg.includes('dismissed')
  );
}

/**
 * Triggers the native Android share sheet via @capacitor/share when running inside Capacitor,
 * or falls back to Web Share API on browsers. Returns 'unsupported' when neither is available.
 */
export async function shareNativeContent(input: NativeShareInput): Promise<NativeShareOutcome> {
  if (isNativePlatform()) {
    try {
      await Share.share({
        title: input.title,
        text: input.text,
        url: input.url,
        dialogTitle: input.dialogTitle || input.title,
      });
      return 'shared';
    } catch (err) {
      if (isCancellationError(err)) {
        return 'cancelled';
      }
      throw err;
    }
  }

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: input.title,
        text: input.text,
        url: input.url,
      });
      return 'shared';
    } catch (err) {
      if (isCancellationError(err)) {
        return 'cancelled';
      }
      throw err;
    }
  }

  return 'unsupported';
}

/**
 * Validates and opens an external URL using @capacitor/browser on native Android
 * so external links never trap the main application WebView.
 */
export async function openExternalUrl(rawUrl: string, toolbarColor = '#050505'): Promise<void> {
  if (typeof window === 'undefined' || !rawUrl) return;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return;
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol === 'mailto:' || protocol === 'tel:') {
    window.location.href = parsed.toString();
    return;
  }

  if (protocol !== 'https:' && protocol !== 'http:') {
    return;
  }

  if (isNativePlatform()) {
    try {
      await Browser.open({
        url: parsed.toString(),
        toolbarColor,
      });
      return;
    } catch {
      // Fallback to standard browser navigation only if Custom Tabs plugin fails
    }
  }

  window.open(parsed.toString(), '_blank', 'noopener,noreferrer');
}

/**
 * Synchronizes native Android status bar icon contrast and background with the active theme.
 */
export async function syncNativeStatusBar(theme: ThemeDefinition): Promise<void> {
  if (!isNativePlatform()) return;
  try {
    await StatusBar.setOverlaysWebView({ overlay: false });
  } catch {
    // Safe no-op on Android 15+ edge-to-edge where overlay is system-managed
  }
  try {
    await StatusBar.setStyle({
      style: theme.isLight ? Style.Light : Style.Dark,
    });
  } catch {
    // Ignore status bar style failures on older/custom OEM builds
  }
  try {
    await StatusBar.setBackgroundColor({ color: theme.themeColor });
  } catch {
    // Ignored safely on Android 15+ edge-to-edge
  }
}

let splashHidden = false;

/**
 * Hides the native Android splash screen once initial auth/app hydration completes.
 */
export async function hideNativeSplashScreen(): Promise<void> {
  if (!isNativePlatform() || splashHidden) return;
  splashHidden = true;
  try {
    await SplashScreen.hide({ fadeOutDuration: 200 });
  } catch {
    // Ignore if splash is already dismissed
  }
}
