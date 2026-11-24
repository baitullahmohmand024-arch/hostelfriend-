import { Post, ReactionCounts, ReactionType } from '../types';

export interface ReactionMeta {
  type: ReactionType;
  label: string;
  emoji: string;
  activeTextClass: string;
  activeSurfaceClass: string;
  glowColor: string;
}

export const REACTION_OPTIONS: ReadonlyArray<ReactionMeta> = [
  {
    type: 'like',
    label: 'Like',
    emoji: '👍',
    activeTextClass: 'text-accent',
    activeSurfaceClass: 'bg-accent/14 border-accent/35',
    glowColor: 'rgba(245, 197, 66, 0.38)',
  },
  {
    type: 'love',
    label: 'Love',
    emoji: '❤️',
    activeTextClass: 'text-rose-400',
    activeSurfaceClass: 'bg-rose-500/14 border-rose-400/35',
    glowColor: 'rgba(251, 113, 133, 0.42)',
  },
  {
    type: 'haha',
    label: 'Haha',
    emoji: '😂',
    activeTextClass: 'text-amber-300',
    activeSurfaceClass: 'bg-amber-400/14 border-amber-300/35',
    glowColor: 'rgba(252, 211, 77, 0.42)',
  },
  {
    type: 'wow',
    label: 'Wow',
    emoji: '😮',
    activeTextClass: 'text-amber-400',
    activeSurfaceClass: 'bg-amber-500/14 border-amber-400/35',
    glowColor: 'rgba(245, 158, 11, 0.4)',
  },
  {
    type: 'sad',
    label: 'Sad',
    emoji: '😢',
    activeTextClass: 'text-sky-400',
    activeSurfaceClass: 'bg-sky-500/14 border-sky-400/35',
    glowColor: 'rgba(56, 189, 248, 0.4)',
  },
  {
    type: 'care',
    label: 'Care',
    emoji: '🤗',
    activeTextClass: 'text-orange-300',
    activeSurfaceClass: 'bg-orange-400/14 border-orange-300/35',
    glowColor: 'rgba(253, 186, 116, 0.42)',
  },
];

export const REACTION_META_MAP: Record<ReactionType, ReactionMeta> = REACTION_OPTIONS.reduce(
  (acc, item) => {
    acc[item.type] = item;
    return acc;
  },
  {} as Record<ReactionType, ReactionMeta>
);

export function normalizeReactionType(raw?: string | null): ReactionType {
  if (raw && raw in REACTION_META_MAP) {
    return raw as ReactionType;
  }
  return 'like';
}

export function getReactionMeta(type: ReactionType): ReactionMeta {
  return REACTION_META_MAP[type] || REACTION_META_MAP.like;
}

/**
 * Normalizes a Post's per-reaction breakdown and reconciles legacy posts that
 * only stored total `likesCount` by crediting any uncategorized likes to `'like'`.
 */
export function normalizePostReactionCounts(post: Pick<Post, 'likesCount' | 'reactionCounts'>): Record<ReactionType, number> {
  const rc = post.reactionCounts || {};
  const counts: Record<ReactionType, number> = {
    like: Math.max(0, Math.floor(Number(rc.like) || 0)),
    love: Math.max(0, Math.floor(Number(rc.love) || 0)),
    haha: Math.max(0, Math.floor(Number(rc.haha) || 0)),
    wow: Math.max(0, Math.floor(Number(rc.wow) || 0)),
    sad: Math.max(0, Math.floor(Number(rc.sad) || 0)),
    care: Math.max(0, Math.floor(Number(rc.care) || 0)),
  };

  const explicitTotal =
    counts.like + counts.love + counts.haha + counts.wow + counts.sad + counts.care;
  const legacyTotal = Math.max(0, Math.floor(Number(post.likesCount) || 0));

  if (legacyTotal > explicitTotal) {
    counts.like += legacyTotal - explicitTotal;
  }

  return counts;
}

export function getTotalReactionCount(post: Pick<Post, 'likesCount' | 'reactionCounts'>): number {
  const counts = normalizePostReactionCounts(post);
  const sum = counts.like + counts.love + counts.haha + counts.wow + counts.sad + counts.care;
  return Math.max(0, sum, Math.floor(Number(post.likesCount) || 0));
}

export function getTopReactionsSummary(
  post: Pick<Post, 'likesCount' | 'reactionCounts'>,
  maxItems = 3
): {
  items: Array<{ meta: ReactionMeta; count: number }>;
  allNonZero: Array<{ meta: ReactionMeta; count: number }>;
  totalCount: number;
} {
  const counts = normalizePostReactionCounts(post);
  const allNonZero = REACTION_OPTIONS
    .map((meta, idx) => ({ meta, count: counts[meta.type], order: idx }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.order - b.order))
    .map(({ meta, count }) => ({ meta, count }));

  return {
    items: allNonZero.slice(0, maxItems),
    allNonZero,
    totalCount: getTotalReactionCount(post),
  };
}

/**
 * Pure atomic state computation used for both optimistic UI updates and Firestore transactions.
 */
export function computeNextReactionState(
  post: Pick<Post, 'likesCount' | 'reactionCounts'>,
  prevReaction: ReactionType | null,
  targetReaction: ReactionType | null
): {
  nextReaction: ReactionType | null;
  nextLikesCount: number;
  nextReactionCounts: Record<ReactionType, number>;
} {
  const nextCounts = normalizePostReactionCounts(post);
  const normalizedTarget =
    targetReaction === null || targetReaction === prevReaction ? null : targetReaction;

  if (prevReaction && normalizedTarget === null) {
    nextCounts[prevReaction] = Math.max(0, nextCounts[prevReaction] - 1);
  } else if (!prevReaction && normalizedTarget) {
    nextCounts[normalizedTarget] += 1;
  } else if (prevReaction && normalizedTarget && prevReaction !== normalizedTarget) {
    nextCounts[prevReaction] = Math.max(0, nextCounts[prevReaction] - 1);
    nextCounts[normalizedTarget] += 1;
  }

  const nextTotal =
    nextCounts.like +
    nextCounts.love +
    nextCounts.haha +
    nextCounts.wow +
    nextCounts.sad +
    nextCounts.care;

  return {
    nextReaction: normalizedTarget,
    nextLikesCount: Math.max(0, nextTotal),
    nextReactionCounts: nextCounts,
  };
}

export function formatReactionNotificationAction(reactionType: ReactionType): {
  title: string;
  actionPhrase: string;
} {
  if (reactionType === 'like') {
    return {
      title: 'New Like',
      actionPhrase: 'liked your post.',
    };
  }
  const meta = getReactionMeta(reactionType);
  return {
    title: 'New Reaction',
    actionPhrase: `reacted ${meta.emoji} ${meta.label} to your post.`,
  };
}
