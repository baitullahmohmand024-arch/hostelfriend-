import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Film,
  Loader2,
  MessageCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Send,
  Share2,
  Trash2,
  UserCheck,
  UserPlus,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { DocumentSnapshot } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { CommentItem, Post, ReactionType } from '../types';
import {
  addComment,
  deleteComment,
  fetchComments,
  fetchVideoMomentsPage,
  getUserPostReactions,
  reactToPost,
} from '../services/postService';
import { followUser, subscribeFollowingIds, unfollowUser } from '../services/userService';
import { Avatar } from '../components/Avatar';
import { ReactionControl } from '../components/ReactionControl';
import { ReactionDetailsModal } from '../components/ReactionDetailsModal';
import { SharePostModal } from '../components/SharePostModal';
import { ShortVideoUploadModal } from '../components/ShortVideoUploadModal';
import { formatCount, formatRelativeTime } from '../utils/formatters';
import { computeNextReactionState, getTopReactionsSummary } from '../utils/reactions';
import { playSound } from '../utils/soundVfx';
import { formatUserFriendlyError } from '../lib/firestoreError';

type MomentsTab = 'for-you' | 'following' | 'latest';

interface MomentsPageProps {
  onOpenProfile: (userId: string) => void;
  onNavigateCreate: () => void;
  onRequireAuth: () => void;
  onSearchHashtag?: (hashtag: string) => void;
}

function getSaveDataPreference(): boolean {
  if (typeof navigator === 'undefined') return false;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return Boolean(conn?.saveData);
}

function getReducedMotionPreference(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function formatVideoTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const rounded = Math.floor(sec);
  const m = Math.floor(rounded / 60);
  const s = rounded % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function MomentsPage({
  onOpenProfile,
  onNavigateCreate,
  onRequireAuth,
  onSearchHashtag,
}: MomentsPageProps) {
  const { profile } = useAuth();
  const { showToast } = useToast();

  const [tab, setTab] = useState<MomentsTab>('for-you');
  const [videos, setVideos] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const [tapFeedback, setTapFeedback] = useState<'play' | 'pause' | null>(null);

  const [bufferingIds, setBufferingIds] = useState<Set<string>>(() => new Set());
  const [errorIds, setErrorIds] = useState<Set<string>>(() => new Set());
  const [progressById, setProgressById] = useState<
    Record<string, { current: number; duration: number }>
  >({});
  const [expandedCaptions, setExpandedCaptions] = useState<Set<string>>(() => new Set());

  const [followingIds, setFollowingIds] = useState<Set<string>>(() => new Set());
  const [followBusyIds, setFollowBusyIds] = useState<Set<string>>(() => new Set());

  const [userReactions, setUserReactions] = useState<Map<string, ReactionType>>(
    () => new Map()
  );
  const [reactionDetailsPost, setReactionDetailsPost] = useState<Post | null>(null);
  const [sharePost, setSharePost] = useState<Post | null>(null);

  const [commentsPost, setCommentsPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);

  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  const saveData = useMemo(() => getSaveDataPreference(), []);
  const reducedMotion = useMemo(() => getReducedMotionPreference(), []);

  const feedRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const lastDocRef = useRef<DocumentSnapshot | null>(null);
  const userPausedRef = useRef(false);
  const tapFeedbackTimerRef = useRef<number | null>(null);

  userPausedRef.current = userPaused;

  useEffect(() => {
    if (!profile?.uid) {
      setFollowingIds(new Set());
      return;
    }
    return subscribeFollowingIds(profile.uid, (ids) => {
      setFollowingIds(new Set(ids));
    });
  }, [profile?.uid]);

  const loadInitialMoments = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    lastDocRef.current = null;
    try {
      const [page, reactions] = await Promise.all([
        fetchVideoMomentsPage({ pageSize: 8 }),
        profile ? getUserPostReactions(profile.uid) : Promise.resolve(new Map<string, ReactionType>()),
      ]);
      setVideos(page.videos);
      lastDocRef.current = page.lastDoc;
      setHasMore(page.hasMore);
      setUserReactions(reactions);
      setActiveIndex(0);
      setUserPaused(reducedMotion);
      if (feedRef.current) {
        feedRef.current.scrollTo({ top: 0 });
      }
    } catch (err) {
      const message = formatUserFriendlyError(err, 'Could not load Short Videos right now.');
      setLoadError(message);
      showToast({ type: 'error', title: 'Could not load Moments', description: message });
    } finally {
      setLoading(false);
    }
  }, [profile, reducedMotion, showToast]);

  useEffect(() => {
    void loadInitialMoments();
  }, [loadInitialMoments]);

  const loadMoreMoments = useCallback(async () => {
    if (loadingMore || !hasMore || !lastDocRef.current) return;
    setLoadingMore(true);
    try {
      const page = await fetchVideoMomentsPage({
        lastSnapshot: lastDocRef.current,
        pageSize: 8,
      });
      lastDocRef.current = page.lastDoc;
      setHasMore(page.hasMore);
      setVideos((prev) => {
        const existing = new Set(prev.map((v) => v.id));
        const fresh = page.videos.filter((v) => !existing.has(v.id));
        return fresh.length > 0 ? [...prev, ...fresh] : prev;
      });
    } catch {
      // Quietly keep existing list usable if pagination fails
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore]);

  const displayVideos = useMemo(() => {
    if (tab === 'latest') {
      return [...videos].sort(
        (a, b) => (b.createdAt?.toMillis() || Date.now()) - (a.createdAt?.toMillis() || Date.now())
      );
    }
    if (tab === 'following') {
      return videos.filter((v) => followingIds.has(v.authorId) || v.authorId === profile?.uid);
    }
    // For You: blend real recency + real engagement + followed creator boost
    const now = Date.now();
    return [...videos].sort((a, b) => {
      const aTime = a.createdAt?.toMillis() || now;
      const bTime = b.createdAt?.toMillis() || now;
      const aAgeHrs = Math.max(0.5, (now - aTime) / 3_600_000);
      const bAgeHrs = Math.max(0.5, (now - bTime) / 3_600_000);
      const aEngagement = (a.likesCount || 0) * 2 + (a.commentsCount || 0) * 3;
      const bEngagement = (b.likesCount || 0) * 2 + (b.commentsCount || 0) * 3;
      const aFollowBoost = followingIds.has(a.authorId) ? 6 : 0;
      const bFollowBoost = followingIds.has(b.authorId) ? 6 : 0;
      const aScore = (aEngagement + aFollowBoost + 4) / Math.pow(aAgeHrs + 2, 0.85);
      const bScore = (bEngagement + bFollowBoost + 4) / Math.pow(bAgeHrs + 2, 0.85);
      if (Math.abs(bScore - aScore) > 0.001) return bScore - aScore;
      return bTime - aTime;
    });
  }, [tab, videos, followingIds, profile?.uid]);

  const safeActiveIndex = Math.min(activeIndex, Math.max(0, displayVideos.length - 1));
  const currentVideo = displayVideos[safeActiveIndex] || null;

  // Trigger pagination when approaching the end of the loaded clips
  useEffect(() => {
    if (displayVideos.length > 0 && safeActiveIndex >= displayVideos.length - 2 && hasMore) {
      void loadMoreMoments();
    }
  }, [safeActiveIndex, displayVideos.length, hasMore, loadMoreMoments]);

  // Reset scroll to top when switching discovery tabs
  const handleTabChange = (nextTab: MomentsTab) => {
    setTab(nextTab);
    setActiveIndex(0);
    setUserPaused(reducedMotion);
    setCommentsPost(null);
    if (feedRef.current) {
      feedRef.current.scrollTo({ top: 0, behavior: 'auto' });
    }
  };

  // IntersectionObserver ensures ONLY the visible card (>=65% in view) becomes active
  useEffect(() => {
    const root = feedRef.current;
    if (!root || displayVideos.length === 0) return;

    const indexById = new Map(displayVideos.map((v, idx) => [v.id, idx]));
    const observer = new IntersectionObserver(
      (entries) => {
        let bestEntry: IntersectionObserverEntry | null = null;
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.65) {
            if (!bestEntry || entry.intersectionRatio > bestEntry.intersectionRatio) {
              bestEntry = entry;
            }
          }
        }
        if (bestEntry) {
          const id = (bestEntry.target as HTMLElement).dataset.momentId;
          if (id && indexById.has(id)) {
            const idx = indexById.get(id)!;
            setActiveIndex(idx);
            setUserPaused(reducedMotion);
          }
        }
      },
      { root, threshold: [0.65, 0.85] }
    );

    for (const v of displayVideos) {
      const el = cardRefs.current.get(v.id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [displayVideos, reducedMotion]);

  // Strictly enforce ONE active playing video at a time; pause all others
  useEffect(() => {
    const activeId = currentVideo?.id;
    videoRefs.current.forEach((videoEl, id) => {
      if (id !== activeId) {
        if (!videoEl.paused) {
          videoEl.pause();
        }
        if (videoEl.currentTime > 0) {
          try {
            videoEl.currentTime = 0;
          } catch {
            // ignore seek error before metadata loads
          }
        }
      }
    });

    if (!activeId) return;
    const activeVideoEl = videoRefs.current.get(activeId);
    if (!activeVideoEl) return;

    activeVideoEl.muted = muted;
    if (userPaused || uploadModalOpen || Boolean(sharePost) || Boolean(reactionDetailsPost)) {
      activeVideoEl.pause();
      setIsPlaying(false);
      return;
    }

    const playPromise = activeVideoEl.play();
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise
        .then(() => {
          setIsPlaying(true);
        })
        .catch(() => {
          // If unmuted autoplay is blocked by browser policy, fallback to muted playback cleanly
          if (!activeVideoEl.muted) {
            activeVideoEl.muted = true;
            setMuted(true);
            activeVideoEl
              .play()
              .then(() => setIsPlaying(true))
              .catch(() => setIsPlaying(false));
          } else {
            setIsPlaying(false);
          }
        });
    }
  }, [
    currentVideo?.id,
    muted,
    userPaused,
    uploadModalOpen,
    sharePost,
    reactionDetailsPost,
  ]);

  // Pause active video when tab becomes hidden; resume on return unless user paused
  useEffect(() => {
    const onVisibilityChange = () => {
      const activeId = currentVideo?.id;
      if (!activeId) return;
      const el = videoRefs.current.get(activeId);
      if (!el) return;

      if (document.hidden) {
        el.pause();
        setIsPlaying(false);
      } else if (!userPausedRef.current && !uploadModalOpen) {
        el.play()
          .then(() => setIsPlaying(true))
          .catch(() => setIsPlaying(false));
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [currentVideo?.id, uploadModalOpen]);

  // Pause all videos cleanly on unmount
  useEffect(() => {
    const mapSnapshot = videoRefs.current;
    return () => {
      if (tapFeedbackTimerRef.current !== null) {
        window.clearTimeout(tapFeedbackTimerRef.current);
      }
      mapSnapshot.forEach((el) => {
        try {
          el.pause();
        } catch {
          // ignore
        }
      });
    };
  }, []);

  const scrollToIndex = useCallback(
    (targetIdx: number) => {
      const clamped = Math.max(0, Math.min(displayVideos.length - 1, targetIdx));
      const targetVideo = displayVideos[clamped];
      if (!targetVideo) return;
      const el = cardRefs.current.get(targetVideo.id);
      if (el) {
        el.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
      }
      setActiveIndex(clamped);
      setUserPaused(reducedMotion);
    },
    [displayVideos, reducedMotion]
  );

  const showTransientFeedback = (kind: 'play' | 'pause') => {
    if (tapFeedbackTimerRef.current !== null) {
      window.clearTimeout(tapFeedbackTimerRef.current);
    }
    setTapFeedback(kind);
    tapFeedbackTimerRef.current = window.setTimeout(() => {
      setTapFeedback(null);
    }, 520);
  };

  const togglePlayForActive = useCallback(() => {
    if (!currentVideo) return;
    const el = videoRefs.current.get(currentVideo.id);
    if (!el) return;

    if (el.paused) {
      setUserPaused(false);
      el.play()
        .then(() => {
          setIsPlaying(true);
          showTransientFeedback('play');
        })
        .catch(() => setIsPlaying(false));
    } else {
      setUserPaused(true);
      el.pause();
      setIsPlaying(false);
      showTransientFeedback('pause');
    }
  }, [currentVideo]);

  // Keyboard shortcuts for desktop navigation
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (uploadModalOpen || commentsPost || sharePost || reactionDetailsPost) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        scrollToIndex(safeActiveIndex + 1);
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        scrollToIndex(safeActiveIndex - 1);
      } else if (e.key === ' ') {
        e.preventDefault();
        togglePlayForActive();
      } else if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        setMuted((prev) => !prev);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    safeActiveIndex,
    scrollToIndex,
    togglePlayForActive,
    uploadModalOpen,
    commentsPost,
    sharePost,
    reactionDetailsPost,
  ]);

  const handleRetryVideo = (postId: string) => {
    setErrorIds((prev) => {
      const next = new Set(prev);
      next.delete(postId);
      return next;
    });
    setBufferingIds((prev) => new Set(prev).add(postId));
    const el = videoRefs.current.get(postId);
    if (el) {
      el.load();
      el.play().catch(() => {});
    }
  };

  const handleSeekVideo = (postId: string, seconds: number) => {
    const el = videoRefs.current.get(postId);
    if (!el) return;
    el.currentTime = seconds;
    setProgressById((prev) => ({
      ...prev,
      [postId]: {
        current: seconds,
        duration: prev[postId]?.duration || el.duration || 10,
      },
    }));
  };

  const handleToggleFollow = async (authorId: string) => {
    if (!profile) {
      onRequireAuth();
      return;
    }
    if (profile.uid === authorId || followBusyIds.has(authorId)) return;

    const currentlyFollowing = followingIds.has(authorId);
    setFollowBusyIds((prev) => new Set(prev).add(authorId));
    setFollowingIds((prev) => {
      const next = new Set(prev);
      if (currentlyFollowing) next.delete(authorId);
      else next.add(authorId);
      return next;
    });

    try {
      if (currentlyFollowing) {
        await unfollowUser(profile.uid, authorId);
      } else {
        await followUser(profile, authorId);
        playSound('follow');
      }
    } catch (err) {
      setFollowingIds((prev) => {
        const next = new Set(prev);
        if (currentlyFollowing) next.add(authorId);
        else next.delete(authorId);
        return next;
      });
      showToast({
        type: 'error',
        title: 'Could not update follow status',
        description: formatUserFriendlyError(err, 'Please try again.'),
      });
    } finally {
      setFollowBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(authorId);
        return next;
      });
    }
  };

  const handleSelectReaction = async (targetPost: Post, nextChoice: ReactionType | null) => {
    if (!profile) {
      onRequireAuth();
      return;
    }
    const prevReaction = userReactions.get(targetPost.id) || null;
    const prevLikesCount = targetPost.likesCount;
    const prevReactionCounts = targetPost.reactionCounts;
    const optimistic = computeNextReactionState(targetPost, prevReaction, nextChoice);

    setUserReactions((prev) => {
      const next = new Map(prev);
      if (optimistic.nextReaction) next.set(targetPost.id, optimistic.nextReaction);
      else next.delete(targetPost.id);
      return next;
    });
    setVideos((prev) =>
      prev.map((v) =>
        v.id === targetPost.id
          ? {
              ...v,
              likesCount: optimistic.nextLikesCount,
              reactionCounts: optimistic.nextReactionCounts,
            }
          : v
      )
    );

    try {
      const committed = await reactToPost(targetPost, profile, optimistic.nextReaction);
      setUserReactions((prev) => {
        const next = new Map(prev);
        if (committed.nextReaction) next.set(targetPost.id, committed.nextReaction);
        else next.delete(targetPost.id);
        return next;
      });
      setVideos((prev) =>
        prev.map((v) =>
          v.id === targetPost.id
            ? {
                ...v,
                likesCount: committed.nextLikesCount,
                reactionCounts: committed.nextReactionCounts,
              }
            : v
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
        if (prevReaction) next.set(targetPost.id, prevReaction);
        else next.delete(targetPost.id);
        return next;
      });
      setVideos((prev) =>
        prev.map((v) =>
          v.id === targetPost.id
            ? { ...v, likesCount: prevLikesCount, reactionCounts: prevReactionCounts }
            : v
        )
      );
      showToast({
        type: 'error',
        title: 'Could not update reaction',
        description: formatUserFriendlyError(err, 'Please try again.'),
      });
    }
  };

  const openCommentsDrawer = async (post: Post) => {
    setCommentsPost(post);
    setComments([]);
    setCommentsLoading(true);
    try {
      const list = await fetchComments(post.id);
      setComments(list);
    } catch {
      showToast({ type: 'error', title: 'Could not load comments' });
    } finally {
      setCommentsLoading(false);
    }
  };

  const handleSendComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentsPost) return;
    if (!profile) {
      onRequireAuth();
      return;
    }
    if (!commentText.trim() || submittingComment) return;
    setSubmittingComment(true);
    try {
      const added = await addComment(commentsPost, profile, commentText);
      setComments((prev) => [...prev, added]);
      setVideos((prev) =>
        prev.map((v) =>
          v.id === commentsPost.id ? { ...v, commentsCount: v.commentsCount + 1 } : v
        )
      );
      setCommentsPost((prev) =>
        prev ? { ...prev, commentsCount: prev.commentsCount + 1 } : null
      );
      setCommentText('');
      playSound('comment');
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Could not send comment',
        description: formatUserFriendlyError(err, 'Please try again.'),
      });
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleDeleteComment = async (item: CommentItem) => {
    if (!profile || item.authorId !== profile.uid || deletingCommentId) return;
    setDeletingCommentId(item.id);
    try {
      await deleteComment(item);
      setComments((prev) => prev.filter((c) => c.id !== item.id));
      setVideos((prev) =>
        prev.map((v) =>
          v.id === item.postId
            ? { ...v, commentsCount: Math.max(0, v.commentsCount - 1) }
            : v
        )
      );
      setCommentsPost((prev) =>
        prev && prev.id === item.postId
          ? { ...prev, commentsCount: Math.max(0, prev.commentsCount - 1) }
          : prev
      );
    } catch {
      showToast({ type: 'error', title: 'Could not delete comment' });
    } finally {
      setDeletingCommentId(null);
    }
  };

  const handleOpenUpload = () => {
    if (!profile) {
      onRequireAuth();
      return;
    }
    setUploadModalOpen(true);
  };

  const handleShortPublished = (createdPost: Post) => {
    setVideos((prev) => [createdPost, ...prev.filter((v) => v.id !== createdPost.id)]);
    if (tab === 'following') {
      setTab('for-you');
    }
    setActiveIndex(0);
    setUserPaused(false);
    window.setTimeout(() => {
      feedRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    }, 60);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center py-4 space-y-4">
        <div className="w-full max-w-[430px] flex items-center justify-between">
          <div className="h-9 w-56 rounded-xl bg-surface-2 animate-pulse" />
          <div className="h-10 w-28 rounded-xl bg-surface-2 animate-pulse" />
        </div>
        <div className="w-full max-w-[430px] h-[calc(100dvh-13rem)] max-h-[720px] rounded-3xl glass-card animate-pulse" />
      </div>
    );
  }

  if (loadError && videos.length === 0) {
    return (
      <div className="max-w-lg mx-auto glass-card rounded-3xl p-8 sm:p-10 text-center my-8 space-y-4">
        <AlertCircle className="w-10 h-10 text-red-400 mx-auto" />
        <div>
          <h1 className="font-display text-xl font-bold text-ink">Unable to load Short Videos</h1>
          <p className="mt-2 text-xs sm:text-sm text-ink-muted leading-relaxed">{loadError}</p>
        </div>
        <button
          type="button"
          onClick={() => void loadInitialMoments()}
          className="gold-gradient-btn min-h-[44px] px-5 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Try Again</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      {/* Top Moments Header & Discovery Tabs */}
      <div className="w-full max-w-2xl flex flex-wrap items-center justify-between gap-2.5 mb-3">
        <div
          role="tablist"
          aria-label="Short videos feed filter"
          className="glass-card rounded-2xl p-1 inline-flex items-center gap-1"
        >
          {(
            [
              { id: 'for-you', label: 'For You' },
              { id: 'following', label: 'Following' },
              { id: 'latest', label: 'Latest' },
            ] as const
          ).map((item) => {
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => handleTabChange(item.id)}
                className={`min-h-[36px] px-3 sm:px-4 rounded-xl text-xs font-semibold transition-all ${
                  active
                    ? 'bg-accent text-accent-fg shadow-sm'
                    : 'text-ink-muted hover:text-ink hover:bg-hover-tint'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadInitialMoments()}
            aria-label="Refresh short videos"
            title="Refresh"
            className="glass-btn min-w-[42px] min-h-[42px] rounded-xl flex items-center justify-center text-ink-muted hover:text-ink"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={handleOpenUpload}
            className="gold-gradient-btn min-h-[42px] px-3.5 sm:px-4 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>Upload Short</span>
          </button>
        </div>
      </div>

      {/* Empty State */}
      {displayVideos.length === 0 ? (
        <div className="w-full max-w-lg glass-card rounded-3xl p-10 text-center my-6 space-y-4">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-accent/15 border border-accent/35 text-accent flex items-center justify-center">
            <Film className="w-7 h-7" />
          </div>
          {tab === 'following' ? (
            <>
              <h1 className="font-display text-xl font-bold text-ink">
                {profile
                  ? 'No clips from creators you follow yet'
                  : 'Sign in to see Following shorts'}
              </h1>
              <p className="text-xs sm:text-sm text-ink-muted leading-relaxed">
                {profile
                  ? 'Follow hostel friends inside For You or Explore to fill this feed with their 10-second clips.'
                  : 'Log in to follow campus creators and keep their latest moments in one place.'}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => handleTabChange('for-you')}
                  className="gold-gradient-btn min-h-[44px] px-5 py-2.5 rounded-xl text-sm font-semibold"
                >
                  Browse For You
                </button>
                {!profile && (
                  <button
                    type="button"
                    onClick={onRequireAuth}
                    className="glass-btn min-h-[44px] px-4 py-2.5 rounded-xl text-sm font-semibold text-ink-2"
                  >
                    Sign In
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <h1 className="font-display text-xl font-bold text-ink">No Short Videos Yet</h1>
              <p className="text-xs sm:text-sm text-ink-muted leading-relaxed">
                Share a 10-second clip from your hostel rooftop, chai stall, or study session.
                Longer videos are automatically trimmed to their first 10 seconds.
              </p>
              <button
                type="button"
                onClick={handleOpenUpload}
                className="gold-gradient-btn min-h-[44px] px-5 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span>Upload First 10s Short</span>
              </button>
            </>
          )}
        </div>
      ) : (
        /* Theater Layout: Centered Vertical Snap Feed + Desktop Side Controls */
        <div className="w-full flex items-center justify-center gap-5">
          {/* Vertical Snap Feed Viewport */}
          <div
            ref={feedRef}
            className="w-full max-w-[430px] h-[calc(100dvh-11.25rem-env(safe-area-inset-bottom))] md:h-[calc(100dvh-10.5rem)] md:max-h-[760px] min-h-[460px] snap-y snap-mandatory overflow-y-auto overscroll-y-contain no-scrollbar rounded-3xl border border-hairline-strong bg-black shadow-2xl"
          >
            {displayVideos.map((video, idx) => {
              const isActive = idx === safeActiveIndex;
              const shouldAttachMedia =
                isActive || (!saveData && Math.abs(idx - safeActiveIndex) <= 1);
              const isBuffering = bufferingIds.has(video.id);
              const hasVideoError = errorIds.has(video.id);
              const progress = progressById[video.id] || { current: 0, duration: 10 };
              const durationSafe = Math.max(0.5, progress.duration || 10);
              const progressPct = Math.min(100, Math.max(0, (progress.current / durationSafe) * 100));

              const isOwn = profile?.uid === video.authorId;
              const isFollowingAuthor = followingIds.has(video.authorId);
              const followBusy = followBusyIds.has(video.authorId);
              const isCaptionExpanded = expandedCaptions.has(video.id);
              const reactionSummary = getTopReactionsSummary(video, 3);

              return (
                <div
                  key={video.id}
                  ref={(el) => {
                    if (el) cardRefs.current.set(video.id, el);
                    else cardRefs.current.delete(video.id);
                  }}
                  data-moment-id={video.id}
                  className="relative w-full h-full snap-start snap-always shrink-0 overflow-hidden bg-black select-none"
                >
                  {/* Video Element or Poster Placeholder when off-screen */}
                  {shouldAttachMedia && video.mediaUrl ? (
                    <video
                      ref={(el) => {
                        if (el) videoRefs.current.set(video.id, el);
                        else videoRefs.current.delete(video.id);
                      }}
                      src={video.mediaUrl}
                      poster={video.thumbnailUrl || undefined}
                      playsInline
                      loop
                      muted={muted}
                      preload={isActive ? 'auto' : 'metadata'}
                      onClick={() => {
                        if (isActive) togglePlayForActive();
                      }}
                      onLoadStart={() => {
                        setBufferingIds((prev) => new Set(prev).add(video.id));
                      }}
                      onWaiting={() => {
                        setBufferingIds((prev) => new Set(prev).add(video.id));
                      }}
                      onCanPlay={() => {
                        setBufferingIds((prev) => {
                          const next = new Set(prev);
                          next.delete(video.id);
                          return next;
                        });
                      }}
                      onPlaying={() => {
                        setBufferingIds((prev) => {
                          const next = new Set(prev);
                          next.delete(video.id);
                          return next;
                        });
                        setErrorIds((prev) => {
                          const next = new Set(prev);
                          next.delete(video.id);
                          return next;
                        });
                        if (isActive) setIsPlaying(true);
                      }}
                      onPause={() => {
                        if (isActive) setIsPlaying(false);
                      }}
                      onTimeUpdate={(e) => {
                        const vid = e.currentTarget;
                        const dur =
                          Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : 10;
                        setProgressById((prev) => ({
                          ...prev,
                          [video.id]: {
                            current: vid.currentTime || 0,
                            duration: dur,
                          },
                        }));
                      }}
                      onError={() => {
                        setBufferingIds((prev) => {
                          const next = new Set(prev);
                          next.delete(video.id);
                          return next;
                        });
                        setErrorIds((prev) => new Set(prev).add(video.id));
                      }}
                      className="w-full h-full object-cover cursor-pointer"
                    />
                  ) : (
                    <div className="w-full h-full bg-canvas-alt flex items-center justify-center">
                      {video.thumbnailUrl ? (
                        <img
                          src={video.thumbnailUrl}
                          alt={video.caption || `${video.authorName} short video`}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <Film className="w-10 h-10 text-ink-subtle" />
                      )}
                    </div>
                  )}

                  {/* Top Gradient Scrim + Controls (>=44x44px hitboxes) */}
                  <div className="absolute top-0 inset-x-0 bg-gradient-to-b from-black/75 via-black/30 to-transparent p-3.5 sm:p-4 flex items-center justify-between pointer-events-none">
                    <div className="flex items-center gap-2 pointer-events-auto">
                      <button
                        type="button"
                        onClick={togglePlayForActive}
                        aria-label={isActive && isPlaying ? 'Pause video' : 'Play video'}
                        className="hf-press min-w-[44px] min-h-[44px] rounded-full bg-black/55 backdrop-blur-md border border-white/15 text-white flex items-center justify-center"
                      >
                        {isActive && isPlaying ? (
                          <Pause className="w-4 h-4" />
                        ) : (
                          <Play className="w-4 h-4 ml-0.5" />
                        )}
                      </button>

                      <span className="px-2.5 py-1 rounded-lg bg-black/50 backdrop-blur-md border border-white/15 text-[11px] font-mono tabular-nums text-white/90">
                        {formatVideoTime(progress.current)} / {formatVideoTime(durationSafe)}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => setMuted((m) => !m)}
                      aria-label={muted ? 'Unmute video' : 'Mute video'}
                      className="hf-press pointer-events-auto min-w-[44px] min-h-[44px] rounded-full bg-black/55 backdrop-blur-md border border-white/15 text-white flex items-center justify-center"
                    >
                      {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* Buffering Spinner */}
                  {isActive && isBuffering && !hasVideoError && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <div className="w-12 h-12 rounded-full bg-black/65 backdrop-blur-md border border-white/20 flex items-center justify-center text-white">
                        <Loader2 className="w-5 h-5 animate-spin text-accent" />
                      </div>
                    </div>
                  )}

                  {/* Play/Pause Tap Feedback */}
                  {isActive && tapFeedback && !hasVideoError && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <div className="w-16 h-16 rounded-full bg-black/65 backdrop-blur-md border border-white/20 flex items-center justify-center text-white animate-pulse">
                        {tapFeedback === 'play' ? (
                          <Play className="w-7 h-7 ml-0.5" />
                        ) : (
                          <Pause className="w-7 h-7" />
                        )}
                      </div>
                    </div>
                  )}

                  {/* Error State + Retry */}
                  {hasVideoError && (
                    <div className="absolute inset-0 bg-black/85 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center gap-3 z-10">
                      <AlertCircle className="w-9 h-9 text-red-400" />
                      <p className="text-sm font-semibold text-white">
                        Video could not play right now
                      </p>
                      <p className="text-xs text-white/70 max-w-xs">
                        Check your internet connection or tap Retry to reload this clip.
                      </p>
                      <button
                        type="button"
                        onClick={() => handleRetryVideo(video.id)}
                        className="gold-gradient-btn min-h-[44px] px-5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-2"
                      >
                        <RefreshCw className="w-4 h-4" />
                        <span>Retry Playback</span>
                      </button>
                    </div>
                  )}

                  {/* Bottom Contrast Scrim + Creator Details + Right Interaction Rail */}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/55 to-transparent px-4 pt-20 pb-5 flex flex-col gap-3">
                    <div className="flex items-end justify-between gap-3">
                      {/* Left: Creator, Follow, Caption, Hashtags */}
                      <div className="min-w-0 flex-1 space-y-2.5">
                        <div className="flex items-center gap-2.5">
                          <button
                            type="button"
                            onClick={() => onOpenProfile(video.authorId)}
                            className="flex items-center gap-2.5 min-w-0 text-left group"
                          >
                            <Avatar
                              src={video.authorAvatarUrl}
                              name={video.authorName}
                              size="sm"
                            />
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-white group-hover:text-accent truncate">
                                {video.authorName}
                              </p>
                              <p className="text-[11px] text-white/75 truncate">
                                @{video.authorUsername} · {formatRelativeTime(video.createdAt)}
                              </p>
                            </div>
                          </button>

                          {!isOwn && (
                            <button
                              type="button"
                              disabled={followBusy}
                              onClick={() => void handleToggleFollow(video.authorId)}
                              className={`min-h-[34px] px-3 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 transition-colors ${
                                isFollowingAuthor
                                  ? 'bg-white/15 border border-white/25 text-white hover:bg-white/25'
                                  : 'bg-accent text-accent-fg hover:brightness-110'
                              }`}
                            >
                              {isFollowingAuthor ? (
                                <>
                                  <UserCheck className="w-3.5 h-3.5" />
                                  <span>Following</span>
                                </>
                              ) : (
                                <>
                                  <UserPlus className="w-3.5 h-3.5" />
                                  <span>Follow</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>

                        {video.caption && (
                          <div>
                            <p
                              className={`text-xs sm:text-sm text-white/95 leading-relaxed ${
                                isCaptionExpanded ? '' : 'line-clamp-2'
                              }`}
                            >
                              {video.caption}
                            </p>
                            {video.caption.length > 90 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedCaptions((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(video.id)) next.delete(video.id);
                                    else next.add(video.id);
                                    return next;
                                  })
                                }
                                className="mt-0.5 text-[11px] font-semibold text-accent hover:underline"
                              >
                                {isCaptionExpanded ? 'Show less' : 'Read more'}
                              </button>
                            )}
                          </div>
                        )}

                        {video.hashtags && video.hashtags.length > 0 && (
                          <div className="flex flex-wrap gap-x-2 gap-y-1">
                            {video.hashtags.slice(0, 5).map((tag) => (
                              <button
                                key={tag}
                                type="button"
                                onClick={() => onSearchHashtag?.(tag)}
                                className="text-xs font-medium text-accent hover:underline"
                              >
                                #{tag}
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Reaction Breakdown Trigger when reactions exist */}
                        {reactionSummary.totalCount > 0 && (
                          <button
                            type="button"
                            onClick={() => setReactionDetailsPost(video)}
                            className="inline-flex items-center gap-1.5 text-[11px] text-white/85 hover:text-accent transition-colors"
                          >
                            <span className="inline-flex items-center -space-x-1">
                              {reactionSummary.items.map(({ meta }) => (
                                <span key={meta.type} aria-hidden="true" className="text-xs">
                                  {meta.emoji}
                                </span>
                              ))}
                            </span>
                            <span className="font-mono tabular-nums">
                              {formatCount(reactionSummary.totalCount)}{' '}
                              {reactionSummary.totalCount === 1 ? 'reaction' : 'reactions'}
                            </span>
                          </button>
                        )}
                      </div>

                      {/* Right Interaction Rail */}
                      <div className="flex flex-col items-center gap-3.5 shrink-0">
                        <ReactionControl
                          currentReaction={userReactions.get(video.id) || null}
                          isAuthenticated={Boolean(profile)}
                          onSelectReaction={(reaction) =>
                            void handleSelectReaction(video, reaction)
                          }
                          onRequireAuth={onRequireAuth}
                          variant="moment"
                          likesCount={video.likesCount}
                          align="right"
                        />

                        <button
                          type="button"
                          onClick={() => void openCommentsDrawer(video)}
                          className="hf-press flex flex-col items-center gap-1 min-w-[44px]"
                          aria-label={`Open comments (${video.commentsCount})`}
                        >
                          <div className="w-11 h-11 rounded-full bg-black/55 backdrop-blur-md border border-white/20 text-white flex items-center justify-center">
                            <MessageCircle className="w-5 h-5" />
                          </div>
                          <span className="text-[11px] font-mono tabular-nums text-white">
                            {formatCount(video.commentsCount)}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setSharePost(video)}
                          className="hf-press flex flex-col items-center gap-1 min-w-[44px]"
                          aria-label="Share short video"
                        >
                          <div className="w-11 h-11 rounded-full bg-black/55 backdrop-blur-md border border-white/20 text-white flex items-center justify-center">
                            <Share2 className="w-5 h-5" />
                          </div>
                          <span className="text-[11px] font-medium text-white">Share</span>
                        </button>
                      </div>
                    </div>

                    {/* Interactive Scrubber / Progress Bar */}
                    <div className="relative w-full flex items-center group">
                      <div className="w-full h-1.5 rounded-full bg-white/20 overflow-hidden">
                        <div
                          className="h-full bg-accent transition-[width] duration-75"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                      <input
                        type="range"
                        aria-label="Seek video playback"
                        min={0}
                        max={durationSafe}
                        step={0.1}
                        value={Math.min(durationSafe, progress.current)}
                        onChange={(e) => handleSeekVideo(video.id, Number(e.target.value))}
                        className="absolute inset-0 w-full h-4 -top-1 opacity-0 cursor-pointer"
                      />
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Pagination Footer Card inside feed if more videos are available */}
            {hasMore && (
              <div className="w-full py-6 px-4 bg-canvas-alt flex items-center justify-center border-t border-hairline">
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void loadMoreMoments()}
                  className="glass-btn min-h-[44px] px-5 py-2 rounded-xl text-xs font-semibold text-ink-2 inline-flex items-center gap-2 disabled:opacity-50"
                >
                  {loadingMore ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-accent" />
                      <span>Loading more shorts...</span>
                    </>
                  ) : (
                    <span>Load More Shorts</span>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Desktop Navigation & Queue Controls */}
          <aside className="hidden md:flex flex-col items-center gap-3 glass-card rounded-3xl p-3.5 border border-hairline shrink-0">
            <div className="text-center pb-1 border-b border-hairline w-full">
              <p className="text-[11px] font-semibold text-ink-muted">Clip</p>
              <p className="font-mono text-sm font-bold text-accent tabular-nums">
                {safeActiveIndex + 1} / {displayVideos.length}
              </p>
            </div>

            <button
              type="button"
              onClick={() => scrollToIndex(safeActiveIndex - 1)}
              disabled={safeActiveIndex === 0}
              aria-label="Previous short video"
              className="glass-btn min-w-[46px] min-h-[46px] rounded-2xl flex items-center justify-center text-ink-2 hover:text-accent disabled:opacity-30"
            >
              <ChevronUp className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => scrollToIndex(safeActiveIndex + 1)}
              disabled={safeActiveIndex >= displayVideos.length - 1}
              aria-label="Next short video"
              className="glass-btn min-w-[46px] min-h-[46px] rounded-2xl flex items-center justify-center text-ink-2 hover:text-accent disabled:opacity-30"
            >
              <ChevronDown className="w-5 h-5" />
            </button>

            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? 'Unmute playback' : 'Mute playback'}
              className="glass-btn min-w-[46px] min-h-[46px] rounded-2xl flex items-center justify-center text-ink-2 hover:text-accent"
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>

            <div className="pt-2 border-t border-hairline text-[10px] font-mono text-ink-subtle text-center space-y-1">
              <p>↑ / ↓ scroll</p>
              <p>Space play</p>
              <p>M mute</p>
            </div>
          </aside>
        </div>
      )}

      {/* Comments Drawer */}
      {commentsPost && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Short video comments"
          onClick={() => setCommentsPost(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md h-[72dvh] sm:max-h-[580px] glass-modal hf-modal-enter rounded-t-3xl sm:rounded-3xl border border-hairline-strong flex flex-col overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-hairline flex items-center justify-between bg-surface-2/80">
              <div>
                <h2 className="font-display text-base font-bold text-ink">
                  Comments ({formatCount(commentsPost.commentsCount)})
                </h2>
                <p className="text-[11px] text-ink-muted truncate max-w-[240px]">
                  @{commentsPost.authorUsername}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCommentsPost(null)}
                aria-label="Close comments"
                className="min-w-[40px] min-h-[40px] rounded-full glass-btn text-ink-muted hover:text-ink flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
              {commentsLoading ? (
                <div className="py-12 flex flex-col items-center justify-center gap-2 text-ink-muted">
                  <Loader2 className="w-5 h-5 animate-spin text-accent" />
                  <p className="text-xs">Loading comments...</p>
                </div>
              ) : comments.length === 0 ? (
                <p className="text-xs text-ink-muted text-center py-12">
                  No comments yet. Start the conversation on this clip!
                </p>
              ) : (
                comments.map((c) => {
                  const canDelete = profile?.uid === c.authorId;
                  return (
                    <div key={c.id} className="flex items-start justify-between gap-2.5">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <button
                          type="button"
                          onClick={() => {
                            setCommentsPost(null);
                            onOpenProfile(c.authorId);
                          }}
                          className="shrink-0"
                        >
                          <Avatar src={c.authorAvatarUrl} name={c.authorName} size="xs" />
                        </button>
                        <div className="min-w-0">
                          <p className="text-xs text-ink-2 leading-relaxed break-words">
                            <button
                              type="button"
                              onClick={() => {
                                setCommentsPost(null);
                                onOpenProfile(c.authorId);
                              }}
                              className="font-semibold text-ink hover:text-accent mr-1.5"
                            >
                              @{c.authorUsername}
                            </button>
                            {c.text}
                          </p>
                          <span className="text-[11px] text-ink-subtle">
                            {formatRelativeTime(c.createdAt)}
                          </span>
                        </div>
                      </div>
                      {canDelete && (
                        <button
                          type="button"
                          disabled={deletingCommentId === c.id}
                          onClick={() => void handleDeleteComment(c)}
                          aria-label="Delete comment"
                          className="p-1.5 rounded-lg text-ink-subtle hover:text-red-400 hover:bg-red-500/10 shrink-0 disabled:opacity-40"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <form
              onSubmit={handleSendComment}
              className="p-3.5 border-t border-hairline bg-surface-2/80 flex items-center gap-2"
            >
              <input
                type="text"
                maxLength={500}
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder={profile ? 'Add a comment...' : 'Sign in to comment...'}
                className="flex-1 min-h-[42px] rounded-xl bg-canvas-alt border border-hairline px-3.5 py-2 text-xs sm:text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-accent-strong"
              />
              <button
                type="submit"
                disabled={submittingComment || !commentText.trim()}
                aria-label="Post comment"
                className="gold-gradient-btn min-w-[44px] min-h-[42px] rounded-xl flex items-center justify-center disabled:opacity-40"
              >
                {submittingComment ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Reaction Breakdown Modal */}
      {reactionDetailsPost && (
        <ReactionDetailsModal
          open={Boolean(reactionDetailsPost)}
          post={reactionDetailsPost}
          currentUserReaction={userReactions.get(reactionDetailsPost.id) || null}
          onClose={() => setReactionDetailsPost(null)}
          onOpenProfile={(uid) => {
            setReactionDetailsPost(null);
            onOpenProfile(uid);
          }}
        />
      )}

      {/* Share Short Video Modal */}
      {sharePost && (
        <SharePostModal
          open={Boolean(sharePost)}
          post={sharePost}
          onClose={() => setSharePost(null)}
        />
      )}

      {/* In-Section Short Video Upload Modal */}
      <ShortVideoUploadModal
        open={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        onPublished={handleShortPublished}
        onOpenFullStudio={onNavigateCreate}
      />
    </div>
  );
}
