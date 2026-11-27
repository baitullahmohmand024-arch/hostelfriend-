import { formatUserFriendlyError } from './firestoreError';

export interface AuthErrorDetails {
  code: string;
  message: string;
  lower: string;
}

export function extractAuthErrorDetails(err: unknown): AuthErrorDetails {
  const errObj = err as { code?: unknown; message?: unknown; errorMessage?: unknown } | null | undefined;
  const code = String(errObj?.code || '').trim();
  const rawMessage =
    err instanceof Error
      ? err.message
      : typeof errObj?.message === 'string'
        ? errObj.message
        : typeof errObj?.errorMessage === 'string'
          ? errObj.errorMessage
          : typeof err === 'string'
            ? err
            : '';
  const message = rawMessage.trim();
  return {
    code,
    message,
    lower: message.toLowerCase(),
  };
}

/**
 * Detects Google Play Services / Credential Manager configuration, cooldown,
 * or missing-credential errors that are NOT genuine user cancellations—even
 * when the underlying message contains words like "canceled" (e.g. "too many
 * canceled sign-in prompts") or status code 16.
 */
export function isPlayServicesConfigOrCooldownError(err: unknown): boolean {
  const { lower } = extractAuthErrorDetails(err);
  if (!lower) return false;

  return (
    lower.includes('will_be_overridden') ||
    lower.includes('default_web_client_id') ||
    lower.includes('developer') ||
    /(?:^|\D)10(?::|\b)/.test(lower) ||
    lower.includes('12500') ||
    lower.includes('284') ||
    lower.includes('cannot find a matching credential') ||
    lower.includes('no credentials available') ||
    lower.includes('no credential') ||
    lower.includes('temporarily blocked') ||
    lower.includes('too many canceled') ||
    lower.includes('reauth') ||
    lower.includes('credential manager') ||
    lower.includes('provider') ||
    lower.includes('configuration') ||
    lower.includes('not available') ||
    lower.includes('unsupported') ||
    lower.includes('play services') ||
    lower.includes('interrupted') ||
    lower.includes('network') ||
    lower.includes('timeout') ||
    lower.includes('failed')
  );
}

/**
 * Returns true only for genuine user-initiated cancellations (web popup closed,
 * Play Services 12501 SIGN_IN_CANCELLED, or Credential Manager cancellation
 * without underlying configuration/cooldown error indicators).
 */
export function isGenuineGoogleCancelError(err: unknown): boolean {
  const { code, lower } = extractAuthErrorDetails(err);

  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return true;
  }

  if (isPlayServicesConfigOrCooldownError(err)) {
    return false;
  }

  return (
    lower.includes('12501') ||
    lower.includes('cancel') ||
    lower.includes('dismiss')
  );
}

/**
 * Determines whether a failed Android Credential Manager attempt should fall
 * back to the classic GoogleSignInClient activity flow.
 * - Always falls back on Play Services/Credential Manager errors (including code
 *   16 cooldown/no-matching-credential and config/provider errors).
 * - Also falls back if Credential Manager aborted immediately (< 450ms) before
 *   the user could realistically interact with the account sheet.
 */
export function shouldFallbackToLegacyGoogleSignIn(err: unknown, elapsedMs?: number): boolean {
  if (isPlayServicesConfigOrCooldownError(err)) {
    return true;
  }
  if (!isGenuineGoogleCancelError(err)) {
    return true;
  }
  if (typeof elapsedMs === 'number' && elapsedMs < 450) {
    return true;
  }
  return false;
}

export function formatGoogleAuthError(
  err: unknown,
  fallback = 'Google sign-in failed. Please try again.'
): string {
  const { code, lower, message } = extractAuthErrorDetails(err);

  if (code === 'auth/popup-blocked') {
    return 'Pop-up was blocked by your browser. Please allow pop-ups and try again.';
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'Google sign-in popup was closed before completion.';
  }
  if (code === 'auth/account-exists-with-different-credential') {
    return 'An account already exists with this email. Sign in with your existing method first, then connect Google in Settings.';
  }
  if (code === 'auth/operation-not-allowed') {
    return 'Google Sign-In is not enabled in Firebase Console -> Authentication -> Sign-in method.';
  }
  if (code === 'auth/invalid-credential') {
    return 'Google ID token could not be verified by Firebase. Verify default_web_client_id in google-services.json matches your Firebase project.';
  }

  if (isGenuineGoogleCancelError(err)) {
    return 'Google sign-in was cancelled before completion.';
  }

  if (lower.includes('will_be_overridden') || lower.includes('default_web_client_id')) {
    return 'Android Google Sign-In is missing its Web Client ID (default_web_client_id). Re-download google-services.json after enabling Google Sign-In in Firebase Console.';
  }

  if (lower.includes('developer') || /(?:^|\D)10(?::|\b)/.test(lower)) {
    return 'Google Sign-In configuration mismatch (Error 10). Add the APK signing SHA-1 and SHA-256 fingerprints for com.hostelfriend.app in Firebase Console and update google-services.json.';
  }

  if (lower.includes('12500')) {
    return 'Google Sign-In failed (Error 12500). Verify the OAuth consent screen support email and Web Client ID in Firebase Console.';
  }

  if (lower.includes('12502')) {
    return 'A Google sign-in attempt is already in progress. Please wait a moment and try again.';
  }

  if (
    lower.includes('temporarily blocked') ||
    lower.includes('too many canceled') ||
    lower.includes('cannot find a matching credential') ||
    lower.includes('no credential')
  ) {
    return 'No Google credential could be retrieved on this device. Ensure a Google account is signed in on your phone and verify Firebase SHA-1 fingerprints.';
  }

  if (code === 'auth/network-request-failed' || lower.includes('network') || /(?:^|\D)7(?::|\b)/.test(lower)) {
    return 'Network error during Google Sign-In. Check your internet connection and try again.';
  }

  if (message) {
    return formatUserFriendlyError(err, fallback);
  }

  return fallback;
}
