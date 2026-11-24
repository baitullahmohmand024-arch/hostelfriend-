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
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  Unsubscribe,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  formatUserFriendlyError,
  handleFirestoreError,
  isPermissionDeniedError,
  OperationType,
} from '../lib/firestoreError';
import { CommentItem, Poll, Post, UserProfile } from '../types';

export const POLL_QUESTION_MIN = 3;
export const POLL_QUESTION_MAX = 280;
export const POLL_OPTIONS_MIN = 2;
export const POLL_OPTIONS_MAX = 6;
export const POLL_OPTION_MAX_LEN = 80;

export const LEGACY_POLL_TAG = 'hostelpoll';
const LEGACY_POLL_JSON_PREFIX = '[HF_POLL]';
const LEGACY_POLL_JSON_SUFFIX = '[/HF_POLL]';
const LEGACY_POLL_LINE_PREFIX = '[HF_POLL_V1]';
const LEGACY_VOTE_REGEX = /^\[HF_VOTE:([0-5])\]$/;

export interface PollValidationResult {
  valid: boolean;
  error?: string;
  cleanQuestion: string;
  cleanOptions: string[];
}

function sanitizePollAuthor(author: UserProfile) {
  const rawUsername = (author.username || 'member').replace(/[^a-zA-Z0-9_]/g, '');
  const safeUsername = (
    rawUsername.length >= 3 ? rawUsername : `${rawUsername}___`.slice(0, 3)
  ).slice(0, 24);
  const safeName = (author.fullName || safeUsername || 'Member').trim().slice(0, 64) || 'Member';
  const safeAvatar = (author.avatarUrl || '').slice(0, 32768);
  return { safeUsername, safeName, safeAvatar };
}

export function encodeLegacyPollCaption(question: string, options: string[]): string {
  const cleanQ = question.trim().replace(/\s+/g, ' ').slice(0, POLL_QUESTION_MAX);
  const cleanOpts = options
    .slice(0, POLL_OPTIONS_MAX)
    .map((opt) => opt.trim().replace(/\s+/g, ' ').slice(0, POLL_OPTION_MAX_LEN));

  const jsonEncoded = `${LEGACY_POLL_JSON_PREFIX}${JSON.stringify({ q: cleanQ, o: cleanOpts })}${LEGACY_POLL_JSON_SUFFIX}`;
  if (jsonEncoded.length <= 1000) {
    return jsonEncoded;
  }

  return `${LEGACY_POLL_LINE_PREFIX}\n${cleanQ}\n${cleanOpts.join('\n')}`.slice(0, 1000);
}

export function isLegacyVoteCommentText(text: string | undefined | null): number | null {
  if (typeof text !== 'string') return null;
  const match = LEGACY_VOTE_REGEX.exec(text.trim());
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed >= 0 && parsed < POLL_OPTIONS_MAX ? parsed : null;
}

export function parseLegacyPollPost(
  post: Post,
  countsOverride?: number[]
): Poll | null {
  if (!post || post.mediaType !== 'text' || typeof post.caption !== 'string') {
    return null;
  }

  const trimmed = post.caption.trim();
  let question = '';
  let options: string[] = [];

  if (
    trimmed.startsWith(LEGACY_POLL_JSON_PREFIX) &&
    trimmed.endsWith(LEGACY_POLL_JSON_SUFFIX)
  ) {
    const rawJson = trimmed.slice(
      LEGACY_POLL_JSON_PREFIX.length,
      trimmed.length - LEGACY_POLL_JSON_SUFFIX.length
    );
    try {
      const parsed = JSON.parse(rawJson) as { q?: unknown; o?: unknown };
      if (typeof parsed.q === 'string' && Array.isArray(parsed.o)) {
        question = parsed.q.trim();
        options = parsed.o.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
      }
    } catch {
      return null;
    }
  } else if (trimmed.startsWith(`${LEGACY_POLL_LINE_PREFIX}\n`)) {
    const lines = trimmed
      .slice(LEGACY_POLL_LINE_PREFIX.length + 1)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length >= 3) {
      question = lines[0];
      options = lines.slice(1, 1 + POLL_OPTIONS_MAX);
    }
  } else {
    return null;
  }

  if (
    question.length < POLL_QUESTION_MIN ||
    options.length < POLL_OPTIONS_MIN ||
    options.length > POLL_OPTIONS_MAX
  ) {
    return null;
  }

  const counts = [0, 0, 0, 0, 0, 0];
  if (countsOverride) {
    for (let i = 0; i < POLL_OPTIONS_MAX; i++) {
      counts[i] = Math.max(0, Math.floor(countsOverride[i] || 0));
    }
  }
  const sumCounts = counts.reduce((sum, n) => sum + n, 0);
  const totalVotes = countsOverride
    ? sumCounts
    : Math.max(0, Math.floor(Number(post.commentsCount) || 0));

  return {
    id: post.id,
    authorId: post.authorId,
    authorUsername: post.authorUsername,
    authorName: post.authorName,
    authorAvatarUrl: post.authorAvatarUrl || '',
    question,
    options,
    count0: counts[0],
    count1: counts[1],
    count2: counts[2],
    count3: counts[3],
    count4: counts[4],
    count5: counts[5],
    totalVotes,
    visibility: 'public',
    storageMode: 'legacy-post',
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

export function isLegacyPollPost(post: Post): boolean {
  return parseLegacyPollPost(post) !== null;
}

export function validatePollInput(question: string, rawOptions: string[]): PollValidationResult {
  const cleanQuestion = question.trim().replace(/\s+/g, ' ');
  if (cleanQuestion.length < POLL_QUESTION_MIN) {
    return {
      valid: false,
      error: `Enter a poll question of at least ${POLL_QUESTION_MIN} characters.`,
      cleanQuestion,
      cleanOptions: [],
    };
  }
  if (cleanQuestion.length > POLL_QUESTION_MAX) {
    return {
      valid: false,
      error: `Poll question cannot exceed ${POLL_QUESTION_MAX} characters.`,
      cleanQuestion,
      cleanOptions: [],
    };
  }

  if (rawOptions.length < POLL_OPTIONS_MIN || rawOptions.length > POLL_OPTIONS_MAX) {
    return {
      valid: false,
      error: `A poll must have between ${POLL_OPTIONS_MIN} and ${POLL_OPTIONS_MAX} options.`,
      cleanQuestion,
      cleanOptions: [],
    };
  }

  const cleanOptions = rawOptions.map((opt) => opt.trim().replace(/\s+/g, ' '));
  const emptyIndex = cleanOptions.findIndex((opt) => opt.length === 0);
  if (emptyIndex !== -1) {
    return {
      valid: false,
      error: `Option ${emptyIndex + 1} cannot be empty. Fill it in or remove it.`,
      cleanQuestion,
      cleanOptions,
    };
  }

  const tooLongIndex = cleanOptions.findIndex((opt) => opt.length > POLL_OPTION_MAX_LEN);
  if (tooLongIndex !== -1) {
    return {
      valid: false,
      error: `Option ${tooLongIndex + 1} cannot exceed ${POLL_OPTION_MAX_LEN} characters.`,
      cleanQuestion,
      cleanOptions,
    };
  }

  const seen = new Set<string>();
  for (const opt of cleanOptions) {
    const key = opt.toLowerCase();
    if (seen.has(key)) {
      return {
        valid: false,
        error: `Duplicate option "${opt}" found. Every poll option must be unique.`,
        cleanQuestion,
        cleanOptions,
      };
    }
    seen.add(key);
  }

  return {
    valid: true,
    cleanQuestion,
    cleanOptions,
  };
}

export async function createPoll(params: {
  author: UserProfile;
  question: string;
  options: string[];
}): Promise<Poll> {
  const validation = validatePollInput(params.question, params.options);
  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid poll input.');
  }

  const { safeUsername, safeName, safeAvatar } = sanitizePollAuthor(params.author);
  const pollRef = doc(collection(db, 'polls'));
  const payload = {
    id: pollRef.id,
    authorId: params.author.uid,
    authorUsername: safeUsername,
    authorName: safeName,
    authorAvatarUrl: safeAvatar,
    question: validation.cleanQuestion.slice(0, POLL_QUESTION_MAX),
    options: validation.cleanOptions.slice(0, POLL_OPTIONS_MAX),
    count0: 0,
    count1: 0,
    count2: 0,
    count3: 0,
    count4: 0,
    count5: 0,
    totalVotes: 0,
    visibility: 'public' as const,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(pollRef, payload);
    const now = Timestamp.now();
    return {
      ...payload,
      storageMode: 'polls',
      createdAt: now,
      updatedAt: now,
    };
  } catch (error) {
    if (!isPermissionDeniedError(error)) {
      handleFirestoreError(error, OperationType.CREATE, `polls/${pollRef.id}`);
    }

    // Fallback when deployed Firestore rules on the project do not yet include /polls
    const legacyPostRef = doc(db, 'posts', pollRef.id);
    const legacyCaption = encodeLegacyPollCaption(
      validation.cleanQuestion,
      validation.cleanOptions
    );
    const batch = writeBatch(db);
    batch.set(legacyPostRef, {
      id: pollRef.id,
      authorId: params.author.uid,
      authorUsername: safeUsername,
      authorName: safeName,
      authorAvatarUrl: safeAvatar,
      mediaUrl: '',
      mediaType: 'text',
      aspectRatio: 'square',
      caption: legacyCaption,
      hashtags: [LEGACY_POLL_TAG],
      visibility: 'public',
      likesCount: 0,
      commentsCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'users', params.author.uid), {
      postsCount: increment(1),
      updatedAt: serverTimestamp(),
    });

    try {
      await batch.commit();
    } catch (legacyError) {
      handleFirestoreError(legacyError, OperationType.CREATE, `posts/${pollRef.id}`);
    }

    const now = Timestamp.now();
    return {
      ...payload,
      storageMode: 'legacy-post',
      createdAt: now,
      updatedAt: now,
    };
  }
}

async function fetchLegacyPollVoteTallies(
  pollId: string,
  optionsCount: number
): Promise<number[]> {
  const counts = [0, 0, 0, 0, 0, 0];
  const q = query(collection(db, 'comments'), where('postId', '==', pollId), limit(100));
  const snap = await getDocs(q);
  const seenVoters = new Set<string>();

  snap.docs.forEach((docSnap) => {
    const data = docSnap.data() as Partial<CommentItem>;
    const idx = isLegacyVoteCommentText(data.text);
    if (idx === null || idx >= optionsCount) return;
    const voterKey = data.authorId || docSnap.id;
    if (seenVoters.has(voterKey)) return;
    seenVoters.add(voterKey);
    counts[idx] += 1;
  });

  return counts;
}

export function subscribePolls(
  maxCount: number,
  callback: (polls: Poll[]) => void,
  onError?: (message: string) => void
): Unsubscribe {
  const safeLimit = Math.min(50, Math.max(1, Math.round(maxCount)));
  let disposed = false;
  let nativePolls: Poll[] = [];
  let legacyPosts: Post[] = [];
  const tallyCache = new Map<string, { commentsCount: number; counts: number[] }>();
  const pendingTallies = new Set<string>();

  const emitMerged = () => {
    if (disposed) return;
    const merged = new Map<string, Poll>();

    for (const post of legacyPosts) {
      const cached = tallyCache.get(post.id);
      const parsed = parseLegacyPollPost(post, cached?.counts);
      if (parsed) {
        merged.set(parsed.id, parsed);
      }
    }

    for (const poll of nativePolls) {
      merged.set(poll.id, { ...poll, storageMode: 'polls' });
    }

    const sorted = Array.from(merged.values()).sort(
      (a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0)
    );
    callback(sorted.slice(0, safeLimit));
  };

  const hydrateLegacyTallies = (postsToCheck: Post[]) => {
    for (const post of postsToCheck) {
      const parsed = parseLegacyPollPost(post);
      if (!parsed) continue;
      const liveCommentsCount = Math.max(0, Math.floor(Number(post.commentsCount) || 0));
      const cached = tallyCache.get(post.id);

      if (liveCommentsCount === 0) {
        if (!cached || cached.commentsCount !== 0) {
          tallyCache.set(post.id, { commentsCount: 0, counts: [0, 0, 0, 0, 0, 0] });
        }
        continue;
      }

      if (cached && cached.commentsCount === liveCommentsCount) {
        continue;
      }
      if (pendingTallies.has(post.id)) continue;

      pendingTallies.add(post.id);
      void fetchLegacyPollVoteTallies(post.id, parsed.options.length)
        .then((counts) => {
          tallyCache.set(post.id, { commentsCount: liveCommentsCount, counts });
          emitMerged();
        })
        .catch(() => {
          // Keep last known counts if vote tally lookup fails transiently
        })
        .finally(() => {
          pendingTallies.delete(post.id);
        });
    }
  };

  const nativeQuery = query(
    collection(db, 'polls'),
    orderBy('createdAt', 'desc'),
    limit(safeLimit)
  );
  let unsubNative: Unsubscribe | null = null;
  unsubNative = onSnapshot(
    nativeQuery,
    (snap) => {
      nativePolls = snap.docs.map((d) => ({
        ...(d.data({ serverTimestamps: 'estimate' }) as Poll),
        storageMode: 'polls',
      }));
      emitMerged();
    },
    (error) => {
      if (isPermissionDeniedError(error)) {
        // Live rules on project do not expose /polls yet; legacy post-backed polls handle the feed
        unsubNative?.();
        unsubNative = null;
        return;
      }
      onError?.(formatUserFriendlyError(error, 'Could not sync live polls.'));
    }
  );

  const legacyQuery = query(
    collection(db, 'posts'),
    where('hashtags', 'array-contains', LEGACY_POLL_TAG),
    limit(safeLimit)
  );
  const unsubLegacy = onSnapshot(
    legacyQuery,
    (snap) => {
      legacyPosts = snap.docs
        .map((d) => d.data({ serverTimestamps: 'estimate' }) as Post)
        .filter((post) => isLegacyPollPost(post));
      emitMerged();
      hydrateLegacyTallies(legacyPosts);
    },
    () => {
      // Preserve last known poll stream on transient listener errors
    }
  );

  return () => {
    disposed = true;
    unsubNative?.();
    unsubLegacy();
  };
}

export function subscribeUserPollVotes(
  uid: string,
  callback: (votesByPollId: Map<string, number>) => void
): Unsubscribe {
  const nativeVotes = new Map<string, number>();
  const legacyVotes = new Map<string, number>();

  const emitMerged = () => {
    const merged = new Map<string, number>();
    legacyVotes.forEach((idx, pollId) => merged.set(pollId, idx));
    nativeVotes.forEach((idx, pollId) => merged.set(pollId, idx));
    callback(merged);
  };

  const nativeQuery = query(collection(db, 'pollVotes'), where('userId', '==', uid));
  let unsubNative: Unsubscribe | null = null;
  unsubNative = onSnapshot(
    nativeQuery,
    (snap) => {
      nativeVotes.clear();
      snap.docs.forEach((d) => {
        const data = d.data() as { pollId?: string; optionIndex?: number };
        if (typeof data.pollId === 'string' && typeof data.optionIndex === 'number') {
          nativeVotes.set(data.pollId, data.optionIndex);
        }
      });
      emitMerged();
    },
    (error) => {
      if (isPermissionDeniedError(error)) {
        unsubNative?.();
        unsubNative = null;
      }
    }
  );

  const legacyQuery = query(
    collection(db, 'comments'),
    where('authorId', '==', uid),
    limit(100)
  );
  const unsubLegacy = onSnapshot(
    legacyQuery,
    (snap) => {
      legacyVotes.clear();
      snap.docs.forEach((d) => {
        const data = d.data() as Partial<CommentItem>;
        const idx = isLegacyVoteCommentText(data.text);
        if (idx !== null && typeof data.postId === 'string') {
          legacyVotes.set(data.postId, idx);
        }
      });
      emitMerged();
    },
    () => {
      // Preserve last known vote map on transient listener failure
    }
  );

  return () => {
    unsubNative?.();
    unsubLegacy();
  };
}

export async function castPollVote(
  poll: Poll,
  actor: UserProfile,
  optionIndex: number
): Promise<void> {
  if (!poll?.id || !actor?.uid) {
    throw new Error('Sign in to vote in this poll.');
  }
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex >= POLL_OPTIONS_MAX) {
    throw new Error('Invalid poll option selected.');
  }
  if (optionIndex >= poll.options.length) {
    throw new Error('Selected option is not valid for this poll.');
  }

  const voteId = `${poll.id}_${actor.uid}`;

  if (poll.storageMode !== 'legacy-post') {
    const pollRef = doc(db, 'polls', poll.id);
    const voteRef = doc(db, 'pollVotes', voteId);

    try {
      await runTransaction(db, async (tx) => {
        const [pollSnap, voteSnap] = await Promise.all([tx.get(pollRef), tx.get(voteRef)]);

        if (!pollSnap.exists()) {
          throw new Error('This poll is no longer available.');
        }

        const pollData = pollSnap.data() as Poll;
        if (optionIndex >= pollData.options.length) {
          throw new Error('Selected option is not valid for this poll.');
        }

        if (voteSnap.exists()) {
          throw new Error('You have already voted in this poll.');
        }

        tx.set(voteRef, {
          id: voteId,
          pollId: poll.id,
          userId: actor.uid,
          optionIndex,
          createdAt: serverTimestamp(),
        });

        tx.update(pollRef, {
          [`count${optionIndex}`]: increment(1),
          totalVotes: increment(1),
          updatedAt: serverTimestamp(),
        });
      });
      return;
    } catch (error) {
      if (!isPermissionDeniedError(error)) {
        if (
          error instanceof Error &&
          !(error as { code?: string }).code &&
          (error.message.includes('already voted') ||
            error.message.includes('no longer available') ||
            error.message.includes('not valid'))
        ) {
          throw error;
        }
        handleFirestoreError(error, OperationType.WRITE, `pollVotes/${voteId}`);
      }
      // Fall through to legacy-post vote transaction on permission-denied
    }
  }

  const { safeUsername, safeName, safeAvatar } = sanitizePollAuthor(actor);
  const postRef = doc(db, 'posts', poll.id);
  const legacyVoteRef = doc(db, 'comments', voteId);

  try {
    await runTransaction(db, async (tx) => {
      const [postSnap, voteSnap] = await Promise.all([tx.get(postRef), tx.get(legacyVoteRef)]);

      if (!postSnap.exists()) {
        throw new Error('This poll is no longer available.');
      }

      const postData = postSnap.data() as Post;
      const parsed = parseLegacyPollPost(postData);
      const optionLimit = parsed ? parsed.options.length : poll.options.length;
      if (optionIndex >= optionLimit) {
        throw new Error('Selected option is not valid for this poll.');
      }

      if (voteSnap.exists()) {
        throw new Error('You have already voted in this poll.');
      }

      tx.set(legacyVoteRef, {
        id: voteId,
        postId: poll.id,
        postAuthorId: postData.authorId,
        authorId: actor.uid,
        authorUsername: safeUsername,
        authorName: safeName,
        authorAvatarUrl: safeAvatar,
        text: `[HF_VOTE:${optionIndex}]`,
        isPublic: true,
        createdAt: serverTimestamp(),
      });

      tx.update(postRef, {
        commentsCount: increment(1),
        updatedAt: serverTimestamp(),
      });
    });
  } catch (error) {
    if (
      error instanceof Error &&
      !(error as { code?: string }).code &&
      (error.message.includes('already voted') ||
        error.message.includes('no longer available') ||
        error.message.includes('not valid'))
    ) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, `comments/${voteId}`);
  }
}

export async function deletePoll(poll: Poll, isOwnerDelete = false): Promise<void> {
  if (poll.storageMode === 'legacy-post') {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'posts', poll.id));
    if (isOwnerDelete) {
      batch.update(doc(db, 'users', poll.authorId), {
        postsCount: increment(-1),
        updatedAt: serverTimestamp(),
      });
    }
    try {
      await batch.commit();
      return;
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `posts/${poll.id}`);
    }
  }

  try {
    await deleteDoc(doc(db, 'polls', poll.id));
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'posts', poll.id));
      if (isOwnerDelete) {
        batch.update(doc(db, 'users', poll.authorId), {
          postsCount: increment(-1),
          updatedAt: serverTimestamp(),
        });
      }
      try {
        await batch.commit();
        return;
      } catch (legacyError) {
        handleFirestoreError(legacyError, OperationType.DELETE, `posts/${poll.id}`);
      }
    }
    handleFirestoreError(error, OperationType.DELETE, `polls/${poll.id}`);
  }
}

export function getPollOptionCounts(poll: Poll): number[] {
  const rawCounts = [
    poll.count0,
    poll.count1,
    poll.count2,
    poll.count3,
    poll.count4,
    poll.count5,
  ];
  return poll.options.map((_, idx) => {
    const val = rawCounts[idx];
    return typeof val === 'number' && Number.isFinite(val) && val > 0 ? Math.floor(val) : 0;
  });
}

export function getPollOptionPercentage(count: number, totalVotes: number): number {
  if (!Number.isFinite(totalVotes) || totalVotes <= 0) return 0;
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.round((count / totalVotes) * 100);
}
