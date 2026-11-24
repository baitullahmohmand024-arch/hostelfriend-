import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  deletePost,
  fetchPostById,
  getUserPostReactions,
  getUserSavedPostIds,
  reactToPost,
  toggleSavePost,
} from '../services/postService';
import { Post, ReactionType } from '../types';
import { computeNextReactionState } from '../utils/reactions';
import { formatUserFriendlyError } from '../lib/firestoreError';
import { useModalBackHandler } from '../lib/backNavigation';
import { PostCard } from './PostCard';

interface PostDetailModalProps {
  postId: string | null;
  highlightCommentId?: string;
  openCommentsByDefault?: boolean;
  onClose: () => void;
  onOpenProfile: (userId: string) => void;
  onSearchHashtag: (tag: string) => void;
  onRequireAuth: () => void;
}

export function PostDetailModal({
  postId,
  highlightCommentId,
  openCommentsByDefault = true,
  onClose,
  onOpenProfile,
  onSearchHashtag,
  onRequireAuth,
}: PostDetailModalProps) {
  const { profile, isAdmin } = useAuth();
  const { showToast } = useToast();
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [userReaction, setUserReaction] = useState<ReactionType | null>(null);
  const [isSaved, setIsSaved] = useState(false);

  useModalBackHandler(Boolean(postId), onClose);

  useEffect(() => {
    if (!postId) {
      setPost(null);
      setNotFound(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setNotFound(false);

    Promise.all([
      fetchPostById(postId),
      profile ? getUserPostReactions(profile.uid) : Promise.resolve(new Map<string, ReactionType>()),
      profile ? getUserSavedPostIds(profile.uid) : Promise.resolve(new Set<string>()),
    ])
      .then(([loaded, reactions, saves]) => {
        if (cancelled) return;
        if (!loaded) {
          setPost(null);
          setNotFound(true);
        } else {
          setPost(loaded);
          setUserReaction(reactions.get(loaded.id) || null);
          setIsSaved(saves.has(loaded.id));
        }
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [postId, profile]);

  if (!postId) return null;

  const handleSelectReaction = async (target: Post, nextReactionChoice: ReactionType | null) => {
    if (!profile) {
      onRequireAuth();
      return;
    }
    const prevReaction = userReaction;
    const prevSnapshot = { likesCount: target.likesCount, reactionCounts: target.reactionCounts };
    const optimistic = computeNextReactionState(target, prevReaction, nextReactionChoice);

    setUserReaction(optimistic.nextReaction);
    setPost((p) =>
      p
        ? {
            ...p,
            likesCount: optimistic.nextLikesCount,
            reactionCounts: optimistic.nextReactionCounts,
          }
        : p
    );

    try {
      const committed = await reactToPost(target, profile, optimistic.nextReaction);
      setUserReaction(committed.nextReaction);
      setPost((p) =>
        p
          ? {
              ...p,
              likesCount: committed.nextLikesCount,
              reactionCounts: committed.nextReactionCounts,
            }
          : p
      );
      if (committed.legacyNotice) {
        showToast({
          type: 'info',
          title: 'Reaction saved as Like',
          description: committed.legacyNotice,
        });
      }
    } catch (err) {
      setUserReaction(prevReaction);
      setPost((p) =>
        p
          ? {
              ...p,
              likesCount: prevSnapshot.likesCount,
              reactionCounts: prevSnapshot.reactionCounts,
            }
          : p
      );
      showToast({
        type: 'error',
        title: 'Could not update reaction',
        description: formatUserFriendlyError(err, 'Please try again.'),
      });
    }
  };

  const handleToggleSave = async (target: Post) => {
    if (!profile) {
      onRequireAuth();
      return;
    }
    const prevSaved = isSaved;
    setIsSaved(!prevSaved);
    try {
      await toggleSavePost(target.id, profile.uid, prevSaved);
    } catch {
      setIsSaved(prevSaved);
      showToast({ type: 'error', title: 'Could not update bookmark' });
    }
  };

  const handleDeletePost = async (target: Post) => {
    try {
      await deletePost(target, profile?.uid === target.authorId);
      showToast({ type: 'success', title: 'Post deleted' });
      onClose();
    } catch {
      showToast({ type: 'error', title: 'Could not delete post' });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Post details"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl my-4 sm:my-8 space-y-3 hf-modal-enter"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-accent">
            Post Activity
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close post"
            className="w-9 h-9 rounded-full glass-btn text-ink hover:text-accent flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="glass-card rounded-2xl p-12 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-6 h-6 text-accent animate-spin" />
            <p className="text-xs text-ink-muted">Loading post...</p>
          </div>
        ) : notFound || !post ? (
          <div className="glass-card rounded-2xl p-10 text-center">
            <p className="font-display text-base font-semibold text-ink">
              Post unavailable
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              This post may have been removed by its author or moderation.
            </p>
          </div>
        ) : (
          <PostCard
            variant="feed"
            post={post}
            currentUser={profile}
            isAdmin={isAdmin}
            userReaction={userReaction}
            isSaved={isSaved}
            initialCommentsOpen={openCommentsByDefault}
            highlightCommentId={highlightCommentId}
            onSelectReaction={handleSelectReaction}
            onToggleSave={handleToggleSave}
            onDeletePost={handleDeletePost}
            onOpenProfile={(uid) => {
              onClose();
              onOpenProfile(uid);
            }}
            onSearchHashtag={(tag) => {
              onClose();
              onSearchHashtag(tag);
            }}
            onRequireAuth={() => {
              onClose();
              onRequireAuth();
            }}
          />
        )}
      </div>
    </div>
  );
}
