import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';

initializeApp();

const db = getFirestore();
const messaging = getMessaging();

type NotificationType =
  | 'NEW_MESSAGE'
  | 'POST_LIKE'
  | 'POST_COMMENT'
  | 'COMMENT_REPLY'
  | 'NEW_FOLLOWER'
  | 'FRIEND_REQUEST'
  | 'FRIEND_REQUEST_ACCEPTED'
  | 'USER_MENTION'
  | 'IMPORTANT_APP_ANNOUNCEMENT'
  | 'like'
  | 'comment'
  | 'follow'
  | 'mention'
  | 'system';

interface NotificationDoc {
  id: string;
  recipientId: string;
  actorId: string;
  actorUsername: string;
  actorName: string;
  actorAvatarUrl: string;
  type: NotificationType;
  title?: string;
  body?: string;
  postId: string;
  relatedPostId?: string;
  relatedCommentId?: string;
  relatedConversationId?: string;
  relatedMessageId?: string;
  relatedRequestId?: string;
  actionUrl?: string;
  message: string;
  isRead: boolean;
}

interface NotificationPreferencesDoc {
  messages?: boolean;
  likes?: boolean;
  comments?: boolean;
  commentReplies?: boolean;
  follows?: boolean;
  friendRequests?: boolean;
  mentions?: boolean;
  announcements?: boolean;
  pushEnabled?: boolean;
}

function normalizeType(type: NotificationType): NotificationType {
  if (type === 'like') return 'POST_LIKE';
  if (type === 'comment') return 'POST_COMMENT';
  if (type === 'follow') return 'NEW_FOLLOWER';
  if (type === 'mention') return 'USER_MENTION';
  if (type === 'system') return 'IMPORTANT_APP_ANNOUNCEMENT';
  return type;
}

function isCategoryAllowed(
  type: NotificationType,
  prefs: NotificationPreferencesDoc | undefined
): boolean {
  if (!prefs) return true;
  if (prefs.pushEnabled === false) return false;
  switch (normalizeType(type)) {
    case 'NEW_MESSAGE':
      return prefs.messages !== false;
    case 'POST_LIKE':
      return prefs.likes !== false;
    case 'POST_COMMENT':
      return prefs.comments !== false;
    case 'COMMENT_REPLY':
      return prefs.commentReplies !== false;
    case 'NEW_FOLLOWER':
      return prefs.follows !== false;
    case 'FRIEND_REQUEST':
    case 'FRIEND_REQUEST_ACCEPTED':
      return prefs.friendRequests !== false;
    case 'USER_MENTION':
      return prefs.mentions !== false;
    case 'IMPORTANT_APP_ANNOUNCEMENT':
      return prefs.announcements !== false;
    default:
      return true;
  }
}

async function isActorBlockedByRecipient(recipientId: string, actorId: string): Promise<boolean> {
  if (!recipientId || !actorId || recipientId === actorId) return true;
  const privSnap = await db.doc(`users/${recipientId}/private/settings`).get();
  if (!privSnap.exists) return false;
  const blocked = (privSnap.data()?.blockedUserIds as string[] | undefined) || [];
  return blocked.includes(actorId);
}

async function createNotificationIfAbsent(params: {
  recipientId: string;
  actorId: string;
  type: NotificationType;
  title: string;
  body: string;
  message: string;
  postId?: string;
  relatedPostId?: string;
  relatedCommentId?: string;
  relatedConversationId?: string;
  relatedMessageId?: string;
  relatedRequestId?: string;
  actionUrl: string;
  dedupeField?: keyof NotificationDoc;
  dedupeValue?: string;
  dedupeMatchType?: boolean;
}): Promise<void> {
  if (!params.recipientId || params.recipientId === params.actorId) return;
  if (await isActorBlockedByRecipient(params.recipientId, params.actorId)) return;

  if (params.dedupeField && params.dedupeValue) {
    const existingSnap = await db
      .collection('notifications')
      .where('recipientId', '==', params.recipientId)
      .where(params.dedupeField, '==', params.dedupeValue)
      .limit(params.dedupeMatchType ? 10 : 1)
      .get();
    if (params.dedupeMatchType) {
      const targetCanonical = normalizeType(params.type);
      const alreadyExists = existingSnap.docs.some(
        (d) => normalizeType((d.data() as NotificationDoc).type) === targetCanonical
      );
      if (alreadyExists) return;
    } else if (!existingSnap.empty) {
      return;
    }
  }

  const actorSnap = await db.doc(`users/${params.actorId}`).get();
  const actor = actorSnap.exists ? actorSnap.data() : undefined;
  const notifRef = db.collection('notifications').doc();

  await notifRef.set({
    id: notifRef.id,
    recipientId: params.recipientId,
    actorId: params.actorId,
    senderId: params.actorId,
    actorUsername: (actor?.username as string) || 'member',
    actorName: (actor?.fullName as string) || 'Hostel Member',
    actorAvatarUrl: (actor?.avatarUrl as string) || '',
    type: params.type,
    title: params.title.slice(0, 120),
    body: params.body.slice(0, 280),
    postId: params.postId || '',
    ...(params.relatedPostId ? { relatedPostId: params.relatedPostId } : {}),
    ...(params.relatedCommentId ? { relatedCommentId: params.relatedCommentId } : {}),
    ...(params.relatedConversationId
      ? { relatedConversationId: params.relatedConversationId }
      : {}),
    ...(params.relatedMessageId ? { relatedMessageId: params.relatedMessageId } : {}),
    ...(params.relatedRequestId ? { relatedRequestId: params.relatedRequestId } : {}),
    actionUrl: params.actionUrl.slice(0, 256),
    message: params.message.slice(0, 280),
    isRead: false,
    createdAt: FieldValue.serverTimestamp(),
  });
}

// 1. Primary FCM Push Dispatcher whenever any notification document is created
export const onNotificationCreated = onDocumentCreated(
  {
    document: 'notifications/{notificationId}',
    database: '(default)',
  },
  async (event) => {
    const notif = event.data?.data() as NotificationDoc | undefined;
    if (!notif || !notif.recipientId || notif.actorId === notif.recipientId) return;

    const [prefsSnap, privSnap, tokensSnap] = await Promise.all([
      db.doc(`users/${notif.recipientId}/notificationSettings/preferences`).get(),
      db.doc(`users/${notif.recipientId}/private/settings`).get(),
      db.collection(`users/${notif.recipientId}/fcmTokens`).get(),
    ]);

    if (tokensSnap.empty) return;

    const prefs = prefsSnap.exists
      ? (prefsSnap.data() as NotificationPreferencesDoc)
      : undefined;
    if (!isCategoryAllowed(notif.type, prefs)) return;

    const blockedIds = (privSnap.data()?.blockedUserIds as string[] | undefined) || [];
    if (blockedIds.includes(notif.actorId)) return;

    const tokens = tokensSnap.docs
      .map((d) => ({ ref: d.ref, token: d.data().token as string }))
      .filter((t) => Boolean(t.token));

    if (tokens.length === 0) return;

    const canonical = normalizeType(notif.type);
    const title = (notif.title || 'Hostel Friend').slice(0, 120);
    const body = (
      notif.body ||
      (canonical === 'IMPORTANT_APP_ANNOUNCEMENT'
        ? notif.message
        : `${notif.actorName || 'Someone'} ${notif.message}`)
    ).slice(0, 280);
    const actionUrl =
      notif.actionUrl && notif.actionUrl.startsWith('/')
        ? notif.actionUrl
        : '/?view=notifications';
    const tag =
      canonical === 'NEW_MESSAGE' && notif.relatedConversationId
        ? `chat-${notif.relatedConversationId}`
        : notif.id;

    // Send high-urgency data-only WebPush so unified /sw.js handles background display,
    // Android vibration/renotify grouping, and exact deep-link click routing without
    // Firebase SW's built-in click listener or relative webpush.fcmOptions.link errors.
    const response = await messaging.sendEachForMulticast({
      tokens: tokens.map((t) => t.token),
      webpush: {
        headers: {
          Urgency: 'high',
          TTL: '86400',
        },
      },
      data: {
        notificationId: notif.id,
        type: canonical,
        title,
        body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag,
        renotify: canonical === 'NEW_MESSAGE' ? 'true' : 'false',
        timestamp: String(Date.now()),
        actionUrl,
        actorId: notif.actorId || '',
        relatedPostId: notif.relatedPostId || notif.postId || '',
        relatedCommentId: notif.relatedCommentId || '',
        relatedConversationId: notif.relatedConversationId || '',
        relatedRequestId: notif.relatedRequestId || '',
      },
    });

    // Clean up invalid or expired FCM device tokens
    const cleanupPromises: Promise<unknown>[] = [];
    response.responses.forEach((res, idx) => {
      if (!res.success && res.error) {
        const code = res.error.code;
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/mismatched-credential'
        ) {
          cleanupPromises.push(tokens[idx].ref.delete().catch(() => {}));
        }
      }
    });
    if (cleanupPromises.length > 0) {
      await Promise.all(cleanupPromises);
    }
  }
);

// 2. Real-time Message Trigger (backup for server-created / offline-synced messages)
export const onMessageCreated = onDocumentCreated(
  {
    document: 'conversations/{conversationId}/messages/{messageId}',
    database: '(default)',
  },
  async (event) => {
    const msg = event.data?.data() as
      | { id: string; conversationId: string; senderId: string; recipientId: string; text: string }
      | undefined;
    if (!msg) return;

    const actorSnap = await db.doc(`users/${msg.senderId}`).get();
    const senderName = (actorSnap.data()?.fullName as string) || 'Hostel Member';
    const preview = (msg.text || '').trim().slice(0, 140) || 'Sent you a message.';

    await createNotificationIfAbsent({
      recipientId: msg.recipientId,
      actorId: msg.senderId,
      type: 'NEW_MESSAGE',
      title: senderName,
      body: preview,
      message: `sent you a message: "${preview.slice(0, 80)}"`,
      relatedConversationId: msg.conversationId,
      relatedMessageId: msg.id,
      actionUrl: `/?view=messages&conversationId=${encodeURIComponent(msg.conversationId)}&uid=${encodeURIComponent(msg.senderId)}`,
      dedupeField: 'relatedMessageId',
      dedupeValue: msg.id,
    });
  }
);

// 3. Post Like / Reaction Trigger
export const onLikeCreated = onDocumentCreated(
  {
    document: 'likes/{likeId}',
    database: '(default)',
  },
  async (event) => {
    const like = event.data?.data() as
      | { postId: string; userId: string; reactionType?: string }
      | undefined;
    if (!like) return;

    const postSnap = await db.doc(`posts/${like.postId}`).get();
    if (!postSnap.exists) return;
    const postAuthorId = postSnap.data()?.authorId as string;
    if (!postAuthorId || postAuthorId === like.userId) return;

    const existingSnap = await db
      .collection('notifications')
      .where('recipientId', '==', postAuthorId)
      .where('relatedPostId', '==', like.postId)
      .limit(20)
      .get();
    const alreadyNotifiedLike = existingSnap.docs.some((d) => {
      const data = d.data() as NotificationDoc;
      return data.actorId === like.userId && normalizeType(data.type) === 'POST_LIKE';
    });
    if (alreadyNotifiedLike) return;

    const actorSnap = await db.doc(`users/${like.userId}`).get();
    const actorName = (actorSnap.data()?.fullName as string) || 'Someone';
    const reactionLabels: Record<string, string> = {
      love: '❤️ Love',
      haha: '😂 Haha',
      wow: '😮 Wow',
      sad: '😢 Sad',
      care: '🤗 Care',
    };
    const reactionText = like.reactionType ? reactionLabels[like.reactionType] : '';
    const title = reactionText ? 'New Reaction' : 'New Like';
    const actionPhrase = reactionText ? `reacted ${reactionText} to your post.` : 'liked your post.';

    await createNotificationIfAbsent({
      recipientId: postAuthorId,
      actorId: like.userId,
      type: 'POST_LIKE',
      title,
      body: `${actorName} ${actionPhrase}`,
      message: actionPhrase,
      postId: like.postId,
      relatedPostId: like.postId,
      actionUrl: `/?view=feed&post=${encodeURIComponent(like.postId)}`,
    });
  }
);

// 4. Comment & Reply Trigger
export const onCommentCreated = onDocumentCreated(
  {
    document: 'comments/{commentId}',
    database: '(default)',
  },
  async (event) => {
    const comment = event.data?.data() as
      | {
          id: string;
          postId: string;
          postAuthorId: string;
          authorId: string;
          authorName: string;
          text: string;
          replyToUserId?: string;
        }
      | undefined;
    if (!comment) return;

    const notified = new Set<string>([comment.authorId]);

    if (comment.replyToUserId && !notified.has(comment.replyToUserId)) {
      notified.add(comment.replyToUserId);
      await createNotificationIfAbsent({
        recipientId: comment.replyToUserId,
        actorId: comment.authorId,
        type: 'COMMENT_REPLY',
        title: 'New Reply',
        body: `${comment.authorName} replied to your comment: "${comment.text.slice(0, 80)}"`,
        message: `replied to your comment: "${comment.text.slice(0, 60)}"`,
        postId: comment.postId,
        relatedPostId: comment.postId,
        relatedCommentId: comment.id,
        actionUrl: `/?view=feed&post=${encodeURIComponent(comment.postId)}&commentId=${encodeURIComponent(comment.id)}`,
        dedupeField: 'relatedCommentId',
        dedupeValue: comment.id,
        dedupeMatchType: true,
      });
    }

    if (comment.postAuthorId && !notified.has(comment.postAuthorId)) {
      notified.add(comment.postAuthorId);
      await createNotificationIfAbsent({
        recipientId: comment.postAuthorId,
        actorId: comment.authorId,
        type: 'POST_COMMENT',
        title: 'New Comment',
        body: `${comment.authorName} commented on your post: "${comment.text.slice(0, 80)}"`,
        message: `commented on your post: "${comment.text.slice(0, 60)}"`,
        postId: comment.postId,
        relatedPostId: comment.postId,
        relatedCommentId: comment.id,
        actionUrl: `/?view=feed&post=${encodeURIComponent(comment.postId)}&commentId=${encodeURIComponent(comment.id)}`,
        dedupeField: 'relatedCommentId',
        dedupeValue: comment.id,
        dedupeMatchType: true,
      });
    }
  }
);

// 5. Follower Trigger
export const onFollowCreated = onDocumentCreated(
  {
    document: 'follows/{followId}',
    database: '(default)',
  },
  async (event) => {
    const follow = event.data?.data() as { followerId: string; followingId: string } | undefined;
    if (!follow) return;

    const existingSnap = await db
      .collection('notifications')
      .where('recipientId', '==', follow.followingId)
      .where('actorId', '==', follow.followerId)
      .limit(10)
      .get();
    const alreadyNotifiedFollow = existingSnap.docs.some(
      (d) => normalizeType((d.data() as NotificationDoc).type) === 'NEW_FOLLOWER'
    );
    if (alreadyNotifiedFollow) return;

    const actorSnap = await db.doc(`users/${follow.followerId}`).get();
    const actorName = (actorSnap.data()?.fullName as string) || 'Someone';

    await createNotificationIfAbsent({
      recipientId: follow.followingId,
      actorId: follow.followerId,
      type: 'NEW_FOLLOWER',
      title: 'New Follower',
      body: `${actorName} started following you.`,
      message: 'started following you.',
      actionUrl: `/?view=profile&uid=${encodeURIComponent(follow.followerId)}`,
    });
  }
);

// 6. Friend Request Created & Accepted Triggers
export const onFriendRequestCreated = onDocumentCreated(
  {
    document: 'friendRequests/{requestId}',
    database: '(default)',
  },
  async (event) => {
    const req = event.data?.data() as
      | { id: string; senderId: string; senderName: string; recipientId: string; status: string }
      | undefined;
    if (!req || req.status !== 'pending') return;

    await createNotificationIfAbsent({
      recipientId: req.recipientId,
      actorId: req.senderId,
      type: 'FRIEND_REQUEST',
      title: 'New Friend Request',
      body: `${req.senderName} sent you a friend request.`,
      message: 'sent you a friend request.',
      relatedRequestId: req.id,
      actionUrl: `/?view=notifications&tab=requests&requestId=${encodeURIComponent(req.id)}`,
      dedupeField: 'relatedRequestId',
      dedupeValue: req.id,
      dedupeMatchType: true,
    });
  }
);

export const onFriendRequestUpdated = onDocumentUpdated(
  {
    document: 'friendRequests/{requestId}',
    database: '(default)',
  },
  async (event) => {
    const before = event.data?.before.data() as { status?: string } | undefined;
    const after = event.data?.after.data() as
      | { id: string; senderId: string; recipientId: string; recipientName: string; status: string }
      | undefined;
    if (!before || !after) return;
    if (before.status === 'pending' && after.status === 'accepted') {
      const existingSnap = await db
        .collection('notifications')
        .where('recipientId', '==', after.senderId)
        .where('relatedRequestId', '==', after.id)
        .limit(10)
        .get();
      const alreadyAccepted = existingSnap.docs.some(
        (d) => normalizeType((d.data() as NotificationDoc).type) === 'FRIEND_REQUEST_ACCEPTED'
      );
      if (alreadyAccepted) return;

      await createNotificationIfAbsent({
        recipientId: after.senderId,
        actorId: after.recipientId,
        type: 'FRIEND_REQUEST_ACCEPTED',
        title: 'Friend Request Accepted',
        body: `${after.recipientName} accepted your friend request.`,
        message: 'accepted your friend request.',
        relatedRequestId: after.id,
        actionUrl: `/?view=profile&uid=${encodeURIComponent(after.recipientId)}`,
      });
    }
  }
);

// 7. Post Mention Trigger
export const onPostCreated = onDocumentCreated(
  {
    document: 'posts/{postId}',
    database: '(default)',
  },
  async (event) => {
    const post = event.data?.data() as
      | { id: string; authorId: string; authorName: string; authorUsername: string; caption: string }
      | undefined;
    if (!post || !post.caption) return;

    const handles = Array.from(
      new Set((post.caption.match(/@([a-zA-Z0-9_]{3,24})/g) || []).map((m) => m.slice(1).toLowerCase()))
    )
      .filter((h) => h !== (post.authorUsername || '').toLowerCase())
      .slice(0, 5);

    await Promise.all(
      handles.map(async (handle) => {
        const userSnap = await db
          .collection('users')
          .where('usernameLower', '==', handle)
          .limit(1)
          .get();
        if (userSnap.empty) return;
        const targetUid = userSnap.docs[0].id;
        await createNotificationIfAbsent({
          recipientId: targetUid,
          actorId: post.authorId,
          type: 'USER_MENTION',
          title: 'New Mention',
          body: `${post.authorName} mentioned you in a post.`,
          message: 'mentioned you in a post.',
          postId: post.id,
          relatedPostId: post.id,
          actionUrl: `/?view=feed&post=${encodeURIComponent(post.id)}`,
          dedupeField: 'relatedPostId',
          dedupeValue: post.id,
          dedupeMatchType: true,
        });
      })
    );
  }
);
