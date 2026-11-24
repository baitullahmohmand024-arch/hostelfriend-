import React, { useEffect, useRef, useState } from 'react';
import {
  Bookmark,
  CornerDownRight,
  Flag,
  ImageOff,
  MessageCircle,
  MoreHorizontal,
  Send,
  Share2,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { CommentItem, Post, ReactionType, UserProfile } from '../types';
import { formatCount, formatRelativeTime } from '../utils/formatters';
import { addComment, deleteComment, fetchComments } from '../services/postService';
import { parseLegacyPollPost } from '../services/pollService';
import {
  cancelOrRemoveFriendRequest,
  getFriendRequestId,
  respondToFriendRequest,
  sendFriendRequest,
} from '../services/notificationService';
import { followUser, unfollowUser } from '../services/userService';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Avatar } from './Avatar';
import { ConfirmDialog } from './ConfirmDialog';
import { ReactionControl, ReactionSummaryTrigger } from './ReactionControl';
import { ReactionDetailsModal } from './ReactionDetailsModal';
import { ReportModal } from './ReportModal';
import { SharePostModal } from './SharePostModal';
import { formatUserFriendlyError } from '../lib/firestoreError';
import { playSound } from '../utils/soundVfx';

interface PostCardProps {
  post: Post;
  currentUser: UserProfile | null;
  isAdmin?: boolean;
  isLiked?: boolean;
  userReaction?: ReactionType | null;
  isSaved: boolean;
  onToggleLike?: (post: Post) => Promise<void>;
  onSelectReaction?: (post: Post, reaction: ReactionType | null) => Promise<void>;
  onToggleSave: (post: Post) => Promise<void>;
  onDeletePost: (post: Post) => Promise<void>;
  onOpenProfile: (userId: string) => void;
  onSearchHashtag: (tag: string) => void;
  onRequireAuth?: () => void;
  variant?: 'default' | 'feed';
  initialCommentsOpen?: boolean;
  highlightCommentId?: string;
}

export function PostCard({
  post,
  currentUser,
  isAdmin = false,
  isLiked = false,
  userReaction,
  isSaved,
  onToggleLike,
  onSelectReaction,
  onToggleSave,
  onDeletePost,
  onOpenProfile,
  onSearchHashtag,
  onRequireAuth,
  variant = 'default',
  initialCommentsOpen = false,
  highlightCommentId,
}: PostCardProps) {
  const activeReaction: ReactionType | null =
    userReaction !== undefined ? userReaction : isLiked ? 'like' : null;
  const handleReactionSelection = (reaction: ReactionType | null) => {
    if (onSelectReaction) {
      void onSelectReaction(post, reaction);
    } else if (onToggleLike) {
      void onToggleLike(post);
    }
  };
  const { showToast } = useToast();
  const { followingIds, friendRequests } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [followActionBusy, setFollowActionBusy] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(initialCommentsOpen);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [replyingTo, setReplyingTo] = useState<{
    parentCommentId: string;
    replyToUserId: string;
    replyToUsername: string;
  } | null>(null);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [localCommentsCount, setLocalCommentsCount] = useState(post.commentsCount);
  const [mediaError, setMediaError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [muted, setMuted] = useState(true);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [reactionsModalOpen, setReactionsModalOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const commentInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMediaError(false);
    setImageLoaded(false);
  }, [post.id, post.mediaUrl]);

  useEffect(() => {
    setLocalCommentsCount(post.commentsCount);
  }, [post.commentsCount]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [menuOpen]);

  const loadComments = async () => {
    setCommentsLoading(true);
    try {
      const items = await fetchComments(post.id);
      setComments(items);
    } catch {
      showToast({ type: 'error', title: 'Could not load comments' });
    } finally {
      setCommentsLoading(false);
    }
  };

  useEffect(() => {
    if (initialCommentsOpen) {
      setCommentsOpen(true);
      void loadComments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCommentsOpen, post.id]);

  const handleToggleComments = () => {
    const next = !commentsOpen;
    setCommentsOpen(next);
    if (next) {
      void loadComments();
    } else {
      setReplyingTo(null);
    }
  };

  const handleStartReply = (comment: CommentItem) => {
    if (!currentUser) {
      onRequireAuth?.();
      return;
    }
    setReplyingTo({
      parentCommentId: comment.parentCommentId || comment.id,
      replyToUserId: comment.authorId,
      replyToUsername: comment.authorUsername,
    });
    setTimeout(() => commentInputRef.current?.focus(), 40);
  };

  const handleCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      onRequireAuth?.();
      return;
    }
    if (!commentText.trim()) return;
    setSubmittingComment(true);
    try {
      const created = await addComment(post, currentUser, commentText, replyingTo || undefined);
      setComments((prev) => [...prev, created]);
      setLocalCommentsCount((c) => c + 1);
      setCommentText('');
      setReplyingTo(null);
      playSound('comment');
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Failed to post comment',
        description: formatUserFriendlyError(err),
      });
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleDeleteComment = async (comment: CommentItem) => {
    try {
      await deleteComment(comment);
      setComments((prev) => prev.filter((c) => c.id !== comment.id));
      setLocalCommentsCount((c) => Math.max(0, c - 1));
    } catch {
      showToast({ type: 'error', title: 'Could not delete comment' });
    }
  };

  const handleShare = () => {
    playSound('ui-tap');
    setShareOpen(true);
  };

  const handleConfirmDelete = async () => {
    setDeleting(true);
    try {
      await onDeletePost(post);
      setConfirmDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  const canDelete = Boolean(currentUser && (currentUser.uid === post.authorId || isAdmin));
  const showAuthorFollowControl = !currentUser || currentUser.uid !== post.authorId;
  const isFollowingAuthor = Boolean(currentUser && followingIds.has(post.authorId));
  const relationRequest = currentUser
    ? friendRequests.find((r) => r.id === getFriendRequestId(currentUser.uid, post.authorId))
    : undefined;

  const followStatus:
    | 'follow'
    | 'requested'
    | 'incoming'
    | 'friends'
    | 'following' = !currentUser
    ? 'follow'
    : relationRequest?.status === 'accepted'
    ? 'friends'
    : relationRequest?.status === 'pending'
    ? relationRequest.senderId === currentUser.uid
      ? 'requested'
      : 'incoming'
    : isFollowingAuthor
    ? 'following'
    : 'follow';

  const followButtonLabel =
    followStatus === 'friends'
      ? 'Friends'
      : followStatus === 'requested'
      ? 'Requested'
      : followStatus === 'incoming'
      ? 'Add Friend'
      : followStatus === 'following'
      ? 'Following'
      : 'Follow';

  const handleAuthorFollowClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentUser) {
      onRequireAuth?.();
      return;
    }
    if (currentUser.uid === post.authorId || followActionBusy) return;
    if (followStatus === 'friends') {
      onOpenProfile(post.authorId);
      return;
    }

    setFollowActionBusy(true);
    try {
      if (followStatus === 'incoming' && relationRequest) {
        await respondToFriendRequest(relationRequest, currentUser, 'accepted');
        if (!isFollowingAuthor) {
          await followUser(currentUser, post.authorId, { skipNotification: true }).catch(() => {});
        }
        playSound('follow');
        showToast({ type: 'success', title: `You and ${post.authorName} are now friends` });
      } else if (followStatus === 'requested' && relationRequest) {
        await cancelOrRemoveFriendRequest(relationRequest.id);
        if (isFollowingAuthor) {
          await unfollowUser(currentUser.uid, post.authorId).catch(() => {});
        }
        playSound('unlike');
        showToast({ type: 'info', title: 'Follow request cancelled' });
      } else if (followStatus === 'following') {
        await unfollowUser(currentUser.uid, post.authorId);
        playSound('unlike');
        showToast({ type: 'info', title: `Unfollowed ${post.authorName}` });
      } else {
        if (!isFollowingAuthor) {
          await followUser(currentUser, post.authorId, { skipNotification: true });
        }
        await sendFriendRequest(currentUser, {
          uid: post.authorId,
          username: post.authorUsername,
          fullName: post.authorName,
          avatarUrl: post.authorAvatarUrl,
        });
        playSound('follow');
        showToast({ type: 'success', title: `Follow request sent to ${post.authorName}` });
      }
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Could not update follow request',
        description: formatUserFriendlyError(err),
      });
    } finally {
      setFollowActionBusy(false);
    }
  };

  const aspectClass =
    post.aspectRatio === 'square'
      ? 'aspect-square'
      : post.aspectRatio === 'portrait'
      ? 'aspect-[3/4]'
      : post.aspectRatio === 'vertical'
      ? 'aspect-[9/16] max-h-[560px] mx-auto'
      : 'aspect-[4/3]';

  if (variant === 'feed') {
    const parsedLegacyPoll = parseLegacyPollPost(post);
    const displayCaption = parsedLegacyPoll
      ? `Poll: ${parsedLegacyPoll.question}\n${parsedLegacyPoll.options
          .map((opt, idx) => `${idx + 1}. ${opt}`)
          .join('\n')}`
      : post.caption;
    const isLongCaption = displayCaption.length > 280 || displayCaption.split('\n').length > 5;
    const shownCaption =
      isLongCaption && !captionExpanded
        ? `${displayCaption.slice(0, 260).trimEnd()}...`
        : displayCaption;

    return (
      <article className="glass-card md:hover:border-accent/35 rounded-2xl overflow-hidden">
        {/* Post Author Header */}
        <div className="px-4 sm:px-5 pt-4 pb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => onOpenProfile(post.authorId)}
              aria-label={`View ${post.authorName}'s profile`}
              className="rounded-full p-[1.5px] bg-gradient-to-tr from-accent-deep/75 via-accent/80 to-accent-soft/65 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Avatar src={post.authorAvatarUrl} name={post.authorName} size="md" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <button
                  type="button"
                  onClick={() => onOpenProfile(post.authorId)}
                  className="text-[15px] font-display font-semibold text-ink hover:text-accent transition-colors truncate"
                >
                  {post.authorName}
                </button>
                {showAuthorFollowControl && (
                  <>
                    <span className="text-ink-muted/60 text-xs shrink-0" aria-hidden="true">
                      ·
                    </span>
                    <button
                      type="button"
                      disabled={followActionBusy}
                      onClick={handleAuthorFollowClick}
                      className={`text-xs font-semibold shrink-0 whitespace-nowrap transition-colors disabled:opacity-50 ${
                        followStatus === 'follow' || followStatus === 'incoming'
                          ? 'text-accent hover:text-accent-soft'
                          : 'text-ink-muted hover:text-ink'
                      }`}
                    >
                      {followActionBusy ? '...' : followButtonLabel}
                    </button>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-ink-muted truncate">
                <span className="truncate">@{post.authorUsername}</span>
                <span aria-hidden="true">·</span>
                <span className="shrink-0">{formatRelativeTime(post.createdAt)}</span>
              </div>
            </div>
          </div>

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Post options"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-ink-muted hover:text-accent hover:bg-surface-hover transition-colors"
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-1.5 w-48 glass-popover hf-popover-enter rounded-xl py-1.5 z-20">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    handleShare();
                  }}
                  className="w-full min-h-[40px] px-3.5 py-2 text-left text-xs font-medium text-ink hover:bg-hover-tint flex items-center gap-2.5"
                >
                  <Share2 className="w-3.5 h-3.5 text-accent" />
                  Share Post
                </button>

                {currentUser && currentUser.uid !== post.authorId && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setReportOpen(true);
                    }}
                    className="w-full min-h-[40px] px-3.5 py-2 text-left text-xs font-medium text-ink hover:bg-hover-tint flex items-center gap-2.5"
                  >
                    <Flag className="w-3.5 h-3.5 text-accent" />
                    Report Post
                  </button>
                )}

                {canDelete && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmDeleteOpen(true);
                    }}
                    className="w-full min-h-[40px] px-3.5 py-2 text-left text-xs font-medium text-rose-400 hover:bg-rose-500/10 flex items-center gap-2.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete Post
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Caption & Hashtags */}
        {(post.caption || post.hashtags.length > 0) && (
          <div className="px-4 sm:px-5 pb-3 space-y-2">
            {post.caption && (
              <div
                className={
                  post.mediaType === 'text'
                    ? 'rounded-xl bg-canvas-alt border border-hairline px-4 py-4'
                    : ''
                }
              >
                <p
                  className={`${
                    post.mediaType === 'text'
                      ? 'text-[16px] sm:text-[17px]'
                      : 'text-[14.5px] sm:text-[15px]'
                  } text-ink-2 leading-relaxed whitespace-pre-wrap break-words`}
                >
                  {shownCaption}
                </p>
                {isLongCaption && (
                  <button
                    type="button"
                    onClick={() => setCaptionExpanded((e) => !e)}
                    className="mt-1.5 text-xs font-semibold text-accent hover:text-accent-soft"
                  >
                    {captionExpanded ? 'Show less' : 'Read more'}
                  </button>
                )}
              </div>
            )}
            {post.hashtags.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs sm:text-[13px] font-medium text-accent">
                {post.hashtags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => onSearchHashtag(tag)}
                    className="hover:text-accent-soft hover:underline transition-colors"
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Attached Image or Video */}
        {post.mediaType !== 'text' && (
          <div className="px-4 sm:px-5 pb-3">
            <div className="relative rounded-xl overflow-hidden bg-canvas border border-hairline">
              {mediaError ? (
                <div
                  className={`${aspectClass} max-h-[460px] w-full bg-gradient-to-br from-surface-2 via-canvas-alt to-canvas flex flex-col items-center justify-center gap-2 text-ink-muted px-6 text-center`}
                >
                  <ImageOff className="w-7 h-7 opacity-65 text-accent" />
                  <p className="text-xs font-medium text-ink-2">Media unavailable</p>
                </div>
              ) : post.mediaType === 'video' ? (
                <div className={`relative ${aspectClass} max-h-[540px] w-full bg-black flex items-center justify-center`}>
                  <video
                    src={post.mediaUrl}
                    poster={post.thumbnailUrl || undefined}
                    controls
                    playsInline
                    muted={muted}
                    preload={post.thumbnailUrl ? 'none' : 'metadata'}
                    onError={() => setMediaError(true)}
                    className="w-full h-full object-contain"
                  />
                  <button
                    type="button"
                    onClick={() => setMuted((m) => !m)}
                    aria-label={muted ? 'Unmute video' : 'Mute video'}
                    className="min-w-[40px] min-h-[40px] flex items-center justify-center absolute top-3 right-3 rounded-full bg-black/70 backdrop-blur-md text-accent border border-accent/35 hover:bg-black/90 transition-colors"
                  >
                    {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </button>
                </div>
              ) : (
                <div className={`${aspectClass} max-h-[540px] w-full overflow-hidden bg-canvas-alt`}>
                  <img
                    src={post.mediaUrl}
                    alt={post.caption || `Post by ${post.authorName}`}
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onLoad={() => setImageLoaded(true)}
                    onError={() => setMediaError(true)}
                    className={`w-full h-full object-cover transition-opacity duration-200 ${
                      imageLoaded ? 'opacity-100' : 'opacity-0'
                    }`}
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Reaction Summary + Actions Bar */}
        <div className="px-4 sm:px-5 pb-3">
          <div className="pb-2.5 border-b border-hairline flex items-center justify-between gap-3 text-xs text-ink-muted">
            <ReactionSummaryTrigger
              post={post}
              onOpenDetails={() => setReactionsModalOpen(true)}
            />
            <button
              type="button"
              onClick={handleToggleComments}
              className="hover:text-accent transition-colors tabular-nums shrink-0"
            >
              {formatCount(localCommentsCount)} {localCommentsCount === 1 ? 'comment' : 'comments'}
            </button>
          </div>

          <div className="pt-1.5 flex items-center justify-between gap-1">
            <ReactionControl
              currentReaction={activeReaction}
              isAuthenticated={Boolean(currentUser)}
              onSelectReaction={handleReactionSelection}
              onRequireAuth={onRequireAuth}
              variant="feed"
            />

            <button
              type="button"
              onClick={handleToggleComments}
              aria-expanded={commentsOpen}
              className={`flex-1 min-h-[44px] px-2 rounded-xl flex items-center justify-center gap-1.5 text-xs sm:text-sm font-semibold hf-press whitespace-nowrap ${
                commentsOpen
                  ? 'text-accent bg-surface-hover'
                  : 'text-ink-2 hover:text-accent hover:bg-surface-hover'
              }`}
              aria-label="Toggle comments"
            >
              <MessageCircle className="w-4 h-4 text-accent" />
              <span>Comment</span>
            </button>

            <button
              type="button"
              onClick={handleShare}
              className="flex-1 min-h-[44px] px-2 rounded-xl flex items-center justify-center gap-1.5 text-xs sm:text-sm font-semibold text-ink-2 hover:text-accent hover:bg-surface-hover hf-press whitespace-nowrap"
              aria-label="Share post"
            >
              <Share2 className="w-4 h-4 text-accent" />
              <span>Share</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (currentUser) {
                  playSound(isSaved ? 'unlike' : 'save');
                  void onToggleSave(post);
                } else {
                  onRequireAuth?.();
                }
              }}
              aria-pressed={isSaved}
              className={`min-h-[44px] min-w-[44px] px-2.5 rounded-xl flex items-center justify-center hf-press shrink-0 ${
                isSaved
                  ? 'text-accent bg-accent/12'
                  : 'text-ink-muted hover:text-accent hover:bg-surface-hover'
              }`}
              aria-label={isSaved ? 'Remove from saved' : 'Save post'}
            >
              <Bookmark className={`w-4 h-4 text-accent ${isSaved ? 'fill-accent' : ''}`} />
            </button>
          </div>

          {/* Comments Drawer */}
          {commentsOpen && (
            <div className="mt-3 pt-3.5 border-t border-hairline space-y-3">
              {commentsLoading ? (
                <p className="text-xs text-ink-muted">Loading comments...</p>
              ) : comments.length === 0 ? (
                <p className="text-xs text-ink-muted">No comments yet. Start the conversation.</p>
              ) : (
                <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                  {comments.map((comment) => {
                    const canRemoveComment = Boolean(
                      currentUser &&
                        (currentUser.uid === comment.authorId ||
                          currentUser.uid === post.authorId ||
                          isAdmin)
                    );
                    const isHighlighted = highlightCommentId === comment.id;
                    const isReply = Boolean(comment.parentCommentId);
                    return (
                      <div
                        key={comment.id}
                        className={`flex items-start justify-between gap-3 rounded-xl px-2.5 py-2 transition-colors ${
                          isReply ? 'ml-6 bg-hover-tint/50' : ''
                        } ${isHighlighted ? 'bg-accent/12 ring-1 ring-accent/45' : ''}`}
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <Avatar
                            src={comment.authorAvatarUrl}
                            name={comment.authorName}
                            size="xs"
                          />
                          <div className="min-w-0">
                            <p className="text-xs text-ink leading-relaxed break-words">
                              <button
                                type="button"
                                onClick={() => onOpenProfile(comment.authorId)}
                                className="font-semibold hover:text-accent mr-1.5"
                              >
                                @{comment.authorUsername}
                              </button>
                              {comment.replyToUsername && (
                                <span className="text-accent/90 mr-1.5 font-medium">
                                  @{comment.replyToUsername}
                                </span>
                              )}
                              {comment.text}
                            </p>
                            <div className="mt-0.5 flex items-center gap-3 text-[11px] text-ink-muted">
                              <span>{formatRelativeTime(comment.createdAt)}</span>
                              {currentUser && (
                                <button
                                  type="button"
                                  onClick={() => handleStartReply(comment)}
                                  className="inline-flex items-center gap-1 hover:text-accent font-medium transition-colors"
                                >
                                  <CornerDownRight className="w-3 h-3" />
                                  <span>Reply</span>
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                        {canRemoveComment && (
                          <button
                            type="button"
                            onClick={() => handleDeleteComment(comment)}
                            aria-label="Delete comment"
                            className="min-w-[34px] min-h-[34px] flex items-center justify-center text-ink-muted hover:text-rose-400 rounded-lg transition-colors shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {replyingTo && (
                <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/25 text-xs">
                  <span className="text-accent truncate">
                    Replying to <strong>@{replyingTo.replyToUsername}</strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => setReplyingTo(null)}
                    aria-label="Cancel reply"
                    className="text-ink-muted hover:text-ink"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <form onSubmit={handleCommentSubmit} className="flex items-center gap-2 pt-1">
                <input
                  ref={commentInputRef}
                  type="text"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  maxLength={500}
                  placeholder={
                    replyingTo
                      ? `Reply to @${replyingTo.replyToUsername}...`
                      : currentUser
                      ? 'Add a comment or @mention...'
                      : 'Sign in to comment'
                  }
                  className="flex-1 min-h-[42px] rounded-xl bg-canvas border border-hairline px-3.5 py-2 text-sm text-ink placeholder:text-ink-muted/70 focus:outline-none focus:border-accent"
                />
                <button
                  type="submit"
                  disabled={submittingComment || !commentText.trim()}
                  aria-label="Send comment"
                  className="min-h-[42px] min-w-[42px] px-3 rounded-xl gold-gradient-btn flex items-center justify-center disabled:opacity-40 transition-opacity"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          )}
        </div>

        <ConfirmDialog
          open={confirmDeleteOpen}
          title="Delete this post?"
          description="This action permanently removes the post and its engagement from Hostel Friend."
          confirmLabel="Delete Post"
          destructive
          loading={deleting}
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmDeleteOpen(false)}
        />

        {currentUser && (
          <ReportModal
            open={reportOpen}
            reporterId={currentUser.uid}
            targetType="post"
            targetId={post.id}
            targetAuthorId={post.authorId}
            targetLabel={`Post by @${post.authorUsername}`}
            onClose={() => setReportOpen(false)}
          />
        )}

        <SharePostModal
          open={shareOpen}
          post={post}
          onClose={() => setShareOpen(false)}
        />

        <ReactionDetailsModal
          open={reactionsModalOpen}
          post={post}
          currentUserReaction={activeReaction}
          onClose={() => setReactionsModalOpen(false)}
          onOpenProfile={onOpenProfile}
        />
      </article>
    );
  }

  return (
    <article className="glass-card md:hover:border-accent/35 rounded-2xl">
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onOpenProfile(post.authorId)}
            aria-label={`View ${post.authorName}'s profile`}
            className="shrink-0"
          >
            <Avatar src={post.authorAvatarUrl} name={post.authorName} size="md" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <button
                type="button"
                onClick={() => onOpenProfile(post.authorId)}
                className="text-sm font-semibold text-ink-2 hover:text-accent-strong transition-colors truncate"
              >
                {post.authorName}
              </button>
              {showAuthorFollowControl && (
                <>
                  <span className="text-ink-muted/60 text-xs shrink-0" aria-hidden="true">
                    ·
                  </span>
                  <button
                    type="button"
                    disabled={followActionBusy}
                    onClick={handleAuthorFollowClick}
                    className={`text-xs font-semibold shrink-0 whitespace-nowrap transition-colors disabled:opacity-50 ${
                      followStatus === 'follow' || followStatus === 'incoming'
                        ? 'text-accent-strong hover:text-accent'
                        : 'text-ink-muted hover:text-ink-2'
                    }`}
                  >
                    {followActionBusy ? '...' : followButtonLabel}
                  </button>
                </>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-ink-muted truncate">
              <span className="truncate">@{post.authorUsername}</span>
              <span aria-hidden="true">·</span>
              <span className="shrink-0">{formatRelativeTime(post.createdAt)}</span>
            </div>
          </div>
        </div>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Post options"
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-ink-muted hover:text-ink-2 hover:bg-hover-tint transition-colors"
          >
            <MoreHorizontal className="w-5 h-5" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 mt-1.5 w-48 glass-popover hf-popover-enter rounded-xl py-1.5 z-20">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  handleShare();
                }}
                className="w-full px-3.5 py-2 text-left text-xs font-medium text-ink-2 hover:bg-hover-tint flex items-center gap-2.5"
              >
                <Share2 className="w-3.5 h-3.5 text-ink-muted" />
                Share Post
              </button>

              {currentUser && currentUser.uid !== post.authorId && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setReportOpen(true);
                  }}
                  className="w-full px-3.5 py-2 text-left text-xs font-medium text-ink-2 hover:bg-hover-tint flex items-center gap-2.5"
                >
                  <Flag className="w-3.5 h-3.5 text-accent-strong" />
                  Report Post
                </button>
              )}

              {canDelete && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setConfirmDeleteOpen(true);
                  }}
                  className="w-full px-3.5 py-2 text-left text-xs font-medium text-rose-400 hover:bg-rose-500/10 flex items-center gap-2.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Post
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Media Frame or Text-Only Editorial Surface */}
      {post.mediaType === 'text' ? (
        <div className="px-5 py-6 bg-canvas-alt/70 border-y border-hairline">
          <p className="text-[17px] sm:text-[18px] text-ink-2 leading-relaxed whitespace-pre-wrap break-words font-normal">
            {post.caption}
          </p>
        </div>
      ) : (
        <div className="relative bg-canvas-alt border-y border-hairline">
          {mediaError ? (
            <div className={`${aspectClass} w-full flex flex-col items-center justify-center gap-2 text-ink-subtle px-6 text-center`}>
              <ImageOff className="w-8 h-8 opacity-60" />
              <p className="text-xs">Media unavailable</p>
            </div>
          ) : post.mediaType === 'video' ? (
            <div className={`relative ${aspectClass} w-full bg-black flex items-center justify-center`}>
              <video
                src={post.mediaUrl}
                poster={post.thumbnailUrl || undefined}
                controls
                playsInline
                muted={muted}
                preload={post.thumbnailUrl ? 'none' : 'metadata'}
                onError={() => setMediaError(true)}
                className="w-full h-full object-contain"
              />
              <button
                type="button"
                onClick={() => setMuted((m) => !m)}
                aria-label={muted ? 'Unmute video' : 'Mute video'}
                className="absolute top-3 right-3 p-2 rounded-full bg-black/60 backdrop-blur-md text-white hover:bg-black/80 transition-colors"
              >
                {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
            </div>
          ) : (
            <div className={`${aspectClass} w-full overflow-hidden`}>
              <img
                src={post.mediaUrl}
                alt={post.caption || `Post by ${post.authorName}`}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={() => setMediaError(true)}
                className="w-full h-full object-cover"
              />
            </div>
          )}
        </div>
      )}

      {/* Actions Bar */}
      <div className="px-5 pt-3.5 pb-4">
        <div className="pb-2.5 mb-2 border-b border-hairline flex items-center justify-between gap-2 text-xs">
          <ReactionSummaryTrigger
            post={post}
            onOpenDetails={() => setReactionsModalOpen(true)}
            compact
          />
          <button
            type="button"
            onClick={handleToggleComments}
            className="text-ink-muted hover:text-accent transition-colors tabular-nums shrink-0"
          >
            {formatCount(localCommentsCount)} {localCommentsCount === 1 ? 'comment' : 'comments'}
          </button>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <ReactionControl
              currentReaction={activeReaction}
              isAuthenticated={Boolean(currentUser)}
              onSelectReaction={handleReactionSelection}
              onRequireAuth={onRequireAuth}
              variant="compact"
              likesCount={post.likesCount}
            />

            <button
              type="button"
              onClick={handleToggleComments}
              className={`min-h-[40px] px-2.5 rounded-xl flex items-center gap-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                commentsOpen
                  ? 'text-ink-2 bg-hover-tint'
                  : 'text-ink-muted hover:text-ink-2 hover:bg-hover-tint'
              }`}
              aria-label="Toggle comments"
            >
              <MessageCircle className="w-4 h-4" />
              <span className="tabular-nums text-xs">{formatCount(localCommentsCount)}</span>
            </button>

            <button
              type="button"
              onClick={handleShare}
              className="min-h-[40px] px-2.5 rounded-xl flex items-center gap-2 text-sm font-medium text-ink-muted hover:text-ink-2 hover:bg-hover-tint transition-colors whitespace-nowrap shrink-0"
              aria-label="Share post"
            >
              <Share2 className="w-4 h-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              if (currentUser) {
                playSound(isSaved ? 'unlike' : 'save');
                void onToggleSave(post);
              } else {
                onRequireAuth?.();
              }
            }}
            className={`min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl transition-colors ${
              isSaved
                ? 'text-accent-strong bg-accent-strong/10'
                : 'text-ink-muted hover:text-ink-2 hover:bg-hover-tint'
            }`}
            aria-label={isSaved ? 'Remove from saved' : 'Save post'}
          >
            <Bookmark className={`w-4 h-4 ${isSaved ? 'fill-accent-strong text-accent-strong' : ''}`} />
          </button>
        </div>

        {/* Caption & Unboxed Hashtags */}
        {((post.mediaType !== 'text' && post.caption) || post.hashtags.length > 0) && (
          <div className="mt-3 space-y-2">
            {post.mediaType !== 'text' && post.caption && (
              <p className="text-[15px] text-ink-2/95 leading-relaxed whitespace-pre-wrap break-words">
                <button
                  type="button"
                  onClick={() => onOpenProfile(post.authorId)}
                  className="font-semibold text-ink-2 hover:text-accent-strong mr-2 transition-colors"
                >
                  {post.authorUsername}
                </button>
                {post.caption}
              </p>
            )}
            {post.hashtags.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-accent-strong/90">
                {post.hashtags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => onSearchHashtag(tag)}
                    className="hover:text-accent-soft hover:underline transition-colors"
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Comments Drawer */}
        {commentsOpen && (
          <div className="mt-4 pt-4 border-t border-hairline space-y-3">
            {commentsLoading ? (
              <p className="text-xs text-ink-muted">Loading comments...</p>
            ) : comments.length === 0 ? (
              <p className="text-xs text-ink-subtle">No comments yet. Start the conversation.</p>
            ) : (
              <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                {comments.map((comment) => {
                  const canRemoveComment = Boolean(
                    currentUser &&
                      (currentUser.uid === comment.authorId ||
                        currentUser.uid === post.authorId ||
                        isAdmin)
                  );
                  const isHighlighted = highlightCommentId === comment.id;
                  const isReply = Boolean(comment.parentCommentId);
                  return (
                    <div
                      key={comment.id}
                      className={`flex items-start justify-between gap-3 rounded-xl px-2 py-1.5 transition-colors ${
                        isReply ? 'ml-5 border-l-2 border-accent-strong/25 pl-3' : ''
                      } ${isHighlighted ? 'bg-accent-strong/12 ring-1 ring-accent-strong/45' : ''}`}
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <Avatar
                          src={comment.authorAvatarUrl}
                          name={comment.authorName}
                          size="xs"
                        />
                        <div className="min-w-0">
                          <p className="text-xs text-ink-2 leading-relaxed break-words">
                            <button
                              type="button"
                              onClick={() => onOpenProfile(comment.authorId)}
                              className="font-semibold hover:text-accent-strong mr-1.5"
                            >
                              @{comment.authorUsername}
                            </button>
                            {comment.replyToUsername && (
                              <span className="text-accent-strong/90 mr-1.5 font-medium">
                                @{comment.replyToUsername}
                              </span>
                            )}
                            {comment.text}
                          </p>
                          <div className="mt-0.5 flex items-center gap-3 text-[11px] text-ink-subtle">
                            <span>{formatRelativeTime(comment.createdAt)}</span>
                            {currentUser && (
                              <button
                                type="button"
                                onClick={() => handleStartReply(comment)}
                                className="inline-flex items-center gap-1 hover:text-accent-strong font-medium transition-colors"
                              >
                                <CornerDownRight className="w-3 h-3" />
                                <span>Reply</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                      {canRemoveComment && (
                        <button
                          type="button"
                          onClick={() => handleDeleteComment(comment)}
                          aria-label="Delete comment"
                          className="text-ink-subtle hover:text-rose-400 p-1 rounded transition-colors shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {replyingTo && (
              <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-accent-strong/10 border border-accent-strong/25 text-xs">
                <span className="text-accent-strong truncate">
                  Replying to <strong>@{replyingTo.replyToUsername}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setReplyingTo(null)}
                  aria-label="Cancel reply"
                  className="text-ink-muted hover:text-ink-2"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <form onSubmit={handleCommentSubmit} className="flex items-center gap-2 pt-1">
              <input
                ref={commentInputRef}
                type="text"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                maxLength={500}
                placeholder={
                  replyingTo
                    ? `Reply to @${replyingTo.replyToUsername}...`
                    : currentUser
                    ? 'Add a thoughtful comment or @mention...'
                    : 'Sign in to comment'
                }
                className="flex-1 rounded-xl bg-canvas-alt border border-hairline px-3.5 py-2 text-sm text-ink-2 placeholder:text-ink-subtle focus:outline-none focus:border-accent-strong"
              />
              <button
                type="submit"
                disabled={submittingComment || !commentText.trim()}
                aria-label="Send comment"
                className="min-h-[38px] min-w-[38px] px-3 rounded-xl gold-gradient-btn flex items-center justify-center disabled:opacity-40 transition-opacity"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Delete this post?"
        description="This action permanently removes the post and its engagement from Hostel Friend."
        confirmLabel="Delete Post"
        destructive
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDeleteOpen(false)}
      />

      {currentUser && (
        <ReportModal
          open={reportOpen}
          reporterId={currentUser.uid}
          targetType="post"
          targetId={post.id}
          targetAuthorId={post.authorId}
          targetLabel={`Post by @${post.authorUsername}`}
          onClose={() => setReportOpen(false)}
        />
      )}

      <SharePostModal
        open={shareOpen}
        post={post}
        onClose={() => setShareOpen(false)}
      />

      <ReactionDetailsModal
        open={reactionsModalOpen}
        post={post}
        currentUserReaction={activeReaction}
        onClose={() => setReactionsModalOpen(false)}
        onOpenProfile={onOpenProfile}
      />
    </article>
  );
}
