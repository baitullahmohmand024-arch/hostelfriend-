import {
  collection,
  deleteDoc,
  doc,
  DocumentSnapshot,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  handleFirestoreError,
  isPermissionDeniedError,
  OperationType,
} from '../lib/firestoreError';
import {
  AspectRatioType,
  CommentItem,
  MediaType,
  Post,
  PostReaction,
  ReactionCounts,
  ReactionType,
  UserProfile,
} from '../types';
import {
  computeNextReactionState,
  formatReactionNotificationAction,
  normalizeReactionType,
} from '../utils/reactions';
import {
  buildNotificationPayload,
  createAppNotification,
  shouldSkipDedupeKey,
} from './notificationService';
import { isLegacyVoteCommentText } from './pollService';

export async function createPost(params: {
  author: UserProfile;
  mediaUrl: string;
  thumbnailUrl?: string;
  mediaType: MediaType;
  aspectRatio: AspectRatioType;
  caption: string;
  hashtags: string[];
}): Promise<string> {
  const postRef = doc(collection(db, 'posts'));
  const batch = writeBatch(db);

  const basePostPayload = {
    id: postRef.id,
    authorId: params.author.uid,
    authorUsername: params.author.username,
    authorName: params.author.fullName,
    authorAvatarUrl: (params.author.avatarUrl || '').slice(0, 32768),
    mediaUrl: params.mediaType === 'text' ? '' : params.mediaUrl.slice(0, 500000),
    ...(params.thumbnailUrl ? { thumbnailUrl: params.thumbnailUrl.slice(0, 100000) } : {}),
    mediaType: params.mediaType,
    aspectRatio: params.aspectRatio,
    caption: params.caption.trim().slice(0, 1000),
    hashtags: params.hashtags.slice(0, 10),
    visibility: 'public' as const,
    likesCount: 0,
    commentsCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  batch.set(postRef, {
    ...basePostPayload,
    reactionCounts: {
      like: 0,
      love: 0,
      haha: 0,
      wow: 0,
      sad: 0,
      care: 0,
    },
  });

  batch.update(doc(db, 'users', params.author.uid), {
    postsCount: increment(1),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      const legacyBatch = writeBatch(db);
      legacyBatch.set(postRef, basePostPayload);
      legacyBatch.update(doc(db, 'users', params.author.uid), {
        postsCount: increment(1),
        updatedAt: serverTimestamp(),
      });
      try {
        await legacyBatch.commit();
      } catch (legacyError) {
        handleFirestoreError(legacyError, OperationType.CREATE, `posts/${postRef.id}`);
      }
    } else {
      handleFirestoreError(error, OperationType.CREATE, `posts/${postRef.id}`);
    }
  }

  // Send @mention notifications in the background so post publishing returns immediately
  const mentionMatches = Array.from(
    new Set((params.caption.match(/@([a-zA-Z0-9_]{3,24})/g) || []).map((m) => m.slice(1).toLowerCase()))
  ).slice(0, 5);

  if (mentionMatches.length > 0) {
    void Promise.all(
      mentionMatches
        .filter((handle) => handle !== params.author.usernameLower)
        .map(async (handle) => {
          try {
            const uq = query(collection(db, 'users'), where('usernameLower', '==', handle), limit(1));
            const uSnap = await getDocs(uq);
            if (!uSnap.empty) {
              const target = uSnap.docs[0].data() as UserProfile;
              await createAppNotification({
                recipientId: target.uid,
                actor: params.author,
                type: 'USER_MENTION',
                title: 'New Mention',
                body: `${params.author.fullName} mentioned you in a post.`,
                message: 'mentioned you in a post.',
                postId: postRef.id,
                relatedPostId: postRef.id,
              });
            }
          } catch {
            // Ignore non-critical mention notification failures
          }
        })
    );
  }

  return postRef.id;
}

export async function fetchPostById(postId: string): Promise<Post | null> {
  if (!postId) return null;
  try {
    const snap = await getDoc(doc(db, 'posts', postId));
    return snap.exists() ? (snap.data() as Post) : null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `posts/${postId}`);
  }
}

export async function deletePost(post: Post, isOwnerDelete: boolean): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'posts', post.id));
  if (isOwnerDelete) {
    batch.update(doc(db, 'users', post.authorId), {
      postsCount: increment(-1),
      updatedAt: serverTimestamp(),
    });
  }
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `posts/${post.id}`);
  }
}

export async function fetchPostsPage(
  lastSnapshot: DocumentSnapshot | null = null,
  pageSize = 12
): Promise<{ posts: Post[]; lastDoc: DocumentSnapshot | null; hasMore: boolean }> {
  try {
    const q = lastSnapshot
      ? query(collection(db, 'posts'), orderBy('createdAt', 'desc'), startAfter(lastSnapshot), limit(pageSize))
      : query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(pageSize));
    const snap = await getDocs(q);
    const posts = snap.docs.map((d) => d.data() as Post);
    const nextLast = snap.docs.length > 0 ? snap.docs[snap.docs.length - 1] : null;
    return {
      posts,
      lastDoc: nextLast,
      hasMore: snap.docs.length === pageSize,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'posts');
  }
}

export async function fetchPostsByAuthor(authorId: string): Promise<Post[]> {
  try {
    const q = query(collection(db, 'posts'), where('authorId', '==', authorId), limit(50));
    const snap = await getDocs(q);
    const posts = snap.docs.map((d) => d.data() as Post);
    return posts.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'posts');
  }
}

export async function fetchVideoMoments(): Promise<Post[]> {
  try {
    const q = query(collection(db, 'posts'), where('mediaType', '==', 'video'), limit(40));
    const snap = await getDocs(q);
    const posts = snap.docs.map((d) => d.data() as Post);
    return posts.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'posts');
  }
}

export async function fetchVideoMomentsPage(options: {
  lastSnapshot?: DocumentSnapshot | null;
  pageSize?: number;
} = {}): Promise<{ videos: Post[]; lastDoc: DocumentSnapshot | null; hasMore: boolean }> {
  const pageSize = Math.min(20, Math.max(4, Math.round(options.pageSize ?? 8)));
  const batchLimit = 25;
  const maxScanBatches = 3;

  try {
    let cursor = options.lastSnapshot ?? null;
    const collected: Post[] = [];
    const seenIds = new Set<string>();
    let exhausted = false;

    for (let batch = 0; batch < maxScanBatches; batch++) {
      const q = cursor
        ? query(
            collection(db, 'posts'),
            orderBy('createdAt', 'desc'),
            startAfter(cursor),
            limit(batchLimit)
          )
        : query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(batchLimit));

      const snap = await getDocs(q);
      if (snap.empty) {
        exhausted = true;
        break;
      }

      cursor = snap.docs[snap.docs.length - 1];
      for (const docSnap of snap.docs) {
        const post = docSnap.data() as Post;
        if (post.mediaType === 'video' && !seenIds.has(post.id)) {
          seenIds.add(post.id);
          collected.push(post);
        }
      }

      if (snap.docs.length < batchLimit) {
        exhausted = true;
        break;
      }
      if (collected.length >= pageSize) {
        break;
      }
    }

    // If initial chronological scan found fewer than pageSize videos (e.g. many text/image posts),
    // supplement once via the single-field mediaType index so older clips still appear cleanly.
    if (!options.lastSnapshot && collected.length < pageSize) {
      const videoQuery = query(
        collection(db, 'posts'),
        where('mediaType', '==', 'video'),
        limit(24)
      );
      const videoSnap = await getDocs(videoQuery);
      for (const docSnap of videoSnap.docs) {
        const post = docSnap.data() as Post;
        if (!seenIds.has(post.id)) {
          seenIds.add(post.id);
          collected.push(post);
        }
      }
      collected.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
    }

    return {
      videos: collected,
      lastDoc: cursor,
      hasMore: !exhausted && cursor !== null,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'posts');
  }
}

export async function fetchPostsByMediaType(
  mediaType: 'image' | 'video',
  maxCount = 36
): Promise<Post[]> {
  const safeLimit = Math.min(100, Math.max(1, Math.round(maxCount)));
  try {
    const q = query(collection(db, 'posts'), where('mediaType', '==', mediaType), limit(safeLimit));
    const snap = await getDocs(q);
    const posts = snap.docs.map((d) => d.data() as Post);
    return posts.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'posts');
  }
}

export async function fetchPostsByHashtag(tag: string): Promise<Post[]> {
  const cleanTag = tag.replace(/^#/, '').toLowerCase();
  if (!cleanTag) return [];
  try {
    const q = query(collection(db, 'posts'), where('hashtags', 'array-contains', cleanTag), limit(40));
    const snap = await getDocs(q);
    const posts = snap.docs.map((d) => d.data() as Post);
    return posts.sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'posts');
  }
}

export async function fetchTrendsSample(sampleSize = 100): Promise<Post[]> {
  const safeLimit = Math.min(100, Math.max(1, Math.round(sampleSize)));
  try {
    const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(safeLimit));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as Post);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'posts');
  }
}

export async function getUserPostReactions(uid: string): Promise<Map<string, ReactionType>> {
  try {
    const q = query(collection(db, 'likes'), where('userId', '==', uid));
    const snap = await getDocs(q);
    const reactions = new Map<string, ReactionType>();
    snap.docs.forEach((docSnap) => {
      const data = docSnap.data() as { postId?: string; reactionType?: string };
      if (data.postId) {
        reactions.set(data.postId, normalizeReactionType(data.reactionType));
      }
    });
    return reactions;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'likes');
  }
}

export async function getUserLikedPostIds(uid: string): Promise<Set<string>> {
  const reactions = await getUserPostReactions(uid);
  return new Set(reactions.keys());
}

export interface ReactToPostResult {
  previousReaction: ReactionType | null;
  nextReaction: ReactionType | null;
  nextLikesCount: number;
  nextReactionCounts: ReactionCounts;
  legacyNotice?: string;
}

let hasShownLegacyReactionNotice = false;

export async function reactToPost(
  post: Post,
  actor: UserProfile,
  targetReaction: ReactionType | null
): Promise<ReactToPostResult> {
  const likeId = `${post.id}_${actor.uid}`;
  const likeRef = doc(db, 'likes', likeId);
  const postRef = doc(db, 'posts', post.id);
  const safeAvatar = (actor.avatarUrl || '').slice(0, 32768);
  const safeUsername = (actor.username || 'member').slice(0, 24);
  const safeName = (actor.fullName || safeUsername || 'Member').slice(0, 64);

  try {
    return await runTransaction(db, async (transaction) => {
      const [postSnap, likeSnap] = await Promise.all([
        transaction.get(postRef),
        transaction.get(likeRef),
      ]);

      if (!postSnap.exists()) {
        throw new Error('This post is no longer available.');
      }

      const livePost = postSnap.data() as Post;
      const previousReaction = likeSnap.exists()
        ? normalizeReactionType((likeSnap.data() as { reactionType?: string }).reactionType)
        : null;

      const computed = computeNextReactionState(livePost, previousReaction, targetReaction);

      if (previousReaction === computed.nextReaction) {
        return {
          previousReaction,
          nextReaction: computed.nextReaction,
          nextLikesCount: computed.nextLikesCount,
          nextReactionCounts: computed.nextReactionCounts,
        };
      }

      if (computed.nextReaction === null && previousReaction !== null) {
        transaction.delete(likeRef);
        transaction.update(postRef, {
          likesCount: computed.nextLikesCount,
          reactionCounts: computed.nextReactionCounts,
          updatedAt: serverTimestamp(),
        });
      } else if (previousReaction === null && computed.nextReaction !== null) {
        transaction.set(likeRef, {
          id: likeId,
          postId: post.id,
          userId: actor.uid,
          reactionType: computed.nextReaction,
          userUsername: safeUsername,
          userName: safeName,
          userAvatarUrl: safeAvatar,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        transaction.update(postRef, {
          likesCount: computed.nextLikesCount,
          reactionCounts: computed.nextReactionCounts,
          updatedAt: serverTimestamp(),
        });

        if (
          livePost.authorId !== actor.uid &&
          !shouldSkipDedupeKey(`like:${actor.uid}:${post.id}`)
        ) {
          const notifRef = doc(collection(db, 'notifications'));
          const { title, actionPhrase } = formatReactionNotificationAction(computed.nextReaction);
          transaction.set(
            notifRef,
            buildNotificationPayload(notifRef.id, {
              recipientId: livePost.authorId,
              actor,
              type: 'POST_LIKE',
              title,
              body: `${safeName} ${actionPhrase}`,
              message: actionPhrase,
              postId: post.id,
              relatedPostId: post.id,
            })
          );
        }
      } else if (previousReaction !== null && computed.nextReaction !== null) {
        transaction.update(likeRef, {
          reactionType: computed.nextReaction,
          userUsername: safeUsername,
          userName: safeName,
          userAvatarUrl: safeAvatar,
          updatedAt: serverTimestamp(),
        });
        transaction.update(postRef, {
          reactionCounts: computed.nextReactionCounts,
          updatedAt: serverTimestamp(),
        });
      }

      return {
        previousReaction,
        nextReaction: computed.nextReaction,
        nextLikesCount: computed.nextLikesCount,
        nextReactionCounts: computed.nextReactionCounts,
      };
    });
  } catch (error) {
    if (!isPermissionDeniedError(error)) {
      handleFirestoreError(error, OperationType.WRITE, `likes/${likeId}`);
    }

    // Legacy rules fallback: currently deployed rules on hostelify-ddc5a may only permit
    // the 4-field like doc { id, postId, userId, createdAt } and { likesCount, updatedAt } on posts.
    let postAuthorIdForNotif: string | null = null;
    try {
      const legacyResult = await runTransaction(db, async (transaction) => {
        const [postSnap, likeSnap] = await Promise.all([
          transaction.get(postRef),
          transaction.get(likeRef),
        ]);

        if (!postSnap.exists()) {
          throw new Error('This post is no longer available.');
        }

        const livePost = postSnap.data() as Post;
        const previousReaction = likeSnap.exists()
          ? normalizeReactionType((likeSnap.data() as { reactionType?: string }).reactionType)
          : null;

        if (targetReaction === null || targetReaction === previousReaction) {
          if (!likeSnap.exists()) {
            const computedNoop = computeNextReactionState(livePost, null, null);
            return {
              previousReaction: null,
              nextReaction: null,
              nextLikesCount: computedNoop.nextLikesCount,
              nextReactionCounts: computedNoop.nextReactionCounts,
            };
          }
          const nextLikes = Math.max(0, Math.floor(Number(livePost.likesCount) || 0) - 1);
          const computed = computeNextReactionState(livePost, previousReaction, null);
          transaction.delete(likeRef);
          transaction.update(postRef, {
            likesCount: nextLikes,
            updatedAt: serverTimestamp(),
          });
          return {
            previousReaction,
            nextReaction: null,
            nextLikesCount: nextLikes,
            nextReactionCounts: computed.nextReactionCounts,
          };
        }

        if (likeSnap.exists()) {
          throw new Error(
            'Deploy the updated firestore.rules to Firebase to switch between reaction types.'
          );
        }

        const nextLikes = Math.max(0, Math.floor(Number(livePost.likesCount) || 0)) + 1;
        const computed = computeNextReactionState(livePost, null, 'like');
        transaction.set(likeRef, {
          id: likeId,
          postId: post.id,
          userId: actor.uid,
          createdAt: serverTimestamp(),
        });
        transaction.update(postRef, {
          likesCount: nextLikes,
          updatedAt: serverTimestamp(),
        });
        postAuthorIdForNotif = livePost.authorId;

        let legacyNotice: string | undefined;
        if (targetReaction !== 'like' && !hasShownLegacyReactionNotice) {
          hasShownLegacyReactionNotice = true;
          legacyNotice =
            'Saved as Like. Publish the updated firestore.rules in Firebase Console to enable all 6 reaction types.';
        }

        return {
          previousReaction: null,
          nextReaction: 'like' as ReactionType,
          nextLikesCount: nextLikes,
          nextReactionCounts: computed.nextReactionCounts,
          legacyNotice,
        };
      });

      if (
        postAuthorIdForNotif &&
        postAuthorIdForNotif !== actor.uid &&
        legacyResult.nextReaction !== null
      ) {
        void createAppNotification({
          recipientId: postAuthorIdForNotif,
          actor,
          type: 'POST_LIKE',
          title: 'New Like',
          body: `${safeName} liked your post.`,
          message: 'liked your post.',
          postId: post.id,
          relatedPostId: post.id,
          dedupeKey: `like:${actor.uid}:${post.id}`,
        }).catch(() => {
          // Non-blocking under legacy rules
        });
      }

      return legacyResult;
    } catch (legacyError) {
      if (
        legacyError instanceof Error &&
        legacyError.message.includes('Deploy the updated firestore.rules')
      ) {
        throw legacyError;
      }
      handleFirestoreError(legacyError, OperationType.WRITE, `likes/${likeId}`);
    }
  }
}

export async function toggleLikePost(
  post: Post,
  actor: UserProfile,
  currentlyLiked: boolean
): Promise<void> {
  await reactToPost(post, actor, currentlyLiked ? null : 'like');
}

export async function fetchPostReactions(
  postId: string,
  maxCount = 80
): Promise<PostReaction[]> {
  if (!postId) return [];
  const safeLimit = Math.min(100, Math.max(1, Math.round(maxCount)));
  try {
    const q = query(collection(db, 'likes'), where('postId', '==', postId), limit(safeLimit));
    const snap = await getDocs(q);
    const records: PostReaction[] = snap.docs.map((docSnap) => {
      const data = docSnap.data() as Partial<PostReaction>;
      return {
        id: data.id || docSnap.id,
        postId: data.postId || postId,
        userId: data.userId || '',
        reactionType: normalizeReactionType(data.reactionType),
        userUsername: data.userUsername,
        userName: data.userName,
        userAvatarUrl: data.userAvatarUrl,
        createdAt: data.createdAt || null,
        updatedAt: data.updatedAt || null,
      };
    });

    // Hydrate profile details for legacy /likes docs that predate snapshot fields
    const missingProfileUids = Array.from(
      new Set(
        records
          .filter((item) => item.userId && (!item.userName || !item.userUsername))
          .map((item) => item.userId)
      )
    ).slice(0, 30);

    if (missingProfileUids.length > 0) {
      const profileEntries = await Promise.all(
        missingProfileUids.map(async (uid) => {
          try {
            const uSnap = await getDoc(doc(db, 'users', uid));
            return uSnap.exists() ? ([uid, uSnap.data() as UserProfile] as const) : null;
          } catch {
            return null;
          }
        })
      );
      const profileMap = new Map<string, UserProfile>();
      profileEntries.forEach((entry) => {
        if (entry) profileMap.set(entry[0], entry[1]);
      });

      records.forEach((item) => {
        const user = profileMap.get(item.userId);
        if (user) {
          item.userName = item.userName || user.fullName;
          item.userUsername = item.userUsername || user.username;
          item.userAvatarUrl = item.userAvatarUrl ?? user.avatarUrl;
        }
      });
    }

    return records.sort((a, b) => {
      const aTime = (a.updatedAt || a.createdAt)?.toMillis() || 0;
      const bTime = (b.updatedAt || b.createdAt)?.toMillis() || 0;
      return bTime - aTime;
    });
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      throw new Error(
        'Publish the updated firestore.rules to Firebase (hostelify-ddc5a) to view everyone who reacted to this post.'
      );
    }
    handleFirestoreError(error, OperationType.LIST, 'likes');
  }
}

export async function getUserSavedPostIds(uid: string): Promise<Set<string>> {
  try {
    const q = query(collection(db, 'savedPosts'), where('userId', '==', uid));
    const snap = await getDocs(q);
    return new Set(snap.docs.map((d) => d.data().postId as string));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'savedPosts');
  }
}

export async function toggleSavePost(
  postId: string,
  uid: string,
  currentlySaved: boolean
): Promise<void> {
  const saveId = `${uid}_${postId}`;
  const saveRef = doc(db, 'savedPosts', saveId);
  try {
    if (currentlySaved) {
      await deleteDoc(saveRef);
    } else {
      await setDoc(saveRef, {
        id: saveId,
        userId: uid,
        postId,
        createdAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `savedPosts/${saveId}`);
  }
}

export async function fetchComments(postId: string): Promise<CommentItem[]> {
  try {
    const q = query(collection(db, 'comments'), where('postId', '==', postId), limit(100));
    const snap = await getDocs(q);
    const list = snap.docs
      .map((d) => d.data() as CommentItem)
      .filter((c) => isLegacyVoteCommentText(c.text) === null);
    return list.sort((a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'comments');
  }
}

export async function addComment(
  post: Post,
  actor: UserProfile,
  text: string,
  replyTo?: {
    parentCommentId: string;
    replyToUserId: string;
    replyToUsername: string;
  }
): Promise<CommentItem> {
  const cleanText = text.trim().slice(0, 500);
  if (!cleanText) throw new Error('Comment cannot be empty.');

  const commentRef = doc(collection(db, 'comments'));
  const batch = writeBatch(db);

  const commentData = {
    id: commentRef.id,
    postId: post.id,
    postAuthorId: post.authorId,
    authorId: actor.uid,
    authorUsername: actor.username,
    authorName: actor.fullName,
    authorAvatarUrl: actor.avatarUrl,
    text: cleanText,
    ...(replyTo
      ? {
          parentCommentId: replyTo.parentCommentId,
          replyToUserId: replyTo.replyToUserId,
          replyToUsername: replyTo.replyToUsername,
        }
      : {}),
    isPublic: true,
    createdAt: serverTimestamp(),
  };

  batch.set(commentRef, commentData);
  batch.update(doc(db, 'posts', post.id), {
    commentsCount: increment(1),
    updatedAt: serverTimestamp(),
  });

  const notifiedUids = new Set<string>([actor.uid]);

  if (replyTo && replyTo.replyToUserId && !notifiedUids.has(replyTo.replyToUserId)) {
    notifiedUids.add(replyTo.replyToUserId);
    const replyNotifRef = doc(collection(db, 'notifications'));
    batch.set(
      replyNotifRef,
      buildNotificationPayload(replyNotifRef.id, {
        recipientId: replyTo.replyToUserId,
        actor,
        type: 'COMMENT_REPLY',
        title: 'New Reply',
        body: `${actor.fullName} replied to your comment.`,
        message: `replied to your comment: "${cleanText.slice(0, 60)}"`,
        postId: post.id,
        relatedPostId: post.id,
        relatedCommentId: commentRef.id,
      })
    );
  }

  if (post.authorId !== actor.uid && !notifiedUids.has(post.authorId)) {
    notifiedUids.add(post.authorId);
    const notifRef = doc(collection(db, 'notifications'));
    batch.set(
      notifRef,
      buildNotificationPayload(notifRef.id, {
        recipientId: post.authorId,
        actor,
        type: 'POST_COMMENT',
        title: 'New Comment',
        body: `${actor.fullName} commented on your post.`,
        message: `commented on your post: "${cleanText.slice(0, 60)}"`,
        postId: post.id,
        relatedPostId: post.id,
        relatedCommentId: commentRef.id,
      })
    );
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `comments/${commentRef.id}`);
  }

  // Send @mention notifications for users tagged inside the comment
  const mentionMatches = Array.from(
    new Set((cleanText.match(/@([a-zA-Z0-9_]{3,24})/g) || []).map((m) => m.slice(1).toLowerCase()))
  ).slice(0, 5);

  if (mentionMatches.length > 0) {
    void Promise.all(
      mentionMatches
        .filter((handle) => handle !== actor.usernameLower)
        .map(async (handle) => {
          try {
            const uq = query(collection(db, 'users'), where('usernameLower', '==', handle), limit(1));
            const uSnap = await getDocs(uq);
            if (!uSnap.empty) {
              const target = uSnap.docs[0].data() as UserProfile;
              if (!notifiedUids.has(target.uid)) {
                notifiedUids.add(target.uid);
                await createAppNotification({
                  recipientId: target.uid,
                  actor,
                  type: 'USER_MENTION',
                  title: 'Mentioned in Comment',
                  body: `${actor.fullName} mentioned you in a comment.`,
                  message: `mentioned you in a comment: "${cleanText.slice(0, 60)}"`,
                  postId: post.id,
                  relatedPostId: post.id,
                  relatedCommentId: commentRef.id,
                });
              }
            }
          } catch {
            // Ignore non-critical mention notification failures
          }
        })
    );
  }

  return {
    ...commentData,
    createdAt: null,
  };
}

export async function deleteComment(comment: CommentItem): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'comments', comment.id));
  batch.update(doc(db, 'posts', comment.postId), {
    commentsCount: increment(-1),
    updatedAt: serverTimestamp(),
  });
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `comments/${comment.id}`);
  }
}
