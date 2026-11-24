import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DocumentSnapshot } from 'firebase/firestore';
import {
  AlertTriangle,
  ArrowRight,
  Plus,
  PlusSquare,
  RefreshCw,
  Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { FeedTab, Poll, Post, ReactionType, StoryItem, UserProfile } from '../types';
import {
  deletePost,
  fetchPostsPage,
  getUserPostReactions,
  getUserSavedPostIds,
  reactToPost,
  toggleSavePost,
} from '../services/postService';
import { computeNextReactionState } from '../utils/reactions';
import {
  castPollVote,
  deletePoll,
  isLegacyPollPost,
  subscribePolls,
  subscribeUserPollVotes,
} from '../services/pollService';
import {
  subscribeActiveStories,
  subscribeUserLikedStoryIds,
  toggleLikeStory,
} from '../services/storyService';
import { fetchDiscoverMembers } from '../services/userService';
import { FeedComposer } from '../components/FeedComposer';
import { PollCard } from '../components/PollCard';
import { PostCard } from '../components/PostCard';
import { PostCardSkeleton, StoriesStripSkeleton } from '../components/Skeletons';
import { Avatar } from '../components/Avatar';
import { AddStoryModal, StoryViewerModal } from '../components/StoryModals';
import { formatUserFriendlyError } from '../lib/firestoreError';
import { playSound } from '../utils/soundVfx';
import { loadViewedStoryIds, saveViewedStoryIds } from '../utils/storyViewed';

interface FeedPageProps {
  onNavigateCreate: () => void;
  onNavigateExplore: () => void;
  onOpenProfile: (userId: string) => void;
  onSearchHashtag: (tag: string) => void;
  onRequireAuth: () => void;
}

export function FeedPage({
  onNavigateCreate,
  onNavigateExplore,
  onOpenProfile,
  onSearchHashtag,
  onRequireAuth,
}: FeedPageProps) {
  const {
    profile,
    privateSettings,
    isAdmin,
    platformSettings,
    friendRequests,
    followingIds,
  } = useAuth();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<FeedTab>('for-you');
  const [posts, setPosts] = useState<Post[]>([]);
  const [lastDoc, setLastDoc] = useState<DocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [userReactions, setUserReactions] = useState<Map<string, ReactionType>>(
    () => new Map()
  );
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [polls, setPolls] = useState<Poll[]>([]);
  const [votedPollOptions, setVotedPollOptions] = useState<Map<string, number>>(() => new Map());
  const [suggestedMembers, setSuggestedMembers] = useState<UserProfile[]>([]);
  const [stories, setStories] = useState<StoryItem[]>([]);
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [viewedStoryIds, setViewedStoryIds] = useState<Set<string>>(() =>
    loadViewedStoryIds(profile?.uid)
  );
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [likedStoryIds, setLikedStoryIds] = useState<Set<string>>(new Set());
  const [addStoryOpen, setAddStoryOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [bannerImgSrc, setBannerImgSrc] = useState(
    'https://res.cloudinary.com/jnobnl9r/image/upload/v1795087575/images_2_w4lp7z.jpg'
  );
  const [bannerImgFailed, setBannerImgFailed] = useState(false);
  const fetchingFeedRef = useRef(false);

  const blockedSet = useMemo(
    () => new Set(privateSettings?.blockedUserIds || []),
    [privateSettings]
  );

  const friendUidSet = useMemo(() => {
    const ids = new Set<string>(followingIds);
    if (profile?.uid) {
      friendRequests.forEach((req) => {
        if (req.status === 'accepted') {
          const otherUid = req.senderId === profile.uid ? req.recipientId : req.senderId;
          if (otherUid) ids.add(otherUid);
        }
      });
    }
    return ids;
  }, [followingIds, friendRequests, profile?.uid]);

  const loadInitialFeed = useCallback(async () => {
    if (fetchingFeedRef.current) return;
    fetchingFeedRef.current = true;
    setLoading(true);
    setFeedError(null);
    try {
      const pagePromise = fetchPostsPage(null, 12);
      const membersPromise = fetchDiscoverMembers(8);
      const [page, members] = await Promise.all([pagePromise, membersPromise]);

      setPosts(page.posts);
      setLastDoc(page.lastDoc);
      setHasMore(page.hasMore);
      setSuggestedMembers(
        members.filter((m) => m.uid !== profile?.uid && !blockedSet.has(m.uid)).slice(0, 5)
      );

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
    } catch (err) {
      const message = formatUserFriendlyError(err, 'Could not load feed');
      setFeedError(message);
      showToast({
        type: 'error',
        title: 'Could not load feed',
        description: message,
      });
    } finally {
      fetchingFeedRef.current = false;
      setLoading(false);
    }
  }, [profile, blockedSet, showToast]);

  useEffect(() => {
    void loadInitialFeed();
  }, [loadInitialFeed]);

  // Sync local viewed story state when active account changes
  useEffect(() => {
    setViewedStoryIds(loadViewedStoryIds(profile?.uid));
  }, [profile?.uid]);

  // Periodically tick clock so stories expiring while Feed stays open vanish accurately
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowTick(Date.now());
    }, 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  // Real-time 24h stories stream so uploaded stories appear immediately for all friends
  useEffect(() => {
    setStoriesLoading(true);
    const fallbackTimer = window.setTimeout(() => {
      setStoriesLoading(false);
    }, 4500);
    const unsub = subscribeActiveStories(50, (items) => {
      window.clearTimeout(fallbackTimer);
      setStories(items);
      setStoriesLoading(false);
    });
    return () => {
      window.clearTimeout(fallbackTimer);
      unsub();
    };
  }, []);

  // Real-time listener for stories liked by the current user
  useEffect(() => {
    if (!profile?.uid) {
      setLikedStoryIds(new Set());
      return;
    }
    const unsub = subscribeUserLikedStoryIds(profile.uid, setLikedStoryIds);
    return () => unsub();
  }, [profile?.uid]);

  // Real-time Interactive Polls stream + current user's vote choices
  useEffect(() => {
    const unsub = subscribePolls(
      30,
      (items) => {
        setPolls(items);
      },
      (errMessage) => {
        showToast({
          type: 'error',
          title: 'Could not sync live polls',
          description: errMessage,
        });
      }
    );
    return () => unsub();
  }, [showToast]);

  useEffect(() => {
    if (!profile?.uid) {
      setVotedPollOptions(new Map());
      return;
    }
    const unsub = subscribeUserPollVotes(profile.uid, setVotedPollOptions);
    return () => unsub();
  }, [profile?.uid]);

  const handleMarkStoryViewed = useCallback(
    (storyId: string) => {
      setViewedStoryIds((prev) => {
        if (prev.has(storyId)) return prev;
        const next = new Set(prev);
        next.add(storyId);
        const activeIds = new Set(stories.map((s) => s.id));
        saveViewedStoryIds(next, profile?.uid, activeIds);
        return next;
      });
    },
    [profile?.uid, stories]
  );

  const handleLoadMore = async () => {
    if (!lastDoc || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await fetchPostsPage(lastDoc, 12);
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...next.posts.filter((p) => !seen.has(p.id))];
      });
      setLastDoc(next.lastDoc);
      setHasMore(next.hasMore);
    } catch {
      showToast({ type: 'error', title: 'Failed to load more posts' });
    } finally {
      setLoadingMore(false);
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
    setPosts((prev) =>
      prev.map((p) =>
        p.id === post.id
          ? {
              ...p,
              likesCount: optimistic.nextLikesCount,
              reactionCounts: optimistic.nextReactionCounts,
            }
          : p
      )
    );

    try {
      const committed = await reactToPost(post, profile, optimistic.nextReaction);
      setUserReactions((prev) => {
        const next = new Map(prev);
        if (committed.nextReaction) next.set(post.id, committed.nextReaction);
        else next.delete(post.id);
        return next;
      });
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id
            ? {
                ...p,
                likesCount: committed.nextLikesCount,
                reactionCounts: committed.nextReactionCounts,
              }
            : p
        )
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
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id
            ? { ...p, likesCount: prevLikesCount, reactionCounts: prevReactionCounts }
            : p
        )
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
      showToast({
        type: 'success',
        title: currentlySaved ? 'Removed from saved' : 'Saved to your collection',
      });
    } catch {
      setSavedIds((prev) => {
        const next = new Set(prev);
        if (currentlySaved) next.add(post.id);
        else next.delete(post.id);
        return next;
      });
      showToast({ type: 'error', title: 'Could not update saved state' });
    }
  };

  const handleDeletePost = async (post: Post) => {
    try {
      await deletePost(post, profile?.uid === post.authorId);
      setPosts((prev) => prev.filter((p) => p.id !== post.id));
      showToast({ type: 'success', title: 'Post deleted' });
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Unable to delete post',
        description: formatUserFriendlyError(err),
      });
    }
  };

  const handleVotePoll = async (poll: Poll, optionIndex: number) => {
    if (!profile) {
      onRequireAuth();
      return;
    }
    if (votedPollOptions.has(poll.id)) return;

    const countKey = `count${optionIndex}` as
      | 'count0'
      | 'count1'
      | 'count2'
      | 'count3'
      | 'count4'
      | 'count5';

    setVotedPollOptions((prev) => {
      const next = new Map(prev);
      next.set(poll.id, optionIndex);
      return next;
    });
    setPolls((prev) =>
      prev.map((p) =>
        p.id === poll.id
          ? {
              ...p,
              [countKey]: (p[countKey] || 0) + 1,
              totalVotes: (p.totalVotes || 0) + 1,
            }
          : p
      )
    );

    try {
      await castPollVote(poll, profile, optionIndex);
    } catch (err) {
      setVotedPollOptions((prev) => {
        const next = new Map(prev);
        next.delete(poll.id);
        return next;
      });
      setPolls((prev) =>
        prev.map((p) =>
          p.id === poll.id
            ? {
                ...p,
                [countKey]: poll[countKey],
                totalVotes: poll.totalVotes,
              }
            : p
        )
      );
      const message = formatUserFriendlyError(err, 'Could not record your vote.');
      showToast({
        type: 'error',
        title: 'Vote failed',
        description: message,
      });
      throw new Error(message);
    }
  };

  const handleDeletePoll = async (poll: Poll) => {
    try {
      await deletePoll(poll, profile?.uid === poll.authorId);
      setPolls((prev) => prev.filter((p) => p.id !== poll.id));
      setPosts((prev) => prev.filter((p) => p.id !== poll.id));
      showToast({ type: 'success', title: 'Poll deleted' });
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Unable to delete poll',
        description: formatUserFriendlyError(err),
      });
    }
  };

  const handleToggleLikeStory = async (story: StoryItem) => {
    if (!profile) {
      onRequireAuth();
      return;
    }
    const currentlyLiked = likedStoryIds.has(story.id);
    const prevLikesCount = Math.max(0, story.likesCount ?? 0);

    setLikedStoryIds((prev) => {
      const next = new Set(prev);
      if (currentlyLiked) next.delete(story.id);
      else next.add(story.id);
      return next;
    });
    setStories((prev) =>
      prev.map((s) =>
        s.id === story.id
          ? {
              ...s,
              likesCount: Math.max(0, prevLikesCount + (currentlyLiked ? -1 : 1)),
            }
          : s
      )
    );
    if (!currentlyLiked) {
      playSound('like');
    }

    try {
      await toggleLikeStory(story, profile, currentlyLiked);
    } catch (err) {
      setLikedStoryIds((prev) => {
        const next = new Set(prev);
        if (currentlyLiked) next.add(story.id);
        else next.delete(story.id);
        return next;
      });
      setStories((prev) =>
        prev.map((s) => (s.id === story.id ? { ...s, likesCount: prevLikesCount } : s))
      );
      showToast({
        type: 'error',
        title: 'Could not update story like',
        description: formatUserFriendlyError(err),
      });
    }
  };

  // Order stories: Your Story first, then unviewed friends, unviewed hostel members, viewed friends, viewed members,
  // grouping consecutive slides per author chronologically and enforcing live 24h expiry.
  const { visibleStories, storyHighlights, unviewedAuthorsCount, firstUnviewedIndex } = useMemo(() => {
    const active = stories.filter(
      (s) => !blockedSet.has(s.authorId) && (!s.expiresAt || s.expiresAt.toMillis() > nowTick)
    );
    const grouped = new Map<string, StoryItem[]>();
    active.forEach((story) => {
      const list = grouped.get(story.authorId) || [];
      list.push(story);
      grouped.set(story.authorId, list);
    });

    const getPriority = (authorId: string, hasUnviewed: boolean) => {
      if (profile?.uid && authorId === profile.uid) return 0;
      const isFriend = friendUidSet.has(authorId);
      if (hasUnviewed) return isFriend ? 1 : 2;
      return isFriend ? 3 : 4;
    };

    const authorGroups = Array.from(grouped.entries()).map(([authorId, items]) => {
      const chronological = [...items].sort(
        (a, b) => (a.createdAt?.toMillis() || 0) - (b.createdAt?.toMillis() || 0)
      );
      const latestStory = chronological[chronological.length - 1];
      const hasUnviewed = chronological.some((s) => !viewedStoryIds.has(s.id));
      return {
        authorId,
        items: chronological,
        latestStory,
        latestAt: latestStory.createdAt?.toMillis() || 0,
        hasUnviewed,
        priority: getPriority(authorId, hasUnviewed),
      };
    });

    authorGroups.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return b.latestAt - a.latestAt;
    });

    const flattened: StoryItem[] = [];
    const highlights: {
      story: StoryItem;
      indexInStream: number;
      count: number;
      hasUnviewed: boolean;
    }[] = [];

    authorGroups.forEach((group) => {
      const startIndex = flattened.length;
      const firstUnviewedSlideOffset = group.items.findIndex((s) => !viewedStoryIds.has(s.id));
      flattened.push(...group.items);
      highlights.push({
        story: group.latestStory,
        indexInStream:
          firstUnviewedSlideOffset >= 0 ? startIndex + firstUnviewedSlideOffset : startIndex,
        count: group.items.length,
        hasUnviewed: group.hasUnviewed,
      });
    });

    const unviewedOthers = highlights.filter(
      (h) => h.hasUnviewed && h.story.authorId !== profile?.uid
    );

    return {
      visibleStories: flattened,
      storyHighlights: highlights,
      unviewedAuthorsCount: unviewedOthers.length,
      firstUnviewedIndex: unviewedOthers[0]?.indexInStream ?? 0,
    };
  }, [stories, blockedSet, nowTick, profile?.uid, friendUidSet, viewedStoryIds]);

  const displayedFeedItems = useMemo(() => {
    const visiblePosts = posts.filter(
      (p) => !blockedSet.has(p.authorId) && !isLegacyPollPost(p)
    );
    const visiblePolls = polls.filter((p) => !blockedSet.has(p.authorId));

    const combined: Array<
      | { kind: 'post'; data: Post }
      | { kind: 'poll'; data: Poll }
    > = [
      ...visiblePosts.map((p) => ({ kind: 'post' as const, data: p })),
      ...visiblePolls.map((p) => ({ kind: 'poll' as const, data: p })),
    ];

    const filtered =
      activeTab === 'following'
        ? combined.filter(
            (item) =>
              followingIds.has(item.data.authorId) || item.data.authorId === profile?.uid
          )
        : combined;

    if (activeTab === 'for-you') {
      const freshCutoffMs = Date.now() - 15 * 60 * 1000;
      return [...filtered].sort((a, b) => {
        const timeA = a.data.createdAt?.toMillis() || 0;
        const timeB = b.data.createdAt?.toMillis() || 0;
        const scoreA =
          (a.kind === 'post'
            ? a.data.likesCount * 2 + a.data.commentsCount * 3
            : (a.data.totalVotes || 0) * 2) + (timeA >= freshCutoffMs ? 25 : 0);
        const scoreB =
          (b.kind === 'post'
            ? b.data.likesCount * 2 + b.data.commentsCount * 3
            : (b.data.totalVotes || 0) * 2) + (timeB >= freshCutoffMs ? 25 : 0);
        if (scoreB !== scoreA) return scoreB - scoreA;
        return timeB - timeA;
      });
    }

    return [...filtered].sort(
      (a, b) => (b.data.createdAt?.toMillis() || 0) - (a.data.createdAt?.toMillis() || 0)
    );
  }, [posts, polls, blockedSet, activeTab, followingIds, profile]);

  const firstName = profile?.fullName?.split(' ')[0] || 'Friend';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
      {/* Main Feed Column */}
      <div className="lg:col-span-8 space-y-5 min-w-0">
        {/* Home Feed Introduction & Campus Welcome Banner */}
        <section
          aria-label="Home Feed Introduction"
          className="relative rounded-2xl overflow-hidden glass-card border-accent/25"
        >
          <div className="absolute inset-0 pointer-events-none select-none overflow-hidden">
            {!bannerImgFailed ? (
              <img
                src={bannerImgSrc}
                alt="Islamia College Peshawar"
                referrerPolicy="no-referrer"
                onError={() => {
                  if (bannerImgSrc !== '/images/icp-hero-campus.jpg') {
                    setBannerImgSrc('/images/icp-hero-campus.jpg');
                  } else {
                    setBannerImgFailed(true);
                  }
                }}
                className="w-full h-full object-cover object-center brightness-[0.65] contrast-[1.05]"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-surface-hover via-surface to-canvas" />
            )}
            <div className="absolute inset-0 bg-gradient-to-r from-canvas/95 via-canvas/85 to-canvas/45" />
            <div className="absolute inset-0 bg-gradient-to-t from-canvas via-transparent to-canvas/30" />
          </div>

          <div className="relative z-10 px-4 sm:px-6 py-4 sm:py-5 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-accent truncate">
                {profile
                  ? `Welcome back, ${firstName}${profile.hostel ? ` · ${profile.hostel}` : ''}`
                  : 'Welcome to Hostel Friend'}
              </p>
              <h1 className="mt-1 font-display text-2xl sm:text-[28px] font-extrabold tracking-tight text-ink leading-tight">
                Home Feed
              </h1>
              <p className="mt-1 text-xs sm:text-sm text-ink-2 leading-relaxed">
                Stay connected. Share memories. Grow together.
              </p>
            </div>

            <button
              type="button"
              onClick={onNavigateExplore}
              className="self-start sm:self-auto min-h-[38px] px-3.5 py-2 rounded-xl glass-btn border-accent/45 text-xs font-semibold text-accent inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <span>Discover Members</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </section>

        {/* Stories Strip */}
        <section aria-label="Stories" className="glass-card rounded-2xl p-4 sm:px-5 space-y-3">
          <div className="flex items-center justify-between gap-2 px-0.5">
            <div className="flex items-center gap-2 min-w-0">
              <h2 className="font-display text-sm font-semibold text-ink">
                Stories
              </h2>
              {!storiesLoading && storyHighlights.length > 0 && (
                <span className="text-[11px] text-ink-muted truncate">
                  · {storyHighlights.length} active
                  {unviewedAuthorsCount > 0 ? ` · ${unviewedAuthorsCount} new` : ''}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                if (visibleStories.length > 0) {
                  setViewerIndex(firstUnviewedIndex);
                } else {
                  onNavigateExplore();
                }
              }}
              className="hf-press text-xs font-semibold text-accent hover:text-accent-soft inline-flex items-center gap-1 whitespace-nowrap shrink-0"
            >
              <span>{visibleStories.length > 0 ? 'Watch all' : 'Explore'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {storiesLoading ? (
            <StoriesStripSkeleton />
          ) : (
            <div className="flex items-start gap-3.5 overflow-x-auto pb-1.5 snap-x scroll-smooth">
              {/* Create / Add Story Tile */}
              <button
                type="button"
                onClick={() => {
                  if (!profile) {
                    onRequireAuth();
                    return;
                  }
                  setAddStoryOpen(true);
                }}
                aria-label="Add Story"
                className="hf-press w-[74px] flex flex-col items-center gap-1.5 shrink-0 snap-start group text-center pt-0.5"
              >
                <div className="relative w-[64px] h-[64px] rounded-full p-[2px] border border-dashed border-accent/65 group-hover:border-accent bg-surface flex items-center justify-center transition-colors">
                  {profile ? (
                    <Avatar
                      src={profile.avatarUrl}
                      name={profile.fullName}
                      size="md"
                      className="w-full h-full opacity-80 group-hover:opacity-100 transition-opacity"
                    />
                  ) : (
                    <div className="w-full h-full rounded-full bg-surface-2" />
                  )}
                  <span className="hf-group-scale absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-gradient-to-br from-accent-soft via-accent to-accent-deep text-accent-fg border-2 border-canvas flex items-center justify-center shadow-[0_3px_10px_rgba(245,197,66,0.4)] transition-transform duration-150">
                    <Plus className="w-3.5 h-3.5 stroke-[2.75]" />
                  </span>
                </div>
                <span className="w-full text-[11px] font-semibold text-accent truncate">
                  Add Story
                </span>
              </button>

              {/* Active Author Story Rings (Circular Profile Pictures + Viewed vs Unviewed State) */}
              {storyHighlights.map(({ story, indexInStream, count, hasUnviewed }) => {
                const isOwn = Boolean(profile?.uid && story.authorId === profile.uid);
                const showGoldRing = isOwn || hasUnviewed;
                return (
                  <button
                    key={story.authorId}
                    type="button"
                    onClick={() => setViewerIndex(indexInStream)}
                    aria-label={
                      isOwn
                        ? `View your story (${count})`
                        : `View ${story.authorUsername}'s story${hasUnviewed ? ' (unviewed)' : ' (viewed)'}`
                    }
                    className="hf-press w-[74px] flex flex-col items-center gap-1.5 shrink-0 snap-start group text-center pt-0.5"
                  >
                    <div
                      className={`hf-group-scale relative p-[2.5px] rounded-full transition-transform duration-150 ${
                        showGoldRing
                          ? 'bg-gradient-to-tr from-accent-deep via-accent to-accent-soft shadow-[0_4px_14px_rgba(245,197,66,0.22)]'
                          : 'bg-hairline-strong group-hover:bg-ink-subtle'
                      }`}
                    >
                      <div className="w-[59px] h-[59px] rounded-full p-[2px] bg-canvas overflow-hidden">
                        <Avatar
                          src={story.authorAvatarUrl}
                          name={story.authorName}
                          size="md"
                          className={`w-full h-full ${
                            !showGoldRing ? 'opacity-85 group-hover:opacity-100' : ''
                          }`}
                        />
                      </div>
                      {count > 1 && (
                        <span className="absolute -bottom-0.5 -right-0.5 min-w-[19px] h-[19px] px-1 rounded-full bg-surface border border-accent/70 font-mono text-[10px] font-bold text-accent flex items-center justify-center tabular-nums">
                          {count}
                        </span>
                      )}
                    </div>
                    <span
                      className={`w-full text-[11px] truncate transition-colors ${
                        isOwn
                          ? 'font-semibold text-accent'
                          : hasUnviewed
                          ? 'font-semibold text-ink group-hover:text-accent'
                          : 'font-medium text-ink-muted group-hover:text-ink'
                      }`}
                    >
                      {isOwn ? 'Your Story' : story.authorUsername || story.authorName.split(' ')[0]}
                    </span>
                  </button>
                );
              })}

              {/* Empty state when no active 24h stories exist */}
              {storyHighlights.length === 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (!profile) {
                      onRequireAuth();
                      return;
                    }
                    setAddStoryOpen(true);
                  }}
                  className="min-h-[64px] px-4 py-2.5 rounded-2xl bg-surface border border-hairline hover:border-accent/35 text-left flex items-center gap-3 shrink-0 snap-start transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-ink">
                      No active stories right now
                    </p>
                    <p className="text-[11px] text-ink-muted">
                      Share a 24-hour hostel photo or video with your friends.
                    </p>
                  </div>
                </button>
              )}

              {/* Suggested hostel member quick avatars */}
              {suggestedMembers
                .filter((m) => !storyHighlights.some((h) => h.story.authorId === m.uid))
                .map((member) => (
                  <button
                    key={member.uid}
                    type="button"
                    onClick={() => onOpenProfile(member.uid)}
                    className="w-[74px] flex flex-col items-center gap-1.5 shrink-0 snap-start group text-center pt-0.5"
                  >
                    <div className="p-[2px] rounded-full bg-hairline-strong group-hover:bg-accent/60 transition-colors">
                      <div className="w-[59px] h-[59px] rounded-full p-[2px] bg-canvas">
                        <Avatar
                          src={member.avatarUrl}
                          name={member.fullName}
                          size="md"
                          className="w-full h-full"
                        />
                      </div>
                    </div>
                    <span className="w-full text-[11px] text-ink-muted group-hover:text-ink truncate transition-colors">
                      {member.username || member.fullName.split(' ')[0]}
                    </span>
                  </button>
                ))}
            </div>
          )}
        </section>

        {/* Functional In-Feed Post & Poll Composer */}
        <FeedComposer
          onPostCreated={(createdPost) => {
            if (createdPost) {
              setPosts((prev) =>
                prev.some((p) => p.id === createdPost.id) ? prev : [createdPost, ...prev]
              );
            } else {
              void loadInitialFeed();
            }
          }}
          onPollCreated={(createdPoll) => {
            setPolls((prev) =>
              prev.some((p) => p.id === createdPoll.id) ? prev : [createdPoll, ...prev]
            );
          }}
          onOpenFullCreate={onNavigateCreate}
          onRequireAuth={onRequireAuth}
        />

        {/* Feed Filter Bar + Refresh */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <div
            role="tablist"
            aria-label="Feed filters"
            className="flex items-center gap-1 p-1 glass-card rounded-xl overflow-x-auto"
          >
            {(
              [
                { id: 'for-you', label: 'For You' },
                { id: 'following', label: 'Following' },
                { id: 'latest', label: 'Latest' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`min-h-[36px] px-3.5 py-1.5 text-xs font-semibold rounded-lg hf-press whitespace-nowrap shrink-0 ${
                  activeTab === tab.id
                    ? 'bg-gradient-to-r from-accent to-accent-deep text-accent-fg shadow-sm'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={() => void loadInitialFeed()}
            aria-label="Refresh feed"
            className="min-w-[44px] min-h-[44px] px-3 flex items-center justify-center gap-1.5 rounded-xl glass-btn text-accent shrink-0 disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline text-xs font-semibold">Refresh</span>
          </button>
        </div>

        {/* Feed Content States */}
        {loading ? (
          <div className="space-y-5">
            <PostCardSkeleton />
            <PostCardSkeleton />
          </div>
        ) : feedError && posts.length === 0 && polls.length === 0 ? (
          <div
            role="alert"
            className="glass-card border-rose-500/30 rounded-2xl p-8 text-center space-y-3"
          >
            <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto" />
            <h2 className="font-display text-base font-semibold text-ink">
              Unable to load Home Feed
            </h2>
            <p className="text-xs sm:text-sm text-ink-muted max-w-md mx-auto">
              {feedError}
            </p>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => void loadInitialFeed()}
                className="min-h-[44px] gold-gradient-btn px-5 py-2.5 rounded-xl text-xs font-bold inline-flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Try Again</span>
              </button>
            </div>
          </div>
        ) : displayedFeedItems.length === 0 ? (
          <div className="glass-card rounded-2xl p-8 sm:p-10 text-center">
            <Users className="w-8 h-8 text-accent mx-auto" />
            <h2 className="mt-4 font-display text-lg font-semibold text-ink">
              {activeTab === 'following'
                ? 'Your Following stream is quiet'
                : 'No posts published yet'}
            </h2>
            <p className="mt-2 text-sm text-ink-muted max-w-md mx-auto">
              {activeTab === 'following'
                ? 'Follow fellow hostel members in Explore to see their photographs, videos, polls, and updates here.'
                : 'Share the very first photograph, video, poll, or hostel update with your peers.'}
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={onNavigateCreate}
                className="min-h-[44px] gold-gradient-btn px-5 py-2.5 rounded-xl text-sm font-bold inline-flex items-center gap-2"
              >
                <PlusSquare className="w-4 h-4" />
                <span>Create Post</span>
              </button>
              <button
                type="button"
                onClick={onNavigateExplore}
                className="min-h-[44px] px-5 py-2.5 rounded-xl text-sm font-medium border border-hairline-strong bg-surface-2 text-ink hover:border-accent/50"
              >
                Explore Members
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {displayedFeedItems.map((item) =>
              item.kind === 'poll' ? (
                <PollCard
                  key={`poll-${item.data.id}`}
                  poll={item.data}
                  currentUser={profile}
                  isAdmin={isAdmin}
                  userVotedIndex={votedPollOptions.get(item.data.id)}
                  onVote={handleVotePoll}
                  onDeletePoll={handleDeletePoll}
                  onOpenProfile={onOpenProfile}
                  onRequireAuth={onRequireAuth}
                />
              ) : (
                <PostCard
                  key={item.data.id}
                  variant="feed"
                  post={item.data}
                  currentUser={profile}
                  isAdmin={isAdmin}
                  userReaction={userReactions.get(item.data.id) || null}
                  isSaved={savedIds.has(item.data.id)}
                  onSelectReaction={handleSelectReaction}
                  onToggleSave={handleToggleSave}
                  onDeletePost={handleDeletePost}
                  onOpenProfile={onOpenProfile}
                  onSearchHashtag={onSearchHashtag}
                  onRequireAuth={onRequireAuth}
                />
              )
            )}

            {hasMore && (
              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="min-h-[44px] px-6 py-2.5 rounded-xl glass-btn border-accent/30 text-sm font-semibold text-accent disabled:opacity-50"
                >
                  {loadingMore ? 'Loading more posts...' : 'Load More Posts'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Desktop Right Rail */}
      <aside className="hidden lg:block lg:col-span-4 space-y-5 sticky top-20">
        {profile && (
          <div className="glass-card rounded-2xl p-5">
            <button
              type="button"
              onClick={() => onOpenProfile(profile.uid)}
              className="w-full flex items-center gap-3.5 text-left group"
            >
              <div className="p-[1.5px] rounded-full bg-gradient-to-tr from-accent-deep via-accent to-accent-soft shrink-0">
                <Avatar src={profile.avatarUrl} name={profile.fullName} size="md" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-display font-semibold text-ink group-hover:text-accent transition-colors truncate">
                  {profile.fullName}
                </p>
                <p className="text-xs text-ink-muted truncate">@{profile.username}</p>
              </div>
            </button>
            {profile.hostel && (
              <p className="mt-3 text-xs text-ink-muted">{profile.hostel}</p>
            )}
            <div className="mt-4 pt-4 border-t border-hairline grid grid-cols-3 text-center">
              <div>
                <p className="font-mono text-sm font-semibold text-ink tabular-nums">
                  {profile.postsCount}
                </p>
                <p className="text-[11px] text-ink-muted">Posts</p>
              </div>
              <div>
                <p className="font-mono text-sm font-semibold text-ink tabular-nums">
                  {profile.followersCount}
                </p>
                <p className="text-[11px] text-ink-muted">Followers</p>
              </div>
              <div>
                <p className="font-mono text-sm font-semibold text-ink tabular-nums">
                  {profile.followingCount}
                </p>
                <p className="text-[11px] text-ink-muted">Following</p>
              </div>
            </div>
          </div>
        )}

        <div className="glass-card rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-sm font-semibold text-ink">
              Discover Members
            </h2>
            <button
              type="button"
              onClick={onNavigateExplore}
              className="text-xs font-medium text-accent hover:text-accent-soft"
            >
              See all
            </button>
          </div>
          {suggestedMembers.length === 0 ? (
            <p className="text-xs text-ink-muted">New members will appear here as they join.</p>
          ) : (
            <div className="space-y-3">
              {suggestedMembers.map((member) => (
                <button
                  key={member.uid}
                  type="button"
                  onClick={() => onOpenProfile(member.uid)}
                  className="w-full min-h-[44px] flex items-center justify-between gap-3 text-left group rounded-xl px-1.5 py-1 hover:bg-hover-tint transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar src={member.avatarUrl} name={member.fullName} size="sm" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-ink group-hover:text-accent transition-colors truncate">
                        {member.fullName}
                      </p>
                      <p className="text-[11px] text-ink-muted truncate">
                        @{member.username}
                        {member.hostel ? ` · ${member.hostel}` : ''}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="glass-card rounded-2xl p-5">
          <h2 className="font-display text-sm font-semibold text-ink mb-3">
            Trending Tags
          </h2>
          <div className="flex flex-wrap gap-x-3.5 gap-y-2 text-xs text-accent">
            {platformSettings.featuredHashtags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => onSearchHashtag(tag)}
                className="hover:text-accent-soft hover:underline"
              >
                #{tag}
              </button>
            ))}
          </div>
        </div>
      </aside>

      {profile && (
        <AddStoryModal
          open={addStoryOpen}
          profile={profile}
          maxUploadSizeMB={platformSettings.maxUploadSizeMB}
          onClose={() => setAddStoryOpen(false)}
          onStoryCreated={(newStory) => {
            setStories((prev) =>
              prev.some((s) => s.id === newStory.id) ? prev : [newStory, ...prev]
            );
          }}
        />
      )}

      {viewerIndex !== null && visibleStories.length > 0 && (
        <StoryViewerModal
          stories={visibleStories}
          initialIndex={viewerIndex}
          currentUser={profile}
          isAdmin={isAdmin}
          likedStoryIds={likedStoryIds}
          onClose={() => setViewerIndex(null)}
          onOpenProfile={onOpenProfile}
          onStoryDeleted={(storyId) => {
            setStories((prev) => prev.filter((s) => s.id !== storyId));
          }}
          onToggleLikeStory={handleToggleLikeStory}
          onMarkStoryViewed={handleMarkStoryViewed}
          onRequireAuth={onRequireAuth}
        />
      )}
    </div>
  );
}
