import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  Unsubscribe,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/firestoreError';
import { StoryItem, StoryLike, UserProfile } from '../types';

export async function createStory(params: {
  author: UserProfile;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  caption?: string;
}): Promise<StoryItem> {
  const storyRef = doc(collection(db, 'stories'));
  const expiresAtDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const expiresAt = Timestamp.fromDate(expiresAtDate);

  const payload = {
    id: storyRef.id,
    authorId: params.author.uid,
    authorUsername: params.author.username,
    authorName: params.author.fullName,
    authorAvatarUrl: (params.author.avatarUrl || '').slice(0, 32768),
    mediaUrl: params.mediaUrl.slice(0, 500000),
    mediaType: params.mediaType,
    caption: (params.caption || '').trim().slice(0, 280),
    visibility: 'public' as const,
    likesCount: 0,
    createdAt: serverTimestamp(),
    expiresAt,
  };

  try {
    await setDoc(storyRef, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `stories/${storyRef.id}`);
  }

  return {
    ...payload,
    createdAt: Timestamp.now(),
  };
}

export async function fetchActiveStories(maxCount = 50): Promise<StoryItem[]> {
  try {
    const q = query(
      collection(db, 'stories'),
      orderBy('createdAt', 'desc'),
      limit(Math.min(50, maxCount))
    );
    const snap = await getDocs(q);
    const nowMs = Date.now();
    return snap.docs
      .map((d) => d.data() as StoryItem)
      .filter((story) => !story.expiresAt || story.expiresAt.toMillis() > nowMs);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'stories');
  }
}

export function subscribeActiveStories(
  maxCount: number,
  callback: (stories: StoryItem[]) => void
): Unsubscribe {
  const q = query(
    collection(db, 'stories'),
    orderBy('createdAt', 'desc'),
    limit(Math.min(50, Math.max(1, maxCount)))
  );
  return onSnapshot(
    q,
    (snap) => {
      const nowMs = Date.now();
      const items = snap.docs
        .map((d) => d.data() as StoryItem)
        .filter((story) => !story.expiresAt || story.expiresAt.toMillis() > nowMs);
      callback(items);
    },
    () => {
      // Keep existing stories on transient listener errors
    }
  );
}

export function subscribeUserLikedStoryIds(
  uid: string,
  callback: (likedIds: Set<string>) => void
): Unsubscribe {
  const q = query(collection(db, 'storyLikes'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      callback(new Set(snap.docs.map((d) => d.data().storyId as string)));
    },
    () => {
      callback(new Set());
    }
  );
}

export async function toggleLikeStory(
  story: StoryItem,
  actor: UserProfile,
  currentlyLiked: boolean
): Promise<void> {
  const likeId = `${story.id}_${actor.uid}`;
  const likeRef = doc(db, 'storyLikes', likeId);
  const storyRef = doc(db, 'stories', story.id);
  const batch = writeBatch(db);

  if (currentlyLiked) {
    batch.delete(likeRef);
    batch.update(storyRef, {
      likesCount: increment(-1),
    });
  } else {
    batch.set(likeRef, {
      id: likeId,
      storyId: story.id,
      storyAuthorId: story.authorId,
      userId: actor.uid,
      userUsername: actor.username,
      userName: actor.fullName,
      userAvatarUrl: (actor.avatarUrl || '').slice(0, 32768),
      createdAt: serverTimestamp(),
    });
    batch.update(storyRef, {
      likesCount: increment(1),
    });
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `storyLikes/${likeId}`);
  }
}

export async function fetchStoryLikers(
  storyId: string,
  storyAuthorId: string
): Promise<StoryLike[]> {
  try {
    const q = query(
      collection(db, 'storyLikes'),
      where('storyAuthorId', '==', storyAuthorId),
      limit(100)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => d.data() as StoryLike)
      .filter((item) => item.storyId === storyId)
      .sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'storyLikes');
  }
}

export async function deleteStory(storyId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'stories', storyId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `stories/${storyId}`);
  }
}
