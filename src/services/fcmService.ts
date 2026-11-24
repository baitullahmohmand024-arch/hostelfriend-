import { FirebaseMessaging, Importance, Visibility } from '@capacitor-firebase/messaging';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { getMessaging, getToken, isSupported, MessagePayload, onMessage } from 'firebase/messaging';
import { app, db } from '../lib/firebase';
import { isAndroidNative, isNativePlatform } from '../lib/nativePlatform';
import { FcmTokenRecord } from '../types';

const TOKEN_ID_STORAGE_KEY = 'hostel_friend_fcm_token_id';

export type PushSupportState =
  | 'supported'
  | 'unsupported-browser'
  | 'ios-needs-install'
  | 'insecure-context'
  | 'missing-vapid';

export interface NativeNotificationTapPayload {
  link?: string;
  data: Record<string, string>;
}

let androidChannelsPromise: Promise<void> | null = null;
let activeForegroundBridgeCount = 0;

export function detectDevicePlatform(): FcmTokenRecord['platform'] {
  if (isAndroidNative()) return 'android-app';
  if (typeof window === 'undefined') return 'web';
  const ua = window.navigator.userAgent || '';
  const standalone =
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (/iPad|iPhone|iPod/.test(ua) && standalone) return 'ios-pwa';
  if (/Android/i.test(ua) && standalone) return 'android-pwa';
  return 'web';
}

export function isIosBrowserWithoutPwa(): boolean {
  if (isNativePlatform()) return false;
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent || '';
  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
  if (!isIos) return false;
  const standalone =
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return !standalone;
}

export function getConfiguredVapidKey(): string {
  const raw = String(import.meta.env.VITE_FIREBASE_VAPID_KEY || '')
    .trim()
    .replace(/^["']|["']$/g, '');
  if (!raw || raw === 'MY_FIREBASE_WEB_PUSH_VAPID_KEY') return '';
  return raw;
}

export function isValidVapidPublicKeyFormat(key: string): boolean {
  return /^[A-Za-z0-9_-]{60,140}$/.test(key);
}

export async function getPushSupportState(): Promise<PushSupportState> {
  if (typeof window === 'undefined') return 'unsupported-browser';
  if (isAndroidNative()) {
    const res = await FirebaseMessaging.isSupported().catch(() => ({ isSupported: true }));
    return res.isSupported ? 'supported' : 'unsupported-browser';
  }
  if (isNativePlatform()) {
    return 'unsupported-browser';
  }
  if (!window.isSecureContext && window.location.hostname !== 'localhost') {
    return 'insecure-context';
  }
  if (isIosBrowserWithoutPwa()) {
    return 'ios-needs-install';
  }
  if (
    !('Notification' in window) ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window)
  ) {
    return 'unsupported-browser';
  }
  const supported = await isSupported().catch(() => false);
  if (!supported) {
    return 'unsupported-browser';
  }
  const vapidKey = getConfiguredVapidKey();
  if (!vapidKey) {
    return 'missing-vapid';
  }
  return 'supported';
}

export function getBrowserNotificationPermission(): NotificationPermission | 'unsupported' {
  if (isNativePlatform()) {
    return 'default';
  }
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

export async function getNotificationPermissionState(): Promise<
  NotificationPermission | 'unsupported'
> {
  if (isAndroidNative()) {
    try {
      const status = await FirebaseMessaging.checkPermissions();
      if (status.receive === 'granted') return 'granted';
      if (status.receive === 'denied') return 'denied';
      return 'default';
    } catch {
      return 'default';
    }
  }
  if (isNativePlatform()) {
    return 'unsupported';
  }
  return getBrowserNotificationPermission();
}

export async function ensureAndroidNotificationChannels(): Promise<void> {
  if (!isAndroidNative()) return;
  if (androidChannelsPromise) return androidChannelsPromise;

  androidChannelsPromise = (async () => {
    const channels = [
      {
        id: 'messages',
        name: 'Messages',
        description: 'Direct messages from hostel friends',
        importance: Importance.High,
        visibility: Visibility.Private,
        lights: true,
        lightColor: '#F5C542',
        vibration: true,
      },
      {
        id: 'engagement',
        name: 'Reactions & Comments',
        description: 'Reactions, comments, replies, mentions, and friend requests',
        importance: Importance.Default,
        visibility: Visibility.Public,
        lights: true,
        lightColor: '#F5C542',
        vibration: true,
      },
      {
        id: 'announcements',
        name: 'Announcements',
        description: 'Important Hostel Friend announcements and campus updates',
        importance: Importance.High,
        visibility: Visibility.Public,
        lights: true,
        lightColor: '#F5C542',
        vibration: true,
      },
    ];

    await Promise.all(
      channels.map((ch) => FirebaseMessaging.createChannel(ch).catch(() => {}))
    );
  })().catch(() => {
    androidChannelsPromise = null;
  });

  return androidChannelsPromise;
}

async function getActiveMessagingServiceWorker(timeoutMs = 12000): Promise<ServiceWorkerRegistration> {
  let reg = await navigator.serviceWorker.getRegistration('/');
  if (!reg) {
    reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } else {
    void reg.update().catch(() => {});
  }

  const readyPromise = navigator.serviceWorker.ready;
  const timeoutPromise = new Promise<never>((_, reject) => {
    window.setTimeout(() => {
      reject(
        new Error(
          'Service worker did not activate in time. Reload the page on HTTPS (not an embedded preview or private tab) and try again.'
        )
      );
    }, timeoutMs);
  });

  const readyReg = await Promise.race([readyPromise, timeoutPromise]);
  if (readyReg.waiting) {
    readyReg.waiting.postMessage({ type: 'SKIP_WAITING' });
  }
  if (readyReg.active) return readyReg;

  const pendingWorker = readyReg.installing || readyReg.waiting || reg.installing || reg.waiting;
  if (!pendingWorker) return readyReg;

  await new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, 4000);
    const onStateChange = () => {
      if (pendingWorker.state === 'activated' || pendingWorker.state === 'redundant') {
        window.clearTimeout(timer);
        pendingWorker.removeEventListener('statechange', onStateChange);
        resolve();
      }
    };
    pendingWorker.addEventListener('statechange', onStateChange);
  });

  return readyReg;
}

async function hashTokenToDocId(token: string): Promise<string> {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const encoded = new TextEncoder().encode(token);
      const digest = await crypto.subtle.digest('SHA-256', encoded);
      const hex = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      return `tok_${hex.slice(0, 40)}`;
    }
  } catch {
    // Fallback deterministic safe key
  }
  let hash = 0;
  for (let i = 0; i < token.length; i += 1) {
    hash = (hash * 31 + token.charCodeAt(i)) | 0;
  }
  return `tok_${Math.abs(hash)}_${token.slice(-12).replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

async function upsertFcmTokenRecord(uid: string, token: string): Promise<string> {
  const tokenId = await hashTokenToDocId(token);
  const tokenRef = doc(db, 'users', uid, 'fcmTokens', tokenId);
  const existing = await getDoc(tokenRef).catch(() => null);
  const platform = detectDevicePlatform();
  const userAgent =
    typeof navigator !== 'undefined' ? (navigator.userAgent || '').slice(0, 300) : '';

  if (existing?.exists()) {
    await setDoc(
      tokenRef,
      {
        id: tokenId,
        uid,
        token,
        platform,
        userAgent,
        createdAt: existing.data()?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } else {
    await setDoc(tokenRef, {
      id: tokenId,
      uid,
      token,
      platform,
      userAgent,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  try {
    localStorage.setItem(TOKEN_ID_STORAGE_KEY, tokenId);
  } catch {
    // Ignore storage quota errors
  }

  return tokenId;
}

export async function registerFcmTokenForUser(
  uid: string,
  promptPermission: boolean
): Promise<{ ok: boolean; token?: string; reason?: string }> {
  try {
    if (isAndroidNative()) {
      const support = await getPushSupportState();
      if (support !== 'supported') {
        return {
          ok: false,
          reason: 'Push notifications are unavailable on this Android build.',
        };
      }

      let perm = await FirebaseMessaging.checkPermissions();
      if (
        (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') &&
        promptPermission
      ) {
        perm = await FirebaseMessaging.requestPermissions();
      }
      if (perm.receive !== 'granted') {
        return {
          ok: false,
          reason:
            perm.receive === 'denied'
              ? 'Notification permission is off in Android App Info -> Notifications. Enable it there and try again.'
              : 'Notification permission not granted yet.',
        };
      }

      await ensureAndroidNotificationChannels();
      const { token } = await FirebaseMessaging.getToken();
      if (!token) {
        return {
          ok: false,
          reason:
            'Could not obtain an Android push token. Ensure google-services.json and Google Play services are configured.',
        };
      }

      await upsertFcmTokenRecord(uid, token);
      return { ok: true, token };
    }

    const support = await getPushSupportState();
    if (support === 'ios-needs-install') {
      return {
        ok: false,
        reason: 'On iPhone/iPad, tap Share -> Add to Home Screen first to enable push notifications.',
      };
    }
    if (support === 'missing-vapid') {
      return {
        ok: false,
        reason: 'Firebase Web Push VAPID key (VITE_FIREBASE_VAPID_KEY) is not configured yet.',
      };
    }
    if (support === 'insecure-context') {
      return {
        ok: false,
        reason: 'Push notifications require an HTTPS connection.',
      };
    }
    if (support !== 'supported') {
      return {
        ok: false,
        reason: 'Push notifications are not supported in this browser or embedded frame.',
      };
    }

    const vapidKey = getConfiguredVapidKey();
    if (!isValidVapidPublicKeyFormat(vapidKey)) {
      return {
        ok: false,
        reason:
          'VITE_FIREBASE_VAPID_KEY format is invalid. Paste the public Web Push certificate key from Firebase Console without quotes or spaces.',
      };
    }

    let permission = Notification.permission;
    if (permission === 'default' && promptPermission) {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') {
      return {
        ok: false,
        reason:
          permission === 'denied'
            ? 'Notification permission is blocked in browser site settings. Tap the lock/site icon in Chrome and allow Notifications.'
            : 'Notification permission not granted yet.',
      };
    }

    const registration = await getActiveMessagingServiceWorker();
    const messaging = getMessaging(app);

    let token = '';
    try {
      token = await getToken(messaging, {
        vapidKey,
        serviceWorkerRegistration: registration,
      });
    } catch (tokenErr) {
      // If a stale browser PushSubscription exists from an older/different VAPID key, clear it and retry once
      const errMsg = tokenErr instanceof Error ? tokenErr.message : String(tokenErr || '');
      const existingSub = await registration.pushManager.getSubscription().catch(() => null);
      if (
        existingSub &&
        /applicationServerKey|InvalidAccessError|AbortError|push service/i.test(errMsg)
      ) {
        await existingSub.unsubscribe().catch(() => false);
        token = await getToken(messaging, {
          vapidKey,
          serviceWorkerRegistration: registration,
        });
      } else {
        throw tokenErr;
      }
    }

    if (!token) {
      return { ok: false, reason: 'Could not retrieve a device push token.' };
    }

    await upsertFcmTokenRecord(uid, token);
    return { ok: true, token };
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : 'Unable to register device for push alerts.';
    if (/fcmregistrations|firebaseinstallations|token-subscribe-failed|403|PERMISSION_DENIED/i.test(rawMsg)) {
      return {
        ok: false,
        reason:
          'Firebase Push registration was rejected. Verify FCM Registration API and Firebase Installations API are enabled for hostelify-ddc5a and VITE_FIREBASE_VAPID_KEY matches Firebase Console.',
      };
    }
    return {
      ok: false,
      reason: rawMsg,
    };
  }
}

export async function unregisterCurrentFcmToken(uid: string): Promise<void> {
  if (!uid) return;
  try {
    const storedTokenId = localStorage.getItem(TOKEN_ID_STORAGE_KEY);
    if (storedTokenId) {
      await deleteDoc(doc(db, 'users', uid, 'fcmTokens', storedTokenId)).catch(() => {});
      localStorage.removeItem(TOKEN_ID_STORAGE_KEY);
    }
    if (isAndroidNative()) {
      await FirebaseMessaging.deleteToken().catch(() => {});
    }
  } catch {
    // Ignore cleanup errors on logout
  }
}

function coerceNotificationData(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
    else if (v !== null && v !== undefined) out[k] = String(v);
  }
  return out;
}

export async function subscribeForegroundPushMessages(
  onPayload: (payload: MessagePayload) => void,
  uidForTokenRefresh?: string
): Promise<() => void> {
  if (isAndroidNative()) {
    if (activeForegroundBridgeCount > 0) {
      return () => {};
    }
    activeForegroundBridgeCount += 1;
    let disposed = false;
    const handles: Array<{ remove: () => Promise<void> }> = [];

    const setup = async () => {
      try {
        await ensureAndroidNotificationChannels();
        const recvHandle = await FirebaseMessaging.addListener('notificationReceived', (event) => {
          if (disposed) return;
          const n = event.notification;
          const data = coerceNotificationData(n.data);
          onPayload({
            from: '',
            collapseKey: '',
            messageId: n.id || '',
            notification: {
              title: n.title,
              body: n.body,
            },
            data,
          });
        });
        if (disposed) {
          void recvHandle.remove();
        } else {
          handles.push(recvHandle);
        }

        if (uidForTokenRefresh) {
          const tokenHandle = await FirebaseMessaging.addListener('tokenReceived', (event) => {
            if (disposed || !event.token) return;
            void upsertFcmTokenRecord(uidForTokenRefresh, event.token).catch(() => {});
          });
          if (disposed) {
            void tokenHandle.remove();
          } else {
            handles.push(tokenHandle);
          }
        }
      } catch {
        // Ignore if FirebaseMessaging plugin is unavailable
      }
    };

    void setup();

    return () => {
      if (disposed) return;
      disposed = true;
      activeForegroundBridgeCount = Math.max(0, activeForegroundBridgeCount - 1);
      for (const h of handles) {
        void h.remove().catch(() => {});
      }
      handles.length = 0;
    };
  }

  try {
    const supported = await isSupported().catch(() => false);
    if (!supported) return () => {};
    const messaging = getMessaging(app);
    return onMessage(messaging, onPayload);
  } catch {
    return () => {};
  }
}

let activeNativeTapBridgeCount = 0;

export function subscribeNativeNotificationTap(
  onTap: (payload: NativeNotificationTapPayload) => void
): () => void {
  if (!isAndroidNative() || activeNativeTapBridgeCount > 0) {
    return () => {};
  }

  activeNativeTapBridgeCount += 1;
  let disposed = false;
  let tapHandle: { remove: () => Promise<void> } | null = null;

  void FirebaseMessaging.addListener('notificationActionPerformed', (event) => {
    if (disposed) return;
    const n = event.notification;
    onTap({
      link: n.link,
      data: coerceNotificationData(n.data),
    });
  })
    .then((handle) => {
      if (disposed) {
        void handle.remove().catch(() => {});
      } else {
        tapHandle = handle;
      }
    })
    .catch(() => {});

  return () => {
    if (disposed) return;
    disposed = true;
    activeNativeTapBridgeCount = Math.max(0, activeNativeTapBridgeCount - 1);
    if (tapHandle) {
      void tapHandle.remove().catch(() => {});
      tapHandle = null;
    }
  };
}
