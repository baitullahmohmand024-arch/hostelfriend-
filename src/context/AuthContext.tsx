import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  linkWithCredential,
  linkWithPopup,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  User,
} from 'firebase/auth';
import { DocumentSnapshot } from 'firebase/firestore';
import { auth, googleProvider, testFirestoreConnection } from '../lib/firebase';
import { isNativePlatform } from '../lib/nativePlatform';
import {
  checkIsAdmin,
  createUserProfileAndSettings,
  ensureUserPrivateSettings,
  getUserPrivateSettings,
  getUserProfile,
  subscribeFollowingIds,
} from '../services/userService';
import { fetchPlatformSettings, subscribeConversations } from '../services/socialService';
import {
  fetchNotificationsPage,
  getDefaultNotificationPreferences,
  getOrInitNotificationPreferences,
  isNotificationEnabledForPreferences,
  subscribeAllFriendRequests,
  subscribeNotificationsFeed,
  updateNotificationPreferences,
} from '../services/notificationService';
import {
  getNotificationPermissionState,
  registerFcmTokenForUser,
  subscribeForegroundPushMessages,
  unregisterCurrentFcmToken,
} from '../services/fcmService';
import {
  FriendRequest,
  NotificationItem,
  NotificationPreferences,
  PlatformSettings,
  UserPrivateSettings,
  UserProfile,
} from '../types';
import { useToast } from './ToastContext';
import { playSound } from '../utils/soundVfx';

export interface PendingOnboardingDraft {
  fullName: string;
  username: string;
  hostel: string;
  avatarUrl: string;
  coverUrl?: string;
}

interface AuthContextValue {
  firebaseUser: User | null;
  profile: UserProfile | null;
  privateSettings: UserPrivateSettings | null;
  notificationPreferences: NotificationPreferences | null;
  platformSettings: PlatformSettings;
  isAdmin: boolean;
  authReady: boolean;
  connectionOk: boolean;
  needsOnboarding: boolean;
  needsVerification: boolean;
  notifications: NotificationItem[];
  notificationsLoading: boolean;
  notificationsError: string | null;
  hasMoreNotifications: boolean;
  loadingMoreNotifications: boolean;
  friendRequests: FriendRequest[];
  incomingFriendRequests: FriendRequest[];
  followingIds: Set<string>;
  unreadNotifications: number;
  unreadMessages: number;
  pendingDraft: PendingOnboardingDraft | null;
  loadMoreNotifications: () => Promise<void>;
  refreshNotifications: () => void;
  setNotificationPreferences: React.Dispatch<React.SetStateAction<NotificationPreferences | null>>;
  enablePushNotifications: () => Promise<{ ok: boolean; reason?: string }>;
  signInWithGoogle: () => Promise<void>;
  linkGoogleAccount: () => Promise<void>;
  signUpWithEmail: (params: {
    email: string;
    password: string;
    fullName: string;
    username: string;
    hostel?: string;
    avatarUrl?: string;
    coverUrl?: string;
  }) => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  sendResetEmail: (email: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  refreshVerificationStatus: () => Promise<boolean>;
  completeOnboarding: (params: {
    fullName: string;
    username: string;
    hostel?: string;
    avatarUrl?: string;
    coverUrl?: string;
  }) => Promise<void>;
  refreshUserState: () => Promise<void>;
  refreshPlatformSettings: () => Promise<void>;
  setProfile: React.Dispatch<React.SetStateAction<UserProfile | null>>;
  setPrivateSettings: React.Dispatch<React.SetStateAction<UserPrivateSettings | null>>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const DRAFT_KEY = 'hostelverse_onboarding_draft';

const DEFAULT_PLATFORM: PlatformSettings = {
  maxUploadSizeMB: 25,
  allowNewRegistrations: true,
  maintenanceNotice: '',
  featuredHashtags: ['hostellife', 'latenightstudy', 'rooftop', 'campusfilm', 'coffeehour'],
  updatedBy: 'system',
  updatedAt: null,
};

function isUserVerified(user: User | null): boolean {
  if (!user) return false;
  return Boolean(user.emailVerified || user.phoneNumber);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { showToast } = useToast();
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [privateSettings, setPrivateSettings] = useState<UserPrivateSettings | null>(null);
  const [notificationPreferences, setNotificationPreferences] =
    useState<NotificationPreferences | null>(null);
  const [platformSettings, setPlatformSettings] = useState<PlatformSettings>(DEFAULT_PLATFORM);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [connectionOk, setConnectionOk] = useState(true);

  // Shared real-time notification state (single Firestore listener per session)
  const [realtimeNotifications, setRealtimeNotifications] = useState<NotificationItem[]>([]);
  const [olderNotifications, setOlderNotifications] = useState<NotificationItem[]>([]);
  const [notificationsLastDoc, setNotificationsLastDoc] = useState<DocumentSnapshot | null>(null);
  const [hasMoreNotifications, setHasMoreNotifications] = useState(false);
  const [loadingMoreNotifications, setLoadingMoreNotifications] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const [notifRefreshTick, setNotifRefreshTick] = useState(0);

  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const [unreadMessages, setUnreadMessages] = useState(0);

  const seenNotifIdsRef = useRef<Set<string>>(new Set());
  const notifInitializedRef = useRef(false);
  const prevUnreadMsgsRef = useRef<number | null>(null);
  const prefsRef = useRef<NotificationPreferences | null>(null);
  prefsRef.current = notificationPreferences;

  const [pendingDraft, setPendingDraft] = useState<PendingOnboardingDraft | null>(() => {
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      return saved ? (JSON.parse(saved) as PendingOnboardingDraft) : null;
    } catch {
      return null;
    }
  });

  const refreshPlatformSettings = useCallback(async () => {
    const settings = await fetchPlatformSettings();
    setPlatformSettings(settings);
  }, []);

  const loadUserRecords = useCallback(async (user: User) => {
    const verified = isUserVerified(user);
    const [prof, privInitial, adminFlag, notifPrefs] = await Promise.all([
      getUserProfile(user.uid),
      getUserPrivateSettings(user.uid),
      checkIsAdmin(user.uid, user.email, user.emailVerified),
      verified
        ? getOrInitNotificationPreferences(user.uid)
        : Promise.resolve(getDefaultNotificationPreferences(user.uid)),
    ]);
    let priv = privInitial;
    if (prof && !priv && verified) {
      try {
        priv = await ensureUserPrivateSettings(user.uid, user.email || '');
      } catch {
        priv = null;
      }
    }
    setProfile(prof);
    setPrivateSettings(priv);
    setIsAdmin(adminFlag);
    setNotificationPreferences(notifPrefs);
    return prof;
  }, []);

  useEffect(() => {
    testFirestoreConnection().then(setConnectionOk);
    refreshPlatformSettings();

    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        try {
          const loadedProfile = await loadUserRecords(user);
          if (!loadedProfile && isUserVerified(user)) {
            const rawDraft = localStorage.getItem(DRAFT_KEY);
            if (rawDraft) {
              try {
                const draft = JSON.parse(rawDraft) as PendingOnboardingDraft;
                const created = await createUserProfileAndSettings({
                  uid: user.uid,
                  email: user.email || '',
                  fullName: draft.fullName,
                  username: draft.username,
                  hostel: draft.hostel,
                  avatarUrl: draft.avatarUrl,
                  coverUrl: draft.coverUrl,
                });
                setProfile(created.profile);
                setPrivateSettings(created.settings);
                const prefs = await getOrInitNotificationPreferences(user.uid);
                setNotificationPreferences(prefs);
                localStorage.removeItem(DRAFT_KEY);
                setPendingDraft(null);
              } catch {
                // Keep onboarding form open if username conflicted
              }
            }
          }
        } catch {
          setProfile(null);
          setPrivateSettings(null);
          setNotificationPreferences(null);
        }
      } else {
        setProfile(null);
        setPrivateSettings(null);
        setNotificationPreferences(null);
        setIsAdmin(false);
        setRealtimeNotifications([]);
        setOlderNotifications([]);
        setFriendRequests([]);
        setFollowingIds(new Set());
        setUnreadMessages(0);
      }
      setAuthReady(true);
    });

    return () => unsub();
  }, [loadUserRecords, refreshPlatformSettings]);

  // Real-time shared notification, friend request, and unread message listeners
  useEffect(() => {
    if (!authReady || !firebaseUser || !profile) {
      seenNotifIdsRef.current.clear();
      notifInitializedRef.current = false;
      prevUnreadMsgsRef.current = null;
      setRealtimeNotifications([]);
      setOlderNotifications([]);
      setFriendRequests([]);
      setFollowingIds(new Set());
      setNotificationsLoading(false);
      setNotificationsError(null);
      return;
    }

    seenNotifIdsRef.current.clear();
    notifInitializedRef.current = false;
    prevUnreadMsgsRef.current = null;
    setNotificationsLoading(true);
    setNotificationsError(null);

    const PAGE_SIZE = 60;
    const unsubNotifs = subscribeNotificationsFeed(
      firebaseUser.uid,
      PAGE_SIZE,
      (items, lastDoc) => {
        setRealtimeNotifications(items);
        setNotificationsLastDoc(lastDoc);
        setHasMoreNotifications(items.length >= PAGE_SIZE);
        setNotificationsLoading(false);
        setNotificationsError(null);

        if (!notifInitializedRef.current) {
          items.forEach((n) => seenNotifIdsRef.current.add(n.id));
          notifInitializedRef.current = true;
          return;
        }

        const newUnread = items.filter(
          (n) =>
            !n.isRead &&
            !seenNotifIdsRef.current.has(n.id) &&
            isNotificationEnabledForPreferences(n.type, prefsRef.current)
        );
        items.forEach((n) => seenNotifIdsRef.current.add(n.id));

        if (newUnread.length > 0) {
          playSound('notification');
        }
      },
      () => {
        setNotificationsLoading(false);
        setNotificationsError('Unable to load notifications right now.');
      }
    );

    const unsubFriendRequests = subscribeAllFriendRequests(
      firebaseUser.uid,
      (requests) => {
        setFriendRequests(requests);
      }
    );

    const unsubFollowing = subscribeFollowingIds(firebaseUser.uid, (ids) => {
      setFollowingIds(new Set(ids));
    });

    const unsubConvs = subscribeConversations(firebaseUser.uid, (convs) => {
      const totalUnread = convs.reduce((acc, c) => {
        const isA = c.participantAId === firebaseUser.uid;
        return acc + (isA ? c.unreadByA : c.unreadByB);
      }, 0);
      setUnreadMessages(totalUnread);

      if (prevUnreadMsgsRef.current !== null && totalUnread > prevUnreadMsgsRef.current) {
        playSound('message');
      }
      prevUnreadMsgsRef.current = totalUnread;
    });

    return () => {
      unsubNotifs();
      unsubFriendRequests();
      unsubFollowing();
      unsubConvs();
    };
  }, [authReady, firebaseUser, profile, notifRefreshTick]);

  // Register device FCM token & listen for foreground push payloads
  useEffect(() => {
    if (!authReady || !firebaseUser || !profile) return;

    const syncTokenIfReady = async () => {
      const permission = await getNotificationPermissionState();
      if (permission === 'granted' && prefsRef.current?.pushEnabled === true) {
        void registerFcmTokenForUser(firebaseUser.uid, false);
      }
    };

    void syncTokenIfReady();

    const onControllerChange = () => {
      void syncTokenIfReady();
    };
    const swContainer =
      !isNativePlatform() && typeof navigator !== 'undefined'
        ? navigator.serviceWorker
        : undefined;
    swContainer?.addEventListener?.('controllerchange', onControllerChange);

    let unsubFcm = () => {};
    let active = true;

    void subscribeForegroundPushMessages(
      (payload) => {
        if (!active) return;
        const notifType = payload.data?.type;
        if (
          notifType &&
          !isNotificationEnabledForPreferences(
            notifType as NotificationItem['type'],
            prefsRef.current
          )
        ) {
          return;
        }
        const title = payload.notification?.title || payload.data?.title || 'Hostel Friend';
        const description = payload.notification?.body || payload.data?.body || '';
        showToast({
          type: 'info',
          title,
          description: description || undefined,
        });
      },
      firebaseUser.uid
    ).then((unsub) => {
      if (active) {
        unsubFcm = unsub;
      } else {
        unsub();
      }
    });

    return () => {
      active = false;
      swContainer?.removeEventListener?.('controllerchange', onControllerChange);
      unsubFcm();
    };
  }, [authReady, firebaseUser, profile, notificationPreferences?.pushEnabled, showToast]);

  const notifications = useMemo(() => {
    const mergedMap = new Map<string, NotificationItem>();
    for (const item of realtimeNotifications) {
      mergedMap.set(item.id, item);
    }
    for (const item of olderNotifications) {
      if (!mergedMap.has(item.id)) {
        mergedMap.set(item.id, item);
      }
    }
    return Array.from(mergedMap.values()).sort(
      (a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0)
    );
  }, [realtimeNotifications, olderNotifications]);

  const incomingFriendRequests = useMemo(() => {
    const uid = firebaseUser?.uid;
    if (!uid) return [];
    return friendRequests.filter((r) => r.recipientId === uid && r.status === 'pending');
  }, [friendRequests, firebaseUser?.uid]);

  const unreadNotifications = useMemo(() => {
    return notifications.filter(
      (n) => !n.isRead && isNotificationEnabledForPreferences(n.type, notificationPreferences)
    ).length;
  }, [notifications, notificationPreferences]);

  const loadMoreNotifications = useCallback(async () => {
    if (!firebaseUser || !notificationsLastDoc || loadingMoreNotifications) return;
    setLoadingMoreNotifications(true);
    try {
      const page = await fetchNotificationsPage(firebaseUser.uid, notificationsLastDoc, 40);
      setOlderNotifications((prev) => [...prev, ...page.items]);
      setNotificationsLastDoc(page.lastDoc);
      setHasMoreNotifications(page.hasMore);
    } finally {
      setLoadingMoreNotifications(false);
    }
  }, [firebaseUser, notificationsLastDoc, loadingMoreNotifications]);

  const refreshNotifications = useCallback(() => {
    setOlderNotifications([]);
    setNotifRefreshTick((t) => t + 1);
  }, []);

  const enablePushNotifications = useCallback(async () => {
    if (!firebaseUser) return { ok: false, reason: 'Please sign in first.' };
    const result = await registerFcmTokenForUser(firebaseUser.uid, true);
    if (result.ok) {
      try {
        const updated = await updateNotificationPreferences(firebaseUser.uid, {
          pushEnabled: true,
        });
        setNotificationPreferences(updated);
      } catch {
        setNotificationPreferences((prev) =>
          prev ? { ...prev, pushEnabled: true } : prev
        );
      }
    }
    return result;
  }, [firebaseUser]);

  const acquireNativeGoogleIdToken = async (): Promise<string> => {
    const attemptSignIn = async (useCredentialManager: boolean) =>
      FirebaseAuthentication.signInWithGoogle({
        skipNativeAuth: true,
        useCredentialManager,
      });

    let nativeResult;
    try {
      nativeResult = await attemptSignIn(true);
    } catch (err) {
      const msg = String((err as { message?: string })?.message || err || '').toLowerCase();
      const isUserCancel =
        msg.includes('cancel') ||
        msg.includes('dismiss') ||
        msg.includes('12501') ||
        msg.includes('16');
      const shouldFallbackLegacy =
        !isUserCancel &&
        (msg.includes('no credential') ||
          msg.includes('credential manager') ||
          msg.includes('not available') ||
          msg.includes('unsupported'));

      if (shouldFallbackLegacy) {
        nativeResult = await attemptSignIn(false);
      } else {
        throw err;
      }
    }

    const idToken = nativeResult?.credential?.idToken;
    if (!idToken) {
      throw new Error(
        'Google sign-in did not return an ID token. Verify google-services.json and SHA fingerprints in Firebase Console.'
      );
    }
    return idToken;
  };

  const signInWithGoogle = async () => {
    if (isNativePlatform()) {
      const idToken = await acquireNativeGoogleIdToken();
      const credential = GoogleAuthProvider.credential(idToken);
      const result = await signInWithCredential(auth, credential);
      await result.user.getIdToken(true);
      await loadUserRecords(result.user);
      return;
    }
    const result = await signInWithPopup(auth, googleProvider);
    await result.user.getIdToken(true);
    await loadUserRecords(result.user);
  };

  const linkGoogleAccount = async () => {
    if (!auth.currentUser) throw new Error('Please sign in first.');
    if (isNativePlatform()) {
      const idToken = await acquireNativeGoogleIdToken();
      const credential = GoogleAuthProvider.credential(idToken);
      const result = await linkWithCredential(auth.currentUser, credential);
      await result.user.getIdToken(true);
      setFirebaseUser({ ...result.user } as User);
      await loadUserRecords(result.user);
      return;
    }
    const result = await linkWithPopup(auth.currentUser, googleProvider);
    await result.user.getIdToken(true);
    setFirebaseUser({ ...result.user } as User);
    await loadUserRecords(result.user);
  };

  const signUpWithEmail = async (params: {
    email: string;
    password: string;
    fullName: string;
    username: string;
    hostel?: string;
    avatarUrl?: string;
    coverUrl?: string;
  }) => {
    if (!platformSettings.allowNewRegistrations) {
      throw new Error('New member registrations are temporarily paused by administrators.');
    }
    const cred = await createUserWithEmailAndPassword(auth, params.email.trim(), params.password);
    await updateProfile(cred.user, {
      displayName: params.fullName.trim(),
      photoURL: params.avatarUrl || undefined,
    });
    const draft: PendingOnboardingDraft = {
      fullName: params.fullName.trim(),
      username: params.username.trim(),
      hostel: (params.hostel || '').trim(),
      avatarUrl: params.avatarUrl || '',
      coverUrl: params.coverUrl || '',
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    setPendingDraft(draft);
    await sendEmailVerification(cred.user);
  };

  const loginWithEmail = async (email: string, password: string) => {
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    await loadUserRecords(cred.user);
  };

  const sendResetEmail = async (email: string) => {
    await sendPasswordResetEmail(auth, email.trim());
  };

  const resendVerificationEmail = async () => {
    if (!auth.currentUser) throw new Error('No active session found.');
    await sendEmailVerification(auth.currentUser);
  };

  const refreshVerificationStatus = async (): Promise<boolean> => {
    if (!auth.currentUser) return false;
    await reload(auth.currentUser);
    await auth.currentUser.getIdToken(true);
    const updatedUser = auth.currentUser;
    setFirebaseUser({ ...updatedUser } as User);
    if (updatedUser.emailVerified) {
      const existing = await loadUserRecords(updatedUser);
      if (!existing && pendingDraft) {
        const created = await createUserProfileAndSettings({
          uid: updatedUser.uid,
          email: updatedUser.email || '',
          fullName: pendingDraft.fullName,
          username: pendingDraft.username,
          hostel: pendingDraft.hostel,
          avatarUrl: pendingDraft.avatarUrl,
          coverUrl: pendingDraft.coverUrl,
        });
        setProfile(created.profile);
        setPrivateSettings(created.settings);
        const prefs = await getOrInitNotificationPreferences(updatedUser.uid);
        setNotificationPreferences(prefs);
        localStorage.removeItem(DRAFT_KEY);
        setPendingDraft(null);
      }
      return true;
    }
    return false;
  };

  const completeOnboarding = async (params: {
    fullName: string;
    username: string;
    hostel?: string;
    avatarUrl?: string;
    coverUrl?: string;
  }) => {
    if (!auth.currentUser) throw new Error('Please sign in first.');
    if (!platformSettings.allowNewRegistrations) {
      throw new Error('New member registrations are temporarily paused by administrators.');
    }
    const created = await createUserProfileAndSettings({
      uid: auth.currentUser.uid,
      email: auth.currentUser.email || '',
      fullName: params.fullName,
      username: params.username,
      hostel: params.hostel,
      avatarUrl: params.avatarUrl || auth.currentUser.photoURL || '',
      coverUrl: params.coverUrl || '',
    });
    setProfile(created.profile);
    setPrivateSettings(created.settings);
    const prefs = await getOrInitNotificationPreferences(auth.currentUser.uid);
    setNotificationPreferences(prefs);
    localStorage.removeItem(DRAFT_KEY);
    setPendingDraft(null);
  };

  const refreshUserState = async () => {
    if (!auth.currentUser) return;
    await loadUserRecords(auth.currentUser);
  };

  const logout = async () => {
    const uid = auth.currentUser?.uid || profile?.uid || '';
    if (uid) {
      await unregisterCurrentFcmToken(uid);
    }
    localStorage.removeItem(DRAFT_KEY);
    setPendingDraft(null);
    setRealtimeNotifications([]);
    setOlderNotifications([]);
    setFriendRequests([]);
    setFollowingIds(new Set());
    if (isNativePlatform()) {
      await FirebaseAuthentication.signOut().catch(() => {});
    }
    await signOut(auth);
  };

  const needsVerification = Boolean(firebaseUser && !isUserVerified(firebaseUser));
  const needsOnboarding = Boolean(firebaseUser && isUserVerified(firebaseUser) && !profile);

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        privateSettings,
        notificationPreferences,
        platformSettings,
        isAdmin,
        authReady,
        connectionOk,
        needsOnboarding,
        needsVerification,
        notifications,
        notificationsLoading,
        notificationsError,
        hasMoreNotifications,
        loadingMoreNotifications,
        friendRequests,
        incomingFriendRequests,
        followingIds,
        unreadNotifications,
        unreadMessages,
        pendingDraft,
        loadMoreNotifications,
        refreshNotifications,
        setNotificationPreferences,
        enablePushNotifications,
        signInWithGoogle,
        linkGoogleAccount,
        signUpWithEmail,
        loginWithEmail,
        sendResetEmail,
        resendVerificationEmail,
        refreshVerificationStatus,
        completeOnboarding,
        refreshUserState,
        refreshPlatformSettings,
        setProfile,
        setPrivateSettings,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
