import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DocumentSnapshot } from 'firebase/firestore';
import {
  Building2,
  Clock,
  Compass,
  Film,
  Flame,
  Hash,
  History,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  TrendingUp,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Post, ReactionType, UserProfile } from '../types';
import {
  deletePost,
  fetchPostsByHashtag,
  fetchPostsByMediaType,
  fetchPostsPage,
  getUserPostReactions,
  getUserSavedPostIds,
  reactToPost,
  toggleSavePost,
} from '../services/postService';
import { isLegacyPollPost } from '../services/pollService';
import { computeNextReactionState } from '../utils/reactions';
import {
  fetchDiscoverMembersPage,
  followUser,
  searchMembersByPrefix,
  unfollowUser,
} from '../services/userService';
import { Avatar } from '../components/Avatar';
import { PostCard } from '../components/PostCard';
import { SharePostModal } from '../components/SharePostModal';
import { ExploreDiscoverySkeleton } from '../components/Skeletons';
import { ExploreDiscoveryCard, ExplorePersonCard } from '../components/ExploreCards';
import {
  clearRecentExploreSearches,
  ExploreFilter,
  extractHostelHubs,
  extractPopularPosts,
  extractPreferredSignals,
  extractRealTopics,
  loadRecentExploreSearches,
  mergeUniqueMembers,
  mergeUniquePosts,
  rankExplorePosts,
  rankSuggestedPeople,
  removeRecentExploreSearch,
  saveRecentExploreSearch,
} from '../utils/exploreHelpers';
import { formatCount } from '../utils/formatters';
import { formatUserFriendlyError } from '../lib/firestoreError';

interface ExplorePageProps {
  initialHashtag?: string;
  initialQuery?: string;
  onOpenProfile: (userId: string) => void;
  onRequireAuth: () => void;
  onOpenTrends?: () => void;
}

const DISCOVERY_FILTERS: ReadonlyArray<{
  id: ExploreFilter;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'for-you', label: 'For You', icon: Sparkles },
  { id: 'people', label: 'People', icon: Users },
  { id: 'posts', label: 'Posts', icon: Compass },
  { id: 'photos', label: 'Photos', icon: ImageIcon },
  { id: 'videos', label: 'Videos', icon: Film },
  { id: 'recent', label: 'Recent', icon: Clock },
];

export function ExplorePage({
  initialHashtag = '',
  initialQuery = '',
  onOpenProfile,
  onRequireAuth,
  onOpenTrends,
}: ExplorePageProps) {
  const {
    profile,
    setProfile,
    privateSettings,
    followingIds,
    friendRequests,
    isAdmin,
    platformSettings,
    connectionOk,
  } = useAuth();
  const { showToast } = useToast();

  const [searchQuery, setSearchQuery] = useState(
    initialHashtag ? `#${initialHashtag}` : initialQuery
  );
  const [searchFocused, setSearchFocused] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>(() =>
    loadRecentExploreSearches(profile?.uid)
  );
  const [selectedHostel, setSelectedHostel] = useState<string>('');
  const [filter, setFilter] = useState<ExploreFilter>('for-you');

  const [posts, setPosts] = useState<Post[]>([]);
  const [postsLastDoc, setPostsLastDoc] = useState<DocumentSnapshot | null>(null);
  const [hasMorePosts, setHasMorePosts] = useState(true);
  const [loadingMorePosts, setLoadingMorePosts] = useState(false);

  const [members, setMembers] = useState<UserProfile[]>([]);
  const [membersLastDoc, setMembersLastDoc] = useState<DocumentSnapshot | null>(null);
  const [hasMoreMembers, setHasMoreMembers] = useState(true);
  const [loadingMoreMembers, setLoadingMoreMembers] = useState(false);

  const [remoteSearchPosts, setRemoteSearchPosts] = useState<Post[]>([]);
  const [remoteSearchMembers, setRemoteSearchMembers] = useState<UserProfile[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mediaSliceBusy, setMediaSliceBusy] = useState(false);

  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [sharePost, setSharePost] = useState<Post | null>(null);

  const [userReactions, setUserReactions] = useState<Map<string, ReactionType>>(
    () => new Map()
  );
  const likedIds = useMemo(() => new Set(userReactions.keys()), [userReactions]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [followOverrides, setFollowOverrides] = useState<Record<string, boolean>>({});
  const [followBusyMap, setFollowBusyMap] = useState<Record<string, boolean>>({});

  const searchContainerRef = useRef<HTMLDivElement>(null);
  const fetchedMediaTypesRef = useRef<Set<'image' | 'video'>>(new Set());

  const blockedSet = useMemo(
    () => new Set(privateSettings?.blockedUserIds || []),
    [privateSettings]
  );

  const acceptedFriendIds = useMemo(() => {
    const ids = new Set<string>();
    if (!profile) return ids;
    for (const req of friendRequests) {
      if (req.status === 'accepted') {
        const otherId = req.senderId === profile.uid ? req.recipientId : req.senderId;
        if (otherId) ids.add(otherId);
      }
    }
    return ids;
  }, [friendRequests, profile]);

  useEffect(() => {
    setRecentSearches(loadRecentExploreSearches(profile?.uid));
  }, [profile?.uid]);

  useEffect(() => {
    if (initialHashtag) {
      setSearchQuery(`#${initialHashtag}`);
    } else if (initialQuery) {
      setSearchQuery(initialQuery);
    }
  }, [initialHashtag, initialQuery]);

  // Close search suggestion dropdown on outside pointer click
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const loadInitialExplore = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    fetchedMediaTypesRef.current.clear();

    try {
      const [postRes, memberRes] = await Promise.all([
        fetchPostsPage(null, 24),
        fetchDiscoverMembersPage(null, 24),
      ]);

      setPosts(postRes.posts);
      setPostsLastDoc(postRes.lastDoc);
      setHasMorePosts(postRes.hasMore);

      setMembers(memberRes.members);
      setMembersLastDoc(memberRes.lastDoc);
      setHasMoreMembers(memberRes.hasMore);

      if (profile) {
        const [reactions, saves] = await Promise.all([
          getUserPostReactions(profile.uid),
          getUserSavedPostIds(profile.uid),
        ]);
        setUserReactions(reactions);
        setSavedIds(saves);
      } else {
        setUserReactions(new Map());
        setSavedIds(new Set());
      }
    } catch {
      setLoadError('Unable to load Explore right now. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    void loadInitialExplore();
  }, [loadInitialExplore]);

  // Ensure Photos / Videos tabs have dedicated media results even if recent feed page had mostly text/other posts
  useEffect(() => {
    if (loading) return;
    if (filter !== 'photos' && filter !== 'videos') return;
    const mediaType: 'image' | 'video' = filter === 'photos' ? 'image' : 'video';
    const currentMatching = posts.filter((p) => p.mediaType === mediaType).length;
    if (currentMatching >= 6 || fetchedMediaTypesRef.current.has(mediaType)) return;

    fetchedMediaTypesRef.current.add(mediaType);
    let cancelled = false;
    setMediaSliceBusy(true);
    fetchPostsByMediaType(mediaType, 36)
      .then((fetched) => {
        if (!cancelled && fetched.length > 0) {
          setPosts((prev) => mergeUniquePosts(prev, fetched));
        }
      })
      .catch(() => {
        // Non-blocking fallback: existing posts stay visible
      })
      .finally(() => {
        if (!cancelled) setMediaSliceBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filter, loading, posts]);

  // Debounced live search against Firestore for #hashtags and @username prefix beyond initial cache
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setRemoteSearchPosts([]);
      setRemoteSearchMembers([]);
      setSearchBusy(false);
      return;
    }

    const clean = trimmed.toLowerCase().replace(/^[@#]/, '');
    if (clean.length < 2) {
      setSearchBusy(false);
      return;
    }

    let cancelled = false;
    setSearchBusy(true);

    const timer = window.setTimeout(async () => {
      try {
        const tagCandidate = trimmed.startsWith('#')
          ? clean
          : /^[a-z0-9_]{2,30}$/.test(clean)
            ? clean
            : '';

        const [tagPosts, prefixUsers] = await Promise.all([
          tagCandidate ? fetchPostsByHashtag(tagCandidate) : Promise.resolve([]),
          !trimmed.startsWith('#') ? searchMembersByPrefix(clean, 20) : Promise.resolve([]),
        ]);

        if (cancelled) return;
        setRemoteSearchPosts(tagPosts);
        setRemoteSearchMembers(prefixUsers);
      } catch {
        if (!cancelled) {
          setRemoteSearchPosts([]);
          setRemoteSearchMembers([]);
        }
      } finally {
        if (!cancelled) setSearchBusy(false);
      }
    }, 260);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchQuery]);

  const combinedPosts = useMemo(
    () => mergeUniquePosts(posts, remoteSearchPosts),
    [posts, remoteSearchPosts]
  );

  const combinedMembers = useMemo(
    () => mergeUniqueMembers(members, remoteSearchMembers),
    [members, remoteSearchMembers]
  );

  const memberById = useMemo(() => {
    const map = new Map<string, UserProfile>();
    for (const m of combinedMembers) {
      map.set(m.uid, m);
    }
    if (profile) {
      map.set(profile.uid, profile);
    }
    return map;
  }, [combinedMembers, profile]);

  const signals = useMemo(
    () =>
      extractPreferredSignals({
        posts: combinedPosts,
        likedIds,
        savedIds,
        followingIds,
        friendIds: acceptedFriendIds,
        userHostel: profile?.hostel,
      }),
    [combinedPosts, likedIds, savedIds, followingIds, acceptedFriendIds, profile?.hostel]
  );

  const realTopics = useMemo(
    () => extractRealTopics(combinedPosts, platformSettings.featuredHashtags),
    [combinedPosts, platformSettings.featuredHashtags]
  );

  const hostelHubs = useMemo(() => extractHostelHubs(combinedMembers), [combinedMembers]);

  const normalizedTerm = searchQuery.trim().toLowerCase().replace(/^[@#]/, '');
  const isHashtagQuery = searchQuery.trim().startsWith('#');
  const hasActiveFilterOrSearch = Boolean(normalizedTerm || selectedHostel);

  const suggestedPeople = useMemo(() => {
    const ranked = rankSuggestedPeople(combinedMembers, {
      currentUid: profile?.uid,
      blockedSet,
      followingIds,
      userHostel: profile?.hostel,
      preferUnfollowed: filter === 'for-you' && !hasActiveFilterOrSearch,
    });

    return ranked.filter((m) => {
      if (selectedHostel && m.hostel.trim().toLowerCase() !== selectedHostel.toLowerCase()) {
        return false;
      }
      if (!normalizedTerm || isHashtagQuery) return true;
      return (
        m.usernameLower.includes(normalizedTerm) ||
        m.fullName.toLowerCase().includes(normalizedTerm) ||
        m.hostel.toLowerCase().includes(normalizedTerm) ||
        m.bio.toLowerCase().includes(normalizedTerm)
      );
    });
  }, [
    combinedMembers,
    profile?.uid,
    profile?.hostel,
    blockedSet,
    followingIds,
    filter,
    hasActiveFilterOrSearch,
    selectedHostel,
    normalizedTerm,
    isHashtagQuery,
  ]);

  const matchingPostsResult = useMemo(() => {
    const visiblePosts = combinedPosts
      .filter((p) => !blockedSet.has(p.authorId) && !isLegacyPollPost(p))
      .filter((p) => {
        if (!selectedHostel) return true;
        const author = memberById.get(p.authorId);
        return (
          author?.hostel?.trim().toLowerCase() === selectedHostel.toLowerCase() ||
          p.caption.toLowerCase().includes(selectedHostel.toLowerCase())
        );
      })
      .filter((p) => {
        if (!normalizedTerm) return true;
        if (isHashtagQuery) {
          return (
            p.hashtags.some((t) => t.toLowerCase().includes(normalizedTerm)) ||
            p.caption.toLowerCase().includes(`#${normalizedTerm}`)
          );
        }
        const author = memberById.get(p.authorId);
        return (
          p.caption.toLowerCase().includes(normalizedTerm) ||
          p.authorUsername.toLowerCase().includes(normalizedTerm) ||
          p.authorName.toLowerCase().includes(normalizedTerm) ||
          p.hashtags.some((t) => t.toLowerCase().includes(normalizedTerm)) ||
          Boolean(author?.hostel?.toLowerCase().includes(normalizedTerm))
        );
      });

    return rankExplorePosts(visiblePosts, {
      filter,
      signals,
      currentUid: profile?.uid,
      memberById,
    });
  }, [
    combinedPosts,
    blockedSet,
    selectedHostel,
    memberById,
    normalizedTerm,
    isHashtagQuery,
    filter,
    signals,
    profile?.uid,
  ]);

  const popularSpotlightPosts = useMemo(() => {
    if (filter !== 'for-you' || hasActiveFilterOrSearch) return [];
    const visible = combinedPosts.filter((p) => !blockedSet.has(p.authorId));
    return extractPopularPosts(visible, 3);
  }, [filter, hasActiveFilterOrSearch, combinedPosts, blockedSet]);

  const discoveryGridPosts = useMemo(() => {
    if (popularSpotlightPosts.length === 0 || matchingPostsResult.posts.length <= 5) {
      return matchingPostsResult.posts;
    }
    const spotlightIds = new Set(popularSpotlightPosts.map((p) => p.id));
    return matchingPostsResult.posts.filter((p) => !spotlightIds.has(p.id));
  }, [matchingPostsResult.posts, popularSpotlightPosts]);

  // Search dropdown suggestions derived from real data + recent searches
  const quickPeopleSuggestions = useMemo(() => {
    const base = rankSuggestedPeople(combinedMembers, {
      currentUid: profile?.uid,
      blockedSet,
      followingIds,
      userHostel: profile?.hostel,
    });
    if (!normalizedTerm) return base.slice(0, 3);
    return base
      .filter(
        (m) =>
          m.usernameLower.includes(normalizedTerm) ||
          m.fullName.toLowerCase().includes(normalizedTerm) ||
          m.hostel.toLowerCase().includes(normalizedTerm)
      )
      .slice(0, 4);
  }, [combinedMembers, profile?.uid, profile?.hostel, blockedSet, followingIds, normalizedTerm]);

  const quickTopicSuggestions = useMemo(() => {
    if (!normalizedTerm) return realTopics.slice(0, 6);
    return realTopics.filter((t) => t.tag.includes(normalizedTerm)).slice(0, 6);
  }, [realTopics, normalizedTerm]);

  const quickHostelSuggestions = useMemo(() => {
    if (!normalizedTerm) return hostelHubs.slice(0, 4);
    return hostelHubs.filter((h) => h.normalized.includes(normalizedTerm)).slice(0, 4);
  }, [hostelHubs, normalizedTerm]);

  const isMemberFollowed = (uid: string): boolean => {
    if (uid in followOverrides) return followOverrides[uid];
    return followingIds.has(uid);
  };

  const commitSearchTerm = (term: string) => {
    const clean = term.trim();
    if (!clean) return;
    setSearchQuery(clean);
    setRecentSearches(saveRecentExploreSearch(clean, profile?.uid));
    setSearchFocused(false);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) {
      setSearchFocused(false);
      return;
    }
    commitSearchTerm(searchQuery);
  };

  const handleLoadMorePosts = async () => {
    if (!hasMorePosts || loadingMorePosts || !postsLastDoc) return;
    setLoadingMorePosts(true);
    try {
      const nextPage = await fetchPostsPage(postsLastDoc, 18);
      setPosts((prev) => mergeUniquePosts(prev, nextPage.posts));
      setPostsLastDoc(nextPage.lastDoc);
      setHasMorePosts(nextPage.hasMore);
    } catch {
      showToast({ type: 'error', title: 'Could not load more posts' });
    } finally {
      setLoadingMorePosts(false);
    }
  };

  const handleLoadMoreMembers = async () => {
    if (!hasMoreMembers || loadingMoreMembers || !membersLastDoc) return;
    setLoadingMoreMembers(true);
    try {
      const nextPage = await fetchDiscoverMembersPage(membersLastDoc, 20);
      setMembers((prev) => mergeUniqueMembers(prev, nextPage.members));
      setMembersLastDoc(nextPage.lastDoc);
      setHasMoreMembers(nextPage.hasMore);
    } catch {
      showToast({ type: 'error', title: 'Could not load more people' });
    } finally {
      setLoadingMoreMembers(false);
    }
  };

  const handleToggleFollow = async (target: UserProfile) => {
    if (!profile) {
      onRequireAuth();
      return;
    }
    if (target.uid === profile.uid || followBusyMap[target.uid]) return;

    const currentlyFollowing = isMemberFollowed(target.uid);
    const delta = currentlyFollowing ? -1 : 1;

    setFollowBusyMap((prev) => ({ ...prev, [target.uid]: true }));
    setFollowOverrides((prev) => ({ ...prev, [target.uid]: !currentlyFollowing }));
    setMembers((prev) =>
      prev.map((m) =>
        m.uid === target.uid
          ? { ...m, followersCount: Math.max(0, (m.followersCount || 0) + delta) }
          : m
      )
    );
    setRemoteSearchMembers((prev) =>
      prev.map((m) =>
        m.uid === target.uid
          ? { ...m, followersCount: Math.max(0, (m.followersCount || 0) + delta) }
          : m
      )
    );
    setProfile({
      ...profile,
      followingCount: Math.max(0, (profile.followingCount || 0) + delta),
    });

    try {
      if (currentlyFollowing) {
        await unfollowUser(profile.uid, target.uid);
      } else {
        await followUser(profile, target.uid);
      }
      setFollowOverrides((prev) => {
        const copy = { ...prev };
        delete copy[target.uid];
        return copy;
      });
    } catch {
      // Rollback optimistic update on failure
      setFollowOverrides((prev) => ({ ...prev, [target.uid]: currentlyFollowing }));
      setMembers((prev) =>
        prev.map((m) =>
          m.uid === target.uid
            ? { ...m, followersCount: Math.max(0, (m.followersCount || 0) - delta) }
            : m
        )
      );
      setRemoteSearchMembers((prev) =>
        prev.map((m) =>
          m.uid === target.uid
            ? { ...m, followersCount: Math.max(0, (m.followersCount || 0) - delta) }
            : m
        )
      );
      setProfile({
        ...profile,
        followingCount: Math.max(0, (profile.followingCount || 0) - delta),
      });
      showToast({ type: 'error', title: 'Could not update follow status' });
    } finally {
      setFollowBusyMap((prev) => ({ ...prev, [target.uid]: false }));
    }
  };

  const handleSelectReaction = async (post: Post, nextReactionChoice: ReactionType | null) => {
    if (!profile) {
      onRequireAuth();
      return;
    }
    const prevReaction = userReactions.get(post.id) || null;
    const prevLikesCount = post.likesCount;
    const prevReactionCounts = post.reactionCounts;
    const optimistic = computeNextReactionState(post, prevReaction, nextReactionChoice);

    setUserReactions((prev) => {
      const next = new Map(prev);
      if (optimistic.nextReaction) next.set(post.id, optimistic.nextReaction);
      else next.delete(post.id);
      return next;
    });
    const applyPatch = (list: Post[]) =>
      list.map((p) =>
        p.id === post.id
          ? {
              ...p,
              likesCount: optimistic.nextLikesCount,
              reactionCounts: optimistic.nextReactionCounts,
            }
          : p
      );
    setPosts(applyPatch);
    setRemoteSearchPosts(applyPatch);
    setSelectedPost((prev) =>
      prev && prev.id === post.id
        ? {
            ...prev,
            likesCount: optimistic.nextLikesCount,
            reactionCounts: optimistic.nextReactionCounts,
          }
        : prev
    );

    try {
      const committed = await reactToPost(post, profile, optimistic.nextReaction);
      setUserReactions((prev) => {
        const next = new Map(prev);
        if (committed.nextReaction) next.set(post.id, committed.nextReaction);
        else next.delete(post.id);
        return next;
      });
      const applyCommitted = (list: Post[]) =>
        list.map((p) =>
          p.id === post.id
            ? {
                ...p,
                likesCount: committed.nextLikesCount,
                reactionCounts: committed.nextReactionCounts,
              }
            : p
        );
      setPosts(applyCommitted);
      setRemoteSearchPosts(applyCommitted);
      setSelectedPost((prev) =>
        prev && prev.id === post.id
          ? {
              ...prev,
              likesCount: committed.nextLikesCount,
              reactionCounts: committed.nextReactionCounts,
            }
          : prev
      );
      if (committed.legacyNotice) {
        showToast({
          type: 'info',
          title: 'Reaction saved as Like',
          description: committed.legacyNotice,
        });
      }
    } catch (err) {
      setUserReactions((prev) => {
        const next = new Map(prev);
        if (prevReaction) next.set(post.id, prevReaction);
        else next.delete(post.id);
        return next;
      });
      const rollback = (list: Post[]) =>
        list.map((p) =>
          p.id === post.id
            ? { ...p, likesCount: prevLikesCount, reactionCounts: prevReactionCounts }
            : p
        );
      setPosts(rollback);
      setRemoteSearchPosts(rollback);
      setSelectedPost((prev) =>
        prev && prev.id === post.id
          ? { ...prev, likesCount: prevLikesCount, reactionCounts: prevReactionCounts }
          : prev
      );
      showToast({
        type: 'error',
        title: 'Could not update reaction',
        description: formatUserFriendlyError(err, 'Please try again.'),
      });
    }
  };

  const handleToggleSave = async (post: Post) => {
    if (!profile) {
      onRequireAuth();
      return;
    }
    const currentlySaved = savedIds.has(post.id);
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (currentlySaved) next.delete(post.id);
      else next.add(post.id);
      return next;
    });
    try {
      await toggleSavePost(post.id, profile.uid, currentlySaved);
    } catch {
      setSavedIds((prev) => {
        const next = new Set(prev);
        if (currentlySaved) next.add(post.id);
        else next.delete(post.id);
        return next;
      });
      showToast({ type: 'error', title: 'Could not update bookmark' });
    }
  };

  const handleDeletePost = async (post: Post) => {
    try {
      await deletePost(post, profile?.uid === post.authorId);
      setPosts((prev) => prev.filter((p) => p.id !== post.id));
      setRemoteSearchPosts((prev) => prev.filter((p) => p.id !== post.id));
      setSelectedPost(null);
      showToast({ type: 'success', title: 'Post deleted' });
    } catch {
      showToast({ type: 'error', title: 'Could not delete post' });
    }
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedHostel('');
    setFilter('for-you');
    setSearchFocused(false);
  };

  const handleSelectTopic = (tag: string) => {
    const formatted = `#${tag}`;
    if (filter === 'people') setFilter('for-you');
    commitSearchTerm(formatted);
  };

  const handleSelectHostel = (hostel: string) => {
    setSelectedHostel((prev) => (prev.toLowerCase() === hostel.toLowerCase() ? '' : hostel));
    setSearchFocused(false);
  };

  const showDropdown =
    searchFocused &&
    (recentSearches.length > 0 ||
      quickPeopleSuggestions.length > 0 ||
      quickTopicSuggestions.length > 0 ||
      quickHostelSuggestions.length > 0);

  return (
    <div className="space-y-6 pb-8">
      {/* Discovery Hero + Smart Search Header */}
      <section className="rounded-2xl glass-card p-5 sm:p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-accent text-xs font-semibold uppercase tracking-wider">
              <Compass className="w-3.5 h-3.5" />
              <span>Discovery Center</span>
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-ink">
              Discover Something New
            </h1>
            <p className="text-xs sm:text-sm text-ink-muted max-w-2xl">
              {matchingPostsResult.isPersonalized && filter === 'for-you' && !hasActiveFilterOrSearch
                ? 'Tailored from your follows, likes, saved posts, and hostel community.'
                : 'Explore popular campus photos, videos, trending topics, and fellow hostel members.'}
            </p>
          </div>

          <div className="flex items-center gap-2.5 self-start lg:self-center">
            {onOpenTrends && (
              <button
                type="button"
                onClick={onOpenTrends}
                className="min-h-[42px] px-4 rounded-xl text-xs font-semibold border border-accent/40 bg-surface-2 text-accent hover:border-accent hover:bg-hover-tint transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <TrendingUp className="w-4 h-4" />
                <span>Trends</span>
              </button>
            )}
          </div>
        </div>

        {/* Smart Search Bar with Instant Suggestions + Recent Searches */}
        <div ref={searchContainerRef} className="relative">
          <form onSubmit={handleSearchSubmit} className="relative">
            <Search className="w-4 h-4 text-ink-subtle absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onFocus={() => setSearchFocused(true)}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSearchFocused(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSearchFocused(false);
                }
              }}
              aria-label="Search Hostel Friend"
              placeholder="Search people, @username, captions, #hashtags, or hostel blocks..."
              className="w-full min-h-[48px] rounded-xl bg-surface-2 border border-hairline pl-11 pr-20 py-3 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-accent transition-colors"
            />

            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {searchBusy && <Loader2 className="w-4 h-4 text-accent animate-spin mr-1" />}
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setSearchFocused(true);
                  }}
                  aria-label="Clear search"
                  className="min-h-[36px] min-w-[36px] rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink hover:bg-hover-tint transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </form>

          {showDropdown && (
            <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-30 rounded-2xl glass-popover hf-popover-enter p-4 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Recent Searches */}
              {recentSearches.length > 0 && !normalizedTerm && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle inline-flex items-center gap-1.5">
                      <History className="w-3.5 h-3.5" />
                      <span>Recent Searches</span>
                    </p>
                    <button
                      type="button"
                      onClick={() => setRecentSearches(clearRecentExploreSearches(profile?.uid))}
                      className="text-[11px] font-medium text-ink-muted hover:text-accent transition-colors"
                    >
                      Clear history
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {recentSearches.map((item) => (
                      <div
                        key={item}
                        className="inline-flex items-center rounded-lg bg-surface-2 border border-hairline overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() => commitSearchTerm(item)}
                          className="px-2.5 py-1.5 text-xs text-ink hover:text-accent transition-colors"
                        >
                          {item}
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${item} from recent searches`}
                          onClick={() =>
                            setRecentSearches(removeRecentExploreSearch(item, profile?.uid))
                          }
                          className="pr-2 pl-0.5 py-1.5 text-ink-subtle hover:text-ink transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Instant People Suggestions */}
              {quickPeopleSuggestions.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle inline-flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" />
                    <span>{normalizedTerm ? 'Matching People' : 'Suggested People'}</span>
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {quickPeopleSuggestions.map((person) => (
                      <button
                        key={person.uid}
                        type="button"
                        onClick={() => {
                          if (searchQuery.trim()) {
                            setRecentSearches(
                              saveRecentExploreSearch(searchQuery.trim(), profile?.uid)
                            );
                          }
                          setSearchFocused(false);
                          onOpenProfile(person.uid);
                        }}
                        className="flex items-center gap-2.5 p-2 rounded-xl bg-surface-2 hover:bg-hover-tint border border-hairline text-left transition-colors"
                      >
                        <Avatar src={person.avatarUrl} name={person.fullName} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-ink truncate">
                            {person.fullName}
                          </p>
                          <p className="text-[11px] text-ink-muted truncate">
                            @{person.username}
                            {person.hostel ? ` · ${person.hostel}` : ''}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Topics & Hostels Quick Filters */}
              {(quickTopicSuggestions.length > 0 || quickHostelSuggestions.length > 0) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-hairline">
                  {quickTopicSuggestions.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle inline-flex items-center gap-1.5">
                        <Hash className="w-3.5 h-3.5" />
                        <span>Topics</span>
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {quickTopicSuggestions.map((topic) => (
                          <button
                            key={topic.tag}
                            type="button"
                            onClick={() => handleSelectTopic(topic.tag)}
                            className="px-2.5 py-1.5 rounded-lg bg-surface-2 hover:bg-hover-tint border border-hairline text-xs text-accent font-medium transition-colors"
                          >
                            #{topic.tag}
                            {topic.count > 0 ? ` · ${topic.count}` : ''}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {quickHostelSuggestions.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle inline-flex items-center gap-1.5">
                        <Building2 className="w-3.5 h-3.5" />
                        <span>Hostel Blocks</span>
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {quickHostelSuggestions.map((hub) => (
                          <button
                            key={hub.normalized}
                            type="button"
                            onClick={() => handleSelectHostel(hub.hostel)}
                            className="px-2.5 py-1.5 rounded-lg bg-surface-2 hover:bg-hover-tint border border-hairline text-xs text-ink font-medium transition-colors"
                          >
                            {hub.hostel} · {hub.memberCount}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 6 Discovery Filters */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {DISCOVERY_FILTERS.map((item) => {
            const Icon = item.icon;
            const active = filter === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                className={`min-h-[42px] px-4 rounded-xl text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap shrink-0 hf-press ${
                  active
                    ? 'bg-accent text-accent-fg shadow-sm'
                    : 'glass-btn text-ink-muted hover:text-ink'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Trending Topics & Hostel Hubs (Strictly Real Data) */}
        {(realTopics.length > 0 || hostelHubs.length > 0 || selectedHostel) && (
          <div className="pt-2 border-t border-hairline space-y-2.5">
            {realTopics.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle inline-flex items-center gap-1 shrink-0">
                  <Flame className="w-3.5 h-3.5 text-accent" />
                  Trending Topics
                </span>
                {realTopics.map((topic) => {
                  const active = isHashtagQuery && normalizedTerm === topic.tag;
                  return (
                    <button
                      key={topic.tag}
                      type="button"
                      onClick={() =>
                        active ? setSearchQuery('') : handleSelectTopic(topic.tag)
                      }
                      className={`py-1 transition-colors whitespace-nowrap shrink-0 ${
                        active
                          ? 'text-accent font-semibold underline underline-offset-4'
                          : 'text-ink-muted hover:text-accent'
                      }`}
                    >
                      #{topic.tag}
                      {topic.count > 0 && (
                        <span className="ml-1 font-mono tabular-nums text-[11px] text-ink-subtle">
                          · {formatCount(topic.count)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {hostelHubs.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle inline-flex items-center gap-1 shrink-0">
                  <Building2 className="w-3.5 h-3.5 text-accent" />
                  Hostels
                </span>
                {hostelHubs.map((hub) => {
                  const active =
                    selectedHostel.toLowerCase() === hub.hostel.toLowerCase();
                  return (
                    <button
                      key={hub.normalized}
                      type="button"
                      onClick={() => handleSelectHostel(hub.hostel)}
                      className={`py-1 transition-colors whitespace-nowrap shrink-0 ${
                        active
                          ? 'text-accent font-semibold underline underline-offset-4'
                          : 'text-ink-muted hover:text-ink'
                      }`}
                    >
                      {hub.hostel}
                      <span className="ml-1 font-mono tabular-nums text-[11px] text-ink-subtle">
                        · {formatCount(hub.memberCount)}
                      </span>
                    </button>
                  );
                })}

                {hasActiveFilterOrSearch && (
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="ml-auto text-xs font-medium text-accent hover:underline"
                  >
                    Reset filters
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Connection / Offline Notice */}
      {!connectionOk && (
        <div className="rounded-2xl glass-card p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs text-ink-muted">
            <WifiOff className="w-4 h-4 text-accent shrink-0" />
            <span>You appear to be offline. Showing any cached content available.</span>
          </div>
          <button
            type="button"
            onClick={() => void loadInitialExplore()}
            className="min-h-[38px] px-3 rounded-xl bg-surface-2 border border-hairline text-xs font-semibold text-ink hover:border-accent/40 inline-flex items-center gap-1.5 shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Main Content States */}
      {loading ? (
        <ExploreDiscoverySkeleton />
      ) : loadError ? (
        <div className="rounded-2xl glass-card p-10 text-center space-y-3">
          <WifiOff className="w-8 h-8 text-accent mx-auto" />
          <p className="font-display text-base font-semibold text-ink">{loadError}</p>
          <button
            type="button"
            onClick={() => void loadInitialExplore()}
            className="min-h-[42px] px-5 rounded-xl gold-gradient-btn text-xs font-semibold inline-flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Retry Loading Explore</span>
          </button>
        </div>
      ) : filter === 'people' ? (
        /* Dedicated People Discovery Directory */
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-ink">
                {hasActiveFilterOrSearch ? 'Matching Members' : 'Discover People'}
              </h2>
              <p className="text-xs text-ink-muted">
                Connect with students and creators across Hostel Friend
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums text-ink-subtle">
              {suggestedPeople.length} shown
            </span>
          </div>

          {suggestedPeople.length === 0 ? (
            <div className="glass-card rounded-2xl p-10 text-center space-y-3">
              <Users className="w-8 h-8 text-accent mx-auto" />
              <p className="font-display text-base font-semibold text-ink">
                No matching people found
              </p>
              <p className="text-xs text-ink-muted">
                Try another name, @username, or reset your hostel filter.
              </p>
              {hasActiveFilterOrSearch && (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="min-h-[40px] px-4 rounded-xl bg-surface-2 border border-hairline text-xs font-semibold text-ink hover:border-accent/40"
                >
                  Clear search & filters
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {suggestedPeople.map((member) => (
                  <ExplorePersonCard
                    key={member.uid}
                    member={member}
                    variant="grid"
                    isSelf={profile?.uid === member.uid}
                    isFollowing={isMemberFollowed(member.uid)}
                    followBusy={Boolean(followBusyMap[member.uid])}
                    onOpenProfile={onOpenProfile}
                    onToggleFollow={handleToggleFollow}
                  />
                ))}
              </div>

              {hasMoreMembers && !hasActiveFilterOrSearch && (
                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    disabled={loadingMoreMembers}
                    onClick={() => void handleLoadMoreMembers()}
                    className="min-h-[44px] px-6 rounded-xl bg-surface border border-hairline hover:border-accent/40 text-xs font-semibold text-ink inline-flex items-center gap-2 transition-colors disabled:opacity-60"
                  >
                    {loadingMoreMembers && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>{loadingMoreMembers ? 'Loading people...' : 'Load more people'}</span>
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      ) : (
        <div className="space-y-8">
          {/* Suggested People Carousel (on For You or when searching) */}
          {(filter === 'for-you' || (normalizedTerm && !isHashtagQuery)) &&
            suggestedPeople.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-display text-base sm:text-lg font-bold text-ink">
                    {normalizedTerm ? 'Matching People' : 'Suggested People'}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setFilter('people')}
                    className="text-xs font-semibold text-accent hover:underline"
                  >
                    See all
                  </button>
                </div>

                <div className="flex items-stretch gap-3.5 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1">
                  {suggestedPeople.slice(0, 10).map((member) => (
                    <ExplorePersonCard
                      key={member.uid}
                      member={member}
                      variant="strip"
                      isSelf={profile?.uid === member.uid}
                      isFollowing={isMemberFollowed(member.uid)}
                      followBusy={Boolean(followBusyMap[member.uid])}
                      onOpenProfile={onOpenProfile}
                      onToggleFollow={handleToggleFollow}
                    />
                  ))}
                </div>
              </section>
            )}

          {/* Popular Posts Highlight (For You homepage) */}
          {popularSpotlightPosts.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="font-display text-base sm:text-lg font-bold text-ink">
                    Popular Posts
                  </h2>
                  <p className="text-xs text-ink-muted">
                    Most liked and discussed posts across Hostel Friend
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                {popularSpotlightPosts.map((post) => (
                  <ExploreDiscoveryCard
                    key={post.id}
                    post={post}
                    spotlightLabel="Popular"
                    userReaction={userReactions.get(post.id) || null}
                    isAuthenticated={Boolean(profile)}
                    isSaved={savedIds.has(post.id)}
                    onOpenPost={setSelectedPost}
                    onOpenProfile={onOpenProfile}
                    onSearchHashtag={handleSelectTopic}
                    onSelectReaction={handleSelectReaction}
                    onRequireAuth={onRequireAuth}
                    onToggleSave={handleToggleSave}
                    onSharePost={setSharePost}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Visual Discovery Grid */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="font-display text-base sm:text-lg font-bold text-ink">
                  {hasActiveFilterOrSearch
                    ? 'Search Results'
                    : filter === 'photos'
                      ? 'Photo Discovery'
                      : filter === 'videos'
                        ? 'Video Moments'
                        : filter === 'recent'
                          ? 'Recent Posts'
                          : filter === 'posts'
                            ? 'All Community Posts'
                            : 'Explore Feed'}
                </h2>
                {mediaSliceBusy && <Loader2 className="w-4 h-4 text-accent animate-spin" />}
              </div>
              <span className="text-xs font-mono tabular-nums text-ink-subtle">
                {matchingPostsResult.posts.length}{' '}
                {matchingPostsResult.posts.length === 1 ? 'post' : 'posts'}
              </span>
            </div>

            {discoveryGridPosts.length === 0 && popularSpotlightPosts.length === 0 ? (
              <div className="glass-card rounded-2xl p-12 text-center space-y-3">
                <Search className="w-8 h-8 text-accent mx-auto" />
                <p className="font-display text-lg font-semibold text-ink">
                  {hasActiveFilterOrSearch
                    ? 'No posts match your search yet'
                    : 'Nothing to show in this category yet'}
                </p>
                <p className="text-xs text-ink-muted max-w-md mx-auto">
                  {hasActiveFilterOrSearch
                    ? 'Try a different keyword, check your hashtag spelling, or switch discovery filters.'
                    : 'As members share new photos, videos, and stories, they will appear here automatically.'}
                </p>
                {(hasActiveFilterOrSearch || filter !== 'for-you') && (
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="min-h-[42px] px-5 rounded-xl gold-gradient-btn text-xs font-semibold inline-flex items-center justify-center"
                  >
                    Back to All Discovery
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="columns-1 sm:columns-2 lg:columns-3 gap-4 space-y-4">
                  {discoveryGridPosts.map((post) => (
                    <ExploreDiscoveryCard
                      key={post.id}
                      post={post}
                      userReaction={userReactions.get(post.id) || null}
                      isAuthenticated={Boolean(profile)}
                      isSaved={savedIds.has(post.id)}
                      onOpenPost={setSelectedPost}
                      onOpenProfile={onOpenProfile}
                      onSearchHashtag={handleSelectTopic}
                      onSelectReaction={handleSelectReaction}
                      onRequireAuth={onRequireAuth}
                      onToggleSave={handleToggleSave}
                      onSharePost={setSharePost}
                    />
                  ))}
                </div>

                {hasMorePosts && !isHashtagQuery && (
                  <div className="flex justify-center pt-4">
                    <button
                      type="button"
                      disabled={loadingMorePosts}
                      onClick={() => void handleLoadMorePosts()}
                      className="min-h-[44px] px-6 rounded-xl bg-surface border border-hairline hover:border-accent/40 text-xs font-semibold text-ink inline-flex items-center gap-2 transition-colors disabled:opacity-60"
                    >
                      {loadingMorePosts && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>{loadingMorePosts ? 'Loading more...' : 'Load more posts'}</span>
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}

      {/* Full Post Lightbox Viewer */}
      {selectedPost && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          onClick={() => setSelectedPost(null)}
        >
          <div
            className="w-full max-w-2xl relative my-8 hf-modal-enter"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setSelectedPost(null)}
              aria-label="Close post view"
              className="mb-3 ml-auto flex items-center gap-1.5 min-h-[38px] px-3.5 rounded-xl bg-surface-2 border border-hairline text-xs font-medium text-ink hover:border-accent/40"
            >
              <X className="w-4 h-4" />
              <span>Close</span>
            </button>
            <PostCard
              post={selectedPost}
              currentUser={profile}
              isAdmin={isAdmin}
              userReaction={userReactions.get(selectedPost.id) || null}
              isSaved={savedIds.has(selectedPost.id)}
              onSelectReaction={handleSelectReaction}
              onToggleSave={handleToggleSave}
              onDeletePost={handleDeletePost}
              onOpenProfile={(uid) => {
                setSelectedPost(null);
                onOpenProfile(uid);
              }}
              onSearchHashtag={(tag) => {
                setSelectedPost(null);
                handleSelectTopic(tag);
              }}
              onRequireAuth={onRequireAuth}
            />
          </div>
        </div>
      )}

      {/* Quick Share Post Modal */}
      {sharePost && (
        <SharePostModal
          open={Boolean(sharePost)}
          post={sharePost}
          onClose={() => setSharePost(null)}
        />
      )}
    </div>
  );
}
