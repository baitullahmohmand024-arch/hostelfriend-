import {
  collection,
  deleteDoc,
  doc,
  DocumentData,
  DocumentSnapshot,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  QuerySnapshot,
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
import {
  FriendRequest,
  NotificationItem,
  NotificationPreferences,
  NotificationType,
  UserProfile,
} from '../types';

export type CanonicalNotificationType =
  | 'NEW_MESSAGE'
  | 'POST_LIKE'
  | 'POST_COMMENT'
  | 'COMMENT_REPLY'
  | 'NEW_FOLLOWER'
  | 'FRIEND_REQUEST'
  | 'FRIEND_REQUEST_ACCEPTED'
  | 'USER_MENTION'
  | 'IMPORTANT_APP_ANNOUNCEMENT';

export function normalizeNotificationType(type: NotificationType): CanonicalNotificationType {
  switch (type) {
    case 'like':
    case 'POST_LIKE':
      return 'POST_LIKE';
    case 'comment':
    case 'POST_COMMENT':
      return 'POST_COMMENT';
    case 'COMMENT_REPLY':
      return 'COMMENT_REPLY';
    case 'follow':
    case 'NEW_FOLLOWER':
      return 'NEW_FOLLOWER';
    case 'mention':
    case 'USER_MENTION':
      return 'USER_MENTION';
    case 'NEW_MESSAGE':
      return 'NEW_MESSAGE';
    case 'FRIEND_REQUEST':
      return 'FRIEND_REQUEST';
    case 'FRIEND_REQUEST_ACCEPTED':
      return 'FRIEND_REQUEST_ACCEPTED';
    case 'system':
    case 'IMPORTANT_APP_ANNOUNCEMENT':
    default:
      return 'IMPORTANT_APP_ANNOUNCEMENT';
  }
}

export function getDefaultNotificationPreferences(uid: string): NotificationPreferences {
  return {
    uid,
    messages: true,
    likes: true,
    comments: true,
    commentReplies: true,
    follows: true,
    friendRequests: true,
    mentions: true,
    announcements: true,
    pushEnabled: false,
    updatedAt: null,
  };
}

export function isNotificationEnabledForPreferences(
  type: NotificationType,
  prefs: NotificationPreferences | null
): boolean {
  if (!prefs) return true;
  const canonical = normalizeNotificationType(type);
  switch (canonical) {
    case 'NEW_MESSAGE':
      return prefs.messages;
    case 'POST_LIKE':
      return prefs.likes;
    case 'POST_COMMENT':
      return prefs.comments;
    case 'COMMENT_REPLY':
      return prefs.commentReplies;
    case 'NEW_FOLLOWER':
      return prefs.follows;
    case 'FRIEND_REQUEST':
    case 'FRIEND_REQUEST_ACCEPTED':
      return prefs.friendRequests;
    case 'USER_MENTION':
      return prefs.mentions;
    case 'IMPORTANT_APP_ANNOUNCEMENT':
      return prefs.announcements;
    default:
      return true;
  }
}

export function buildNotificationActionUrl(item: Partial<NotificationItem>): string {
  if (item.actionUrl) return item.actionUrl;
  const canonical = item.type ? normalizeNotificationType(item.type) : 'IMPORTANT_APP_ANNOUNCEMENT';
  const postId = item.relatedPostId || item.postId || '';

  switch (canonical) {
    case 'NEW_MESSAGE': {
      const params = new URLSearchParams({ view: 'messages' });
      if (item.relatedConversationId) params.set('conversationId', item.relatedConversationId);
      if (item.actorId) params.set('uid', item.actorId);
      return `/?${params.toString()}`;
    }
    case 'POST_LIKE':
    case 'POST_COMMENT':
    case 'COMMENT_REPLY':
    case 'USER_MENTION': {
      if (!postId) return '/?view=notifications';
      const params = new URLSearchParams({ view: 'feed', post: postId });
      if (item.relatedCommentId) params.set('commentId', item.relatedCommentId);
      return `/?${params.toString()}`;
    }
    case 'NEW_FOLLOWER':
      return item.actorId ? `/?view=profile&uid=${encodeURIComponent(item.actorId)}` : '/?view=notifications';
    case 'FRIEND_REQUEST': {
      const params = new URLSearchParams({ view: 'notifications', tab: 'requests' });
      if (item.relatedRequestId) params.set('requestId', item.relatedRequestId);
      if (item.actorId) params.set('uid', item.actorId);
      return `/?${params.toString()}`;
    }
    case 'FRIEND_REQUEST_ACCEPTED':
      return item.actorId ? `/?view=profile&uid=${encodeURIComponent(item.actorId)}` : '/?view=notifications';
    case 'IMPORTANT_APP_ANNOUNCEMENT':
    default:
      return '/?view=notifications';
  }
}

const sessionDedupeCache = new Set<string>();

export interface CreateAppNotificationInput {
  recipientId: string;
  actor: UserProfile;
  type: CanonicalNotificationType;
  title?: string;
  body?: string;
  message: string;
  postId?: string;
  relatedPostId?: string;
  relatedCommentId?: string;
  relatedConversationId?: string;
  relatedMessageId?: string;
  relatedRequestId?: string;
  actionUrl?: string;
  dedupeKey?: string;
}

export function buildNotificationPayload(
  notificationId: string,
  input: CreateAppNotificationInput
): Record<string, unknown> {
  const postId = (input.relatedPostId || input.postId || '').slice(0, 128);
  const cleanMessage = input.message.trim().slice(0, 280);
  const cleanBody = (input.body || input.message).trim().slice(0, 280);

  const actionUrl =
    input.actionUrl ||
    buildNotificationActionUrl({
      type: input.type,
      actorId: input.actor.uid,
      postId,
      relatedPostId: postId,
      relatedCommentId: input.relatedCommentId,
      relatedConversationId: input.relatedConversationId,
      relatedRequestId: input.relatedRequestId,
    });

  return {
    id: notificationId,
    recipientId: input.recipientId,
    actorId: input.actor.uid,
    senderId: input.actor.uid,
    actorUsername: (input.actor.username || 'member').slice(0, 24),
    actorName: (input.actor.fullName || 'Hostel Member').slice(0, 64),
    actorAvatarUrl: (input.actor.avatarUrl || '').slice(0, 32768),
    type: input.type,
    ...(input.title ? { title: input.title.trim().slice(0, 120) } : {}),
    body: cleanBody,
    postId,
    ...(postId ? { relatedPostId: postId } : {}),
    ...(input.relatedCommentId ? { relatedCommentId: input.relatedCommentId.slice(0, 128) } : {}),
    ...(input.relatedConversationId
      ? { relatedConversationId: input.relatedConversationId.slice(0, 128) }
      : {}),
    ...(input.relatedMessageId ? { relatedMessageId: input.relatedMessageId.slice(0, 128) } : {}),
    ...(input.relatedRequestId ? { relatedRequestId: input.relatedRequestId.slice(0, 128) } : {}),
    actionUrl: actionUrl.slice(0, 256),
    message: cleanMessage,
    isRead: false,
    createdAt: serverTimestamp(),
  };
}

export async function createAppNotification(input: CreateAppNotificationInput): Promise<void> {
  if (!input.recipientId || input.recipientId === input.actor.uid) return;

  if (input.dedupeKey) {
    if (sessionDedupeCache.has(input.dedupeKey)) return;
    sessionDedupeCache.add(input.dedupeKey);
  }

  const notifRef = doc(collection(db, 'notifications'));
  const payload = buildNotificationPayload(notifRef.id, input);

  try {
    await setDoc(notifRef, payload);
  } catch (error) {
    if (input.dedupeKey) {
      sessionDedupeCache.delete(input.dedupeKey);
    }
    throw error;
  }
}

export function shouldSkipDedupeKey(dedupeKey: string): boolean {
  if (sessionDedupeCache.has(dedupeKey)) return true;
  sessionDedupeCache.add(dedupeKey);
  return false;
}

export function subscribeNotificationsFeed(
  uid: string,
  pageLimit: number,
  callback: (items: NotificationItem[], lastDoc: DocumentSnapshot | null) => void,
  onError?: (error: unknown) => void
): Unsubscribe {
  const safeLimit = Math.max(20, Math.min(250, pageLimit));
  const q = query(collection(db, 'notifications'), where('recipientId', '==', uid), limit(safeLimit));
  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => d.data() as NotificationItem);
      items.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
      const lastDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null;
      callback(items, lastDoc);
    },
    (error) => {
      if (onError) onError(error);
      else handleFirestoreError(error, OperationType.LIST, 'notifications');
    }
  );
}

export async function fetchNotificationsPage(
  uid: string,
  lastSnapshot: DocumentSnapshot | null,
  pageSize = 30
): Promise<{ items: NotificationItem[]; lastDoc: DocumentSnapshot | null; hasMore: boolean }> {
  try {
    const q = lastSnapshot
      ? query(
          collection(db, 'notifications'),
          where('recipientId', '==', uid),
          orderBy('createdAt', 'desc'),
          startAfter(lastSnapshot),
          limit(pageSize)
        )
      : query(
          collection(db, 'notifications'),
          where('recipientId', '==', uid),
          orderBy('createdAt', 'desc'),
          limit(pageSize)
        );
    const snap = await getDocs(q);
    return {
      items: snap.docs.map((d) => d.data() as NotificationItem),
      lastDoc: snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null,
      hasMore: snap.docs.length === pageSize,
    };
  } catch {
    // Graceful fallback when composite index (recipientId + createdAt) is not yet built
    const fallbackSnap = await getDocs(
      query(collection(db, 'notifications'), where('recipientId', '==', uid), limit(200))
    );
    const sorted = fallbackSnap.docs
      .map((d) => d.data() as NotificationItem)
      .sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
    return {
      items: sorted,
      lastDoc: null,
      hasMore: false,
    };
  }
}

export async function markNotificationRead(id: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'notifications', id), { isRead: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `notifications/${id}`);
  }
}

export async function markAllNotificationsRead(items: NotificationItem[]): Promise<void> {
  const unread = items.filter((n) => !n.isRead);
  if (unread.length === 0) return;
  try {
    const chunkSize = 400;
    for (let i = 0; i < unread.length; i += chunkSize) {
      const batch = writeBatch(db);
      for (const item of unread.slice(i, i + chunkSize)) {
        batch.update(doc(db, 'notifications', item.id), { isRead: true });
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, 'notifications');
  }
}

export async function deleteNotificationById(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'notifications', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `notifications/${id}`);
  }
}

export async function clearAllNotifications(items: NotificationItem[]): Promise<void> {
  if (items.length === 0) return;
  try {
    const chunkSize = 400;
    for (let i = 0; i < items.length; i += chunkSize) {
      const batch = writeBatch(db);
      for (const item of items.slice(i, i + chunkSize)) {
        batch.delete(doc(db, 'notifications', item.id));
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, 'notifications');
  }
}

export const APP_NOTIFICATION_SENDER_NAME = 'Hostel Friend';
export const APP_NOTIFICATION_SENDER_USERNAME = 'hostelfriend';
export const APP_NOTIFICATION_LOGO_URL = '/icons/icon-192.png';

export async function sendAdminAnnouncement(params: {
  adminProfile: UserProfile;
  title: string;
  body: string;
}): Promise<number> {
  const cleanTitle = params.title.trim().slice(0, 120);
  const cleanBody = params.body.trim().slice(0, 260);
  if (!cleanTitle || !cleanBody) {
    throw new Error('Announcement title and message are required.');
  }

  try {
    const allUsers: UserProfile[] = [];
    let cursor: DocumentSnapshot<DocumentData> | null = null;
    for (let page = 0; page < 5; page++) {
      const usersSnap: QuerySnapshot<DocumentData> = cursor
        ? await getDocs(query(collection(db, 'users'), startAfter(cursor), limit(100)))
        : await getDocs(query(collection(db, 'users'), limit(100)));
      if (usersSnap.empty) break;
      for (const docSnap of usersSnap.docs) {
        allUsers.push(docSnap.data() as UserProfile);
      }
      if (usersSnap.docs.length < 100) break;
      cursor = usersSnap.docs[usersSnap.docs.length - 1];
    }

    const recipients = allUsers.filter(
      (u) => !u.isSuspended && u.uid !== params.adminProfile.uid
    );

    if (recipients.length === 0) return 0;

    const appActor: UserProfile = {
      ...params.adminProfile,
      fullName: APP_NOTIFICATION_SENDER_NAME,
      username: APP_NOTIFICATION_SENDER_USERNAME,
      avatarUrl: APP_NOTIFICATION_LOGO_URL,
    };

    const chunkSize = 400;
    for (let i = 0; i < recipients.length; i += chunkSize) {
      const batch = writeBatch(db);
      for (const recipient of recipients.slice(i, i + chunkSize)) {
        const notifRef = doc(collection(db, 'notifications'));
        const payload = buildNotificationPayload(notifRef.id, {
          recipientId: recipient.uid,
          actor: appActor,
          type: 'IMPORTANT_APP_ANNOUNCEMENT',
          title: cleanTitle,
          body: cleanBody,
          message: `${cleanTitle}: ${cleanBody}`.slice(0, 280),
          actionUrl: '/?view=notifications',
        });
        batch.set(notifRef, payload);
      }
      await batch.commit();
    }

    return recipients.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'notifications');
  }
}

// ==========================================
// Granular Notification Preferences
// ==========================================

export async function getOrInitNotificationPreferences(
  uid: string
): Promise<NotificationPreferences> {
  const ref = doc(db, 'users', uid, 'notificationSettings', 'preferences');
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return snap.data() as NotificationPreferences;
    }

    // Seed from legacy /private/settings if present
    let legacyLikes = true;
    let legacyComments = true;
    let legacyFollows = true;
    let legacyMessages = true;
    try {
      const legacySnap = await getDoc(doc(db, 'users', uid, 'private', 'settings'));
      if (legacySnap.exists()) {
        const legacy = legacySnap.data();
        if (typeof legacy.notifyLikes === 'boolean') legacyLikes = legacy.notifyLikes;
        if (typeof legacy.notifyComments === 'boolean') legacyComments = legacy.notifyComments;
        if (typeof legacy.notifyFollows === 'boolean') legacyFollows = legacy.notifyFollows;
        if (typeof legacy.notifyMessages === 'boolean') legacyMessages = legacy.notifyMessages;
      }
    } catch {
      // Ignore if legacy doc does not exist
    }

    const defaults: NotificationPreferences = {
      ...getDefaultNotificationPreferences(uid),
      messages: legacyMessages,
      likes: legacyLikes,
      comments: legacyComments,
      commentReplies: legacyComments,
      follows: legacyFollows,
    };

    await setDoc(ref, {
      ...defaults,
      updatedAt: serverTimestamp(),
    });
    const created = await getDoc(ref);
    return (created.data() as NotificationPreferences) || defaults;
  } catch {
    return getDefaultNotificationPreferences(uid);
  }
}

export async function updateNotificationPreferences(
  uid: string,
  updates: Partial<
    Omit<NotificationPreferences, 'uid' | 'updatedAt'>
  >
): Promise<NotificationPreferences> {
  const prefRef = doc(db, 'users', uid, 'notificationSettings', 'preferences');
  const current = await getOrInitNotificationPreferences(uid);
  const next: Record<string, unknown> = {
    uid,
    messages: updates.messages ?? current.messages,
    likes: updates.likes ?? current.likes,
    comments: updates.comments ?? current.comments,
    commentReplies: updates.commentReplies ?? current.commentReplies,
    follows: updates.follows ?? current.follows,
    friendRequests: updates.friendRequests ?? current.friendRequests,
    mentions: updates.mentions ?? current.mentions,
    announcements: updates.announcements ?? current.announcements,
    pushEnabled: updates.pushEnabled ?? current.pushEnabled,
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(prefRef, next);

    // Keep overlapping legacy /private/settings fields synchronized
    const legacyPatch: Record<string, unknown> = {};
    if (typeof updates.likes === 'boolean') legacyPatch.notifyLikes = updates.likes;
    if (typeof updates.comments === 'boolean') legacyPatch.notifyComments = updates.comments;
    if (typeof updates.follows === 'boolean') legacyPatch.notifyFollows = updates.follows;
    if (typeof updates.messages === 'boolean') legacyPatch.notifyMessages = updates.messages;

    if (Object.keys(legacyPatch).length > 0) {
      await updateDoc(doc(db, 'users', uid, 'private', 'settings'), {
        ...legacyPatch,
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    }

    const refreshed = await getDoc(prefRef);
    return (refreshed.data() as NotificationPreferences) || {
      ...current,
      ...updates,
    };
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.WRITE,
      `users/${uid}/notificationSettings/preferences`
    );
  }
}

// ==========================================
// Friend Requests System
// ==========================================

export function getFriendRequestId(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join('_');
}

export async function getFriendRequestBetween(
  myUid: string,
  otherUid: string
): Promise<FriendRequest | null> {
  if (!myUid || !otherUid || myUid === otherUid) return null;
  const reqId = getFriendRequestId(myUid, otherUid);
  try {
    const snap = await getDoc(doc(db, 'friendRequests', reqId));
    return snap.exists() ? (snap.data() as FriendRequest) : null;
  } catch {
    return null;
  }
}

export function subscribeAllFriendRequests(
  uid: string,
  callback: (requests: FriendRequest[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'friendRequests'),
    where('participantIds', 'array-contains', uid),
    limit(60)
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const all = snapshot.docs
        .map((d) => d.data() as FriendRequest)
        .sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
      callback(all);
    },
    () => {
      callback([]);
    }
  );
}

export function subscribeIncomingFriendRequests(
  uid: string,
  callback: (requests: FriendRequest[]) => void
): Unsubscribe {
  return subscribeAllFriendRequests(uid, (all) => {
    callback(all.filter((r) => r.recipientId === uid && r.status === 'pending'));
  });
}

export async function sendFriendRequest(
  sender: UserProfile,
  recipient: Pick<UserProfile, 'uid' | 'username' | 'fullName' | 'avatarUrl'>
): Promise<FriendRequest> {
  if (sender.uid === recipient.uid) {
    throw new Error('You cannot send a friend request to yourself.');
  }

  const requestId = getFriendRequestId(sender.uid, recipient.uid);
  const reqRef = doc(db, 'friendRequests', requestId);
  const existingSnap = await getDoc(reqRef);

  const batch = writeBatch(db);
  if (existingSnap.exists()) {
    const existing = existingSnap.data() as FriendRequest;
    if (existing.status === 'pending' || existing.status === 'accepted') {
      return existing;
    }
    batch.update(reqRef, {
      senderId: sender.uid,
      senderUsername: sender.username,
      senderName: sender.fullName,
      senderAvatarUrl: (sender.avatarUrl || '').slice(0, 32768),
      recipientId: recipient.uid,
      recipientUsername: recipient.username,
      recipientName: recipient.fullName,
      recipientAvatarUrl: (recipient.avatarUrl || '').slice(0, 32768),
      status: 'pending',
      updatedAt: serverTimestamp(),
    });
  } else {
    const participantIds = [sender.uid, recipient.uid].sort();
    batch.set(reqRef, {
      id: requestId,
      senderId: sender.uid,
      senderUsername: sender.username,
      senderName: sender.fullName,
      senderAvatarUrl: (sender.avatarUrl || '').slice(0, 32768),
      recipientId: recipient.uid,
      recipientUsername: recipient.username,
      recipientName: recipient.fullName,
      recipientAvatarUrl: (recipient.avatarUrl || '').slice(0, 32768),
      participantIds,
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  const notifRef = doc(collection(db, 'notifications'));
  batch.set(
    notifRef,
    buildNotificationPayload(notifRef.id, {
      recipientId: recipient.uid,
      actor: sender,
      type: 'FRIEND_REQUEST',
      title: 'New Friend Request',
      body: `${sender.fullName} sent you a friend request.`,
      message: `sent you a friend request.`,
      relatedRequestId: requestId,
      actionUrl: `/?view=notifications&tab=requests&requestId=${encodeURIComponent(requestId)}&uid=${encodeURIComponent(sender.uid)}`,
    })
  );

  try {
    await batch.commit();
    const fresh = await getDoc(reqRef);
    return fresh.data() as FriendRequest;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `friendRequests/${requestId}`);
  }
}

export async function respondToFriendRequest(
  request: FriendRequest,
  actor: UserProfile,
  decision: 'accepted' | 'declined'
): Promise<void> {
  if (request.recipientId !== actor.uid) {
    throw new Error('Only the recipient can respond to this friend request.');
  }

  const reqRef = doc(db, 'friendRequests', request.id);
  const batch = writeBatch(db);
  batch.update(reqRef, {
    status: decision,
    updatedAt: serverTimestamp(),
  });

  if (decision === 'accepted') {
    const notifRef = doc(collection(db, 'notifications'));
    batch.set(
      notifRef,
      buildNotificationPayload(notifRef.id, {
        recipientId: request.senderId,
        actor,
        type: 'FRIEND_REQUEST_ACCEPTED',
        title: 'Friend Request Accepted',
        body: `${actor.fullName} accepted your friend request.`,
        message: `accepted your friend request.`,
        relatedRequestId: request.id,
        actionUrl: `/?view=profile&uid=${encodeURIComponent(actor.uid)}`,
      })
    );
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `friendRequests/${request.id}`);
  }
}

export async function cancelOrRemoveFriendRequest(requestId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'friendRequests', requestId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `friendRequests/${requestId}`);
  }
}
