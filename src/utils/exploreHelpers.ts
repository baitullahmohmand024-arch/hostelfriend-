import { Post, UserProfile } from '../types';

export type ExploreFilter =
  | 'for-you'
  | 'people'
  | 'posts'
  | 'photos'
  | 'videos'
  | 'recent';

export interface ExploreTopic {
  tag: string;
  count: number;
  featured: boolean;
}

export interface ExploreHostelHub {
  hostel: string;
  normalized: string;
  memberCount: number;
}

export interface ExploreSignals {
  preferredTags: Set<string>;
  preferredAuthors: Set<string>;
  followingIds: Set<string>;
  friendIds: Set<string>;
  userHostel: string;
  hasSignals: boolean;
}

const RECENT_SEARCH_PREFIX = 'hf_explore_recent_searches_v1_';
const MAX_RECENT_SEARCHES = 8;

function getStorageKey(uid?: string | null): string {
  return `${RECENT_SEARCH_PREFIX}${uid || 'guest'}`;
}

export function loadRecentExploreSearches(uid?: string | null): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(getStorageKey(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .slice(0, MAX_RECENT_SEARCHES);
  } catch {
    return [];
  }
}

export function saveRecentExploreSearch(term: string, uid?: string | null): string[] {
  const clean = term.trim().slice(0, 64);
  if (!clean || clean.length < 2) return loadRecentExploreSearches(uid);
  const existing = loadRecentExploreSearches(uid);
  const deduped = [
    clean,
    ...existing.filter((item) => item.toLowerCase() !== clean.toLowerCase()),
  ].slice(0, MAX_RECENT_SEARCHES);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(getStorageKey(uid), JSON.stringify(deduped));
    } catch {
      // Ignore storage quota errors
    }
  }
  return deduped;
}

export function removeRecentExploreSearch(term: string, uid?: string | null): string[] {
  const existing = loadRecentExploreSearches(uid);
  const next = existing.filter((item) => item.toLowerCase() !== term.toLowerCase());
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(getStorageKey(uid), JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
  }
  return next;
}

export function clearRecentExploreSearches(uid?: string | null): string[] {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(getStorageKey(uid));
    } catch {
      // Ignore storage errors
    }
  }
  return [];
}

export function mergeUniquePosts(existing: Post[], incoming: Post[]): Post[] {
  const byId = new Map<string, Post>();
  for (const p of existing) {
    byId.set(p.id, p);
  }
  for (const p of incoming) {
    byId.set(p.id, p);
  }
  return Array.from(byId.values());
}

export function mergeUniqueMembers(existing: UserProfile[], incoming: UserProfile[]): UserProfile[] {
  const byId = new Map<string, UserProfile>();
  for (const m of existing) {
    if (!m.isSuspended) byId.set(m.uid, m);
  }
  for (const m of incoming) {
    if (!m.isSuspended) byId.set(m.uid, m);
  }
  return Array.from(byId.values());
}

export function extractPreferredSignals(params: {
  posts: Post[];
  likedIds: Set<string>;
  savedIds: Set<string>;
  followingIds: Set<string>;
  friendIds: Set<string>;
  userHostel?: string;
}): ExploreSignals {
  const preferredTags = new Set<string>();
  const preferredAuthors = new Set<string>();

  for (const post of params.posts) {
    if (params.likedIds.has(post.id) || params.savedIds.has(post.id)) {
      preferredAuthors.add(post.authorId);
      for (const tag of post.hashtags || []) {
        const normalized = tag.toLowerCase();
        if (normalized) preferredTags.add(normalized);
      }
    }
  }

  const userHostel = (params.userHostel || '').trim().toLowerCase();
  const hasSignals =
    preferredTags.size > 0 ||
    preferredAuthors.size > 0 ||
    params.followingIds.size > 0 ||
    params.friendIds.size > 0;

  return {
    preferredTags,
    preferredAuthors,
    followingIds: params.followingIds,
    friendIds: params.friendIds,
    userHostel,
    hasSignals,
  };
}

function getEngagementScore(post: Post): number {
  return (post.likesCount || 0) * 2 + (post.commentsCount || 0) * 3;
}

function getPostMillis(post: Post): number {
  return post.createdAt?.toMillis ? post.createdAt.toMillis() : 0;
}

export function rankExplorePosts(
  posts: Post[],
  options: {
    filter: ExploreFilter;
    signals: ExploreSignals;
    currentUid?: string | null;
    memberById?: Map<string, UserProfile>;
  }
): { posts: Post[]; isPersonalized: boolean } {
  const { filter, signals, currentUid, memberById } = options;

  let filtered = posts;
  if (filter === 'photos') {
    filtered = posts.filter((p) => p.mediaType === 'image');
  } else if (filter === 'videos') {
    filtered = posts.filter((p) => p.mediaType === 'video');
  } else if (filter === 'posts') {
    filtered = posts.filter((p) => p.mediaType === 'image' || p.mediaType === 'video' || p.mediaType === 'text');
  }

  if (filter === 'recent') {
    return {
      posts: [...filtered].sort((a, b) => getPostMillis(b) - getPostMillis(a)),
      isPersonalized: false,
    };
  }

  if (filter === 'posts' || filter === 'photos' || filter === 'videos') {
    return {
      posts: [...filtered].sort((a, b) => {
        const diff = getEngagementScore(b) - getEngagementScore(a);
        if (diff !== 0) return diff;
        return getPostMillis(b) - getPostMillis(a);
      }),
      isPersonalized: false,
    };
  }

  // 'for-you': use real signals when available, gracefully blending discovery content
  const now = Date.now();
  const hasPersonalizedResult = signals.hasSignals || Boolean(signals.userHostel);

  const scored = filtered.map((post) => {
    const engagement = getEngagementScore(post);
    const ageHours = Math.max(0, (now - getPostMillis(post)) / (1000 * 60 * 60));
    const recencyBoost = Math.max(0, 72 - ageHours) * 0.2;

    let signalBoost = 0;
    if (signals.preferredAuthors.has(post.authorId)) signalBoost += 8;
    if (signals.friendIds.has(post.authorId)) signalBoost += 7;
    if (signals.followingIds.has(post.authorId)) signalBoost += 5;

    for (const tag of post.hashtags || []) {
      if (signals.preferredTags.has(tag.toLowerCase())) {
        signalBoost += 6;
      }
    }

    if (signals.userHostel && memberById) {
      const author = memberById.get(post.authorId);
      if (author?.hostel && author.hostel.trim().toLowerCase() === signals.userHostel) {
        signalBoost += 4;
      }
    }

    // Slight discovery uplift so non-self posts surface first in Explore
    const discoveryOffset = currentUid && post.authorId === currentUid ? -2 : 0;

    return {
      post,
      score: engagement + recencyBoost + signalBoost + discoveryOffset,
      time: getPostMillis(post),
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.time - a.time;
  });

  return {
    posts: scored.map((item) => item.post),
    isPersonalized: hasPersonalizedResult,
  };
}

export function extractPopularPosts(posts: Post[], maxCount = 3): Post[] {
  return [...posts]
    .sort((a, b) => {
      const diff = getEngagementScore(b) - getEngagementScore(a);
      if (diff !== 0) return diff;
      return getPostMillis(b) - getPostMillis(a);
    })
    .slice(0, maxCount);
}

export function rankSuggestedPeople(
  members: UserProfile[],
  options: {
    currentUid?: string | null;
    blockedSet: Set<string>;
    followingIds: Set<string>;
    userHostel?: string;
    preferUnfollowed?: boolean;
  }
): UserProfile[] {
  const userHostelClean = (options.userHostel || '').trim().toLowerCase();

  const seen = new Set<string>();
  const eligible: UserProfile[] = [];
  for (const m of members) {
    if (!m.uid || seen.has(m.uid)) continue;
    seen.add(m.uid);
    if (options.currentUid && m.uid === options.currentUid) continue;
    if (options.blockedSet.has(m.uid)) continue;
    if (m.isSuspended) continue;
    eligible.push(m);
  }

  return eligible.sort((a, b) => {
    const aFollowing = options.followingIds.has(a.uid) ? 1 : 0;
    const bFollowing = options.followingIds.has(b.uid) ? 1 : 0;
    if (options.preferUnfollowed && aFollowing !== bFollowing) {
      return aFollowing - bFollowing;
    }

    const aSameHostel =
      userHostelClean && a.hostel?.trim().toLowerCase() === userHostelClean ? 1 : 0;
    const bSameHostel =
      userHostelClean && b.hostel?.trim().toLowerCase() === userHostelClean ? 1 : 0;
    if (aSameHostel !== bSameHostel) return bSameHostel - aSameHostel;

    const aScore = (a.followersCount || 0) * 2 + (a.postsCount || 0);
    const bScore = (b.followersCount || 0) * 2 + (b.postsCount || 0);
    return bScore - aScore;
  });
}

export function extractRealTopics(
  posts: Post[],
  featuredHashtags: string[]
): ExploreTopic[] {
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const raw of post.hashtags || []) {
      const clean = raw.replace(/^#/, '').trim().toLowerCase();
      if (!clean) continue;
      counts.set(clean, (counts.get(clean) || 0) + 1);
    }
  }

  const featuredSet = new Set(
    featuredHashtags.map((t) => t.replace(/^#/, '').trim().toLowerCase()).filter(Boolean)
  );

  for (const tag of featuredSet) {
    if (!counts.has(tag)) {
      counts.set(tag, 0);
    }
  }

  return Array.from(counts.entries())
    .map(([tag, count]) => ({
      tag,
      count,
      featured: featuredSet.has(tag),
    }))
    .filter((item) => item.count > 0 || item.featured)
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      return a.tag.localeCompare(b.tag);
    })
    .slice(0, 12);
}

export function extractHostelHubs(members: UserProfile[]): ExploreHostelHub[] {
  const map = new Map<string, { hostel: string; count: number }>();
  for (const m of members) {
    if (m.isSuspended) continue;
    const raw = (m.hostel || '').trim();
    if (!raw) continue;
    const norm = raw.toLowerCase();
    const existing = map.get(norm);
    if (existing) {
      existing.count += 1;
    } else {
      map.set(norm, { hostel: raw, count: 1 });
    }
  }

  return Array.from(map.entries())
    .map(([normalized, info]) => ({
      hostel: info.hostel,
      normalized,
      memberCount: info.count,
    }))
    .sort((a, b) => {
      if (b.memberCount !== a.memberCount) return b.memberCount - a.memberCount;
      return a.hostel.localeCompare(b.hostel);
    })
    .slice(0, 8);
}
