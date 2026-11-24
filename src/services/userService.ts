import {
  collection,
  deleteDoc,
  doc,
  DocumentSnapshot,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  Unsubscribe,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import { UserPrivateSettings, UserProfile } from '../types';
import { sanitizeUsername } from '../utils/formatters';
import { buildNotificationPayload, shouldSkipDedupeKey } from './notificationService';

export async function checkUsernameAvailable(username: string): Promise<boolean> {
  const clean = sanitizeUsername(username).toLowerCase();
  if (clean.length < 3) return false;
  const path = `usernames/${clean}`;
  try {
    const snap = await getDoc(doc(db, 'usernames', clean));
    return !snap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const path = `users/${uid}`;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return null;
    return snap.data() as UserProfile;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function getUserPrivateSettings(uid: string): Promise<UserPrivateSettings | null> {
  const path = `users/${uid}/private/settings`;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'private', 'settings'));
    if (!snap.exists()) return null;
    return snap.data() as UserPrivateSettings;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function checkIsAdmin(
  uid: string,
  email?: string | null,
  emailVerified?: boolean
): Promise<boolean> {
  if (emailVerified && email === 'baitullahmohmand024@gmail.com') {
    return true;
  }
  try {
    const snap = await getDoc(doc(db, 'admins', uid));
    return snap.exists() && snap.data()?.role === 'admin';
  } catch {
    return false;
  }
}

export async function ensureUserPrivateSettings(
  uid: string,
  email: string
): Promise<UserPrivateSettings> {
  const existing = await getUserPrivateSettings(uid);
  if (existing) return existing;

  const settingsRef = doc(db, 'users', uid, 'private', 'settings');
  const payload = {
    uid,
    email: email.slice(0, 254),
    privacyMode: 'public' as const,
    notifyLikes: true,
    notifyComments: true,
    notifyFollows: true,
    notifyMessages: true,
    blockedUserIds: [] as string[],
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(settingsRef, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${uid}/private/settings`);
  }

  const created = await getUserPrivateSettings(uid);
  if (!created) {
    throw new Error('Could not initialize your private settings.');
  }
  return created;
}

export async function createUserProfileAndSettings(params: {
  uid: string;
  email: string;
  fullName: string;
  username: string;
  hostel?: string;
  avatarUrl?: string;
  coverUrl?: string;
}): Promise<{ profile: UserProfile; settings: UserPrivateSettings }> {
  const existingProfile = await getUserProfile(params.uid);
  if (existingProfile) {
    const settings = await ensureUserPrivateSettings(params.uid, params.email);
    return { profile: existingProfile, settings };
  }

  const cleanUsername = sanitizeUsername(params.username);
  const usernameLower = cleanUsername.toLowerCase();
  if (cleanUsername.length < 3) {
    throw new Error('Username must be at least 3 characters (letters, numbers, underscores).');
  }

  const available = await checkUsernameAvailable(cleanUsername);
  if (!available) {
    throw new Error(`Username @${cleanUsername} is already taken. Please choose another.`);
  }

  const defaultCover = (params.coverUrl || '').slice(0, 250000);
  const batch = writeBatch(db);
  const userRef = doc(db, 'users', params.uid);
  const settingsRef = doc(db, 'users', params.uid, 'private', 'settings');
  const usernameRef = doc(db, 'usernames', usernameLower);

  const profilePayload = {
    uid: params.uid,
    username: cleanUsername,
    usernameLower,
    fullName: params.fullName.trim().slice(0, 64) || cleanUsername,
    bio: '',
    hostel: (params.hostel || '').trim().slice(0, 80),
    avatarUrl: (params.avatarUrl || '').slice(0, 32768),
    coverUrl: defaultCover,
    followersCount: 0,
    followingCount: 0,
    postsCount: 0,
    isSuspended: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const settingsPayload = {
    uid: params.uid,
    email: params.email.slice(0, 254),
    privacyMode: 'public' as const,
    notifyLikes: true,
    notifyComments: true,
    notifyFollows: true,
    notifyMessages: true,
    blockedUserIds: [] as string[],
    updatedAt: serverTimestamp(),
  };

  batch.set(userRef, profilePayload);
  batch.set(settingsRef, settingsPayload);
  batch.set(usernameRef, {
    uid: params.uid,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${params.uid}`);
  }

  const [createdProfile, createdSettings] = await Promise.all([
    getUserProfile(params.uid),
    getUserPrivateSettings(params.uid),
  ]);

  if (!createdProfile || !createdSettings) {
    throw new Error('Profile created but could not be loaded. Please refresh.');
  }

  return { profile: createdProfile, settings: createdSettings };
}

export async function updateUserProfile(
  uid: string,
  currentUsernameLower: string,
  updates: {
    username?: string;
    fullName?: string;
    bio?: string;
    hostel?: string;
    avatarUrl?: string;
    coverUrl?: string;
  }
): Promise<UserProfile> {
  const userRef = doc(db, 'users', uid);
  const batch = writeBatch(db);

  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (typeof updates.fullName === 'string') {
    const trimmed = updates.fullName.trim().slice(0, 64);
    if (!trimmed) throw new Error('Full name cannot be empty.');
    payload.fullName = trimmed;
  }
  if (typeof updates.bio === 'string') {
    payload.bio = updates.bio.trim().slice(0, 240);
  }
  if (typeof updates.hostel === 'string') {
    payload.hostel = updates.hostel.trim().slice(0, 80);
  }
  if (typeof updates.avatarUrl === 'string') {
    payload.avatarUrl = updates.avatarUrl.slice(0, 32768);
  }
  if (typeof updates.coverUrl === 'string') {
    payload.coverUrl = updates.coverUrl.slice(0, 250000);
  }

  if (typeof updates.username === 'string') {
    const clean = sanitizeUsername(updates.username);
    const nextLower = clean.toLowerCase();
    if (clean.length < 3) {
      throw new Error('Username must be at least 3 characters.');
    }
    if (nextLower !== currentUsernameLower) {
      const available = await checkUsernameAvailable(clean);
      if (!available) {
        throw new Error(`Username @${clean} is already reserved.`);
      }
      batch.delete(doc(db, 'usernames', currentUsernameLower));
      batch.set(doc(db, 'usernames', nextLower), {
        uid,
        createdAt: serverTimestamp(),
      });
      payload.username = clean;
      payload.usernameLower = nextLower;
    }
  }

  batch.update(userRef, payload);

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
  }

  const refreshed = await getUserProfile(uid);
  if (!refreshed) throw new Error('Unable to refresh updated profile.');
  return refreshed;
}

export async function updateUserPrivateSettings(
  uid: string,
  updates: Partial<
    Pick<
      UserPrivateSettings,
      'email' | 'privacyMode' | 'notifyLikes' | 'notifyComments' | 'notifyFollows' | 'notifyMessages' | 'blockedUserIds'
    >
  >
): Promise<UserPrivateSettings> {
  const path = `users/${uid}/private/settings`;
  try {
    await updateDoc(doc(db, 'users', uid, 'private', 'settings'), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
    const refreshed = await getUserPrivateSettings(uid);
    if (!refreshed) throw new Error('Settings updated but could not reload.');
    return refreshed;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function followUser(
  actor: UserProfile,
  targetUid: string,
  options?: { skipNotification?: boolean }
): Promise<void> {
  if (actor.uid === targetUid) return;
  const followId = `${actor.uid}_${targetUid}`;
  const batch = writeBatch(db);

  batch.set(doc(db, 'follows', followId), {
    id: followId,
    followerId: actor.uid,
    followingId: targetUid,
    createdAt: serverTimestamp(),
  });
  batch.update(doc(db, 'users', actor.uid), {
    followingCount: increment(1),
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'users', targetUid), {
    followersCount: increment(1),
    updatedAt: serverTimestamp(),
  });

  if (!options?.skipNotification && !shouldSkipDedupeKey(`follow:${actor.uid}:${targetUid}`)) {
    const notifRef = doc(collection(db, 'notifications'));
    batch.set(
      notifRef,
      buildNotificationPayload(notifRef.id, {
        recipientId: targetUid,
        actor,
        type: 'NEW_FOLLOWER',
        title: 'New Follower',
        body: `${actor.fullName} started following you.`,
        message: 'started following you.',
        actionUrl: `/?view=profile&uid=${encodeURIComponent(actor.uid)}`,
      })
    );
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `follows/${followId}`);
  }
}

export async function unfollowUser(myUid: string, targetUid: string): Promise<void> {
  if (myUid === targetUid) return;
  const followId = `${myUid}_${targetUid}`;
  const batch = writeBatch(db);

  batch.delete(doc(db, 'follows', followId));
  batch.update(doc(db, 'users', myUid), {
    followingCount: increment(-1),
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'users', targetUid), {
    followersCount: increment(-1),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `follows/${followId}`);
  }
}

export async function getFollowingIds(uid: string): Promise<string[]> {
  try {
    const q = query(collection(db, 'follows'), where('followerId', '==', uid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data().followingId as string);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'follows');
  }
}

export function subscribeFollowingIds(
  uid: string,
  callback: (followingIds: string[]) => void
): Unsubscribe {
  const q = query(collection(db, 'follows'), where('followerId', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      callback(snapshot.docs.map((d) => d.data().followingId as string));
    },
    () => {
      callback([]);
    }
  );
}

export async function isFollowingUser(myUid: string, targetUid: string): Promise<boolean> {
  if (!myUid || !targetUid || myUid === targetUid) return false;
  try {
    const snap = await getDoc(doc(db, 'follows', `${myUid}_${targetUid}`));
    return snap.exists();
  } catch {
    return false;
  }
}

export async function fetchDiscoverMembers(maxCount = 24): Promise<UserProfile[]> {
  try {
    const q = query(collection(db, 'users'), orderBy('followersCount', 'desc'), limit(maxCount));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as UserProfile)
      .filter((u) => !u.isSuspended);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'users');
  }
}

export async function fetchDiscoverMembersPage(
  lastSnapshot: DocumentSnapshot | null = null,
  pageSize = 20
): Promise<{ members: UserProfile[]; lastDoc: DocumentSnapshot | null; hasMore: boolean }> {
  const safeLimit = Math.min(100, Math.max(1, Math.round(pageSize)));
  try {
    const q = lastSnapshot
      ? query(
          collection(db, 'users'),
          orderBy('followersCount', 'desc'),
          startAfter(lastSnapshot),
          limit(safeLimit)
        )
      : query(collection(db, 'users'), orderBy('followersCount', 'desc'), limit(safeLimit));
    const snap = await getDocs(q);
    const members = snap.docs
      .map((d) => d.data() as UserProfile)
      .filter((u) => !u.isSuspended);
    const nextLast = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;
    return {
      members,
      lastDoc: nextLast,
      hasMore: snap.docs.length === safeLimit,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'users');
  }
}

export async function searchMembersByPrefix(
  term: string,
  maxCount = 20
): Promise<UserProfile[]> {
  const clean = term.trim().toLowerCase().replace(/^@/, '');
  if (!clean) return [];
  const safeLimit = Math.min(100, Math.max(1, Math.round(maxCount)));
  try {
    const q = query(
      collection(db, 'users'),
      where('usernameLower', '>=', clean),
      where('usernameLower', '<=', `${clean}\uf8ff`),
      limit(safeLimit)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as UserProfile)
      .filter((u) => !u.isSuspended);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'users');
  }
}

export async function searchMembers(term: string): Promise<UserProfile[]> {
  const normalized = term.trim().toLowerCase().replace(/^@/, '');
  const members = await fetchDiscoverMembers(60);
  if (!normalized) return members;
  return members.filter(
    (m) =>
      m.usernameLower.includes(normalized) ||
      m.fullName.toLowerCase().includes(normalized) ||
      m.hostel.toLowerCase().includes(normalized)
  );
}

export async function deleteOwnAccountRecords(uid: string, usernameLower: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'users', uid, 'private', 'settings'));
    await deleteDoc(doc(db, 'usernames', usernameLower));
    await deleteDoc(doc(db, 'users', uid));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `users/${uid}`);
  }
}
