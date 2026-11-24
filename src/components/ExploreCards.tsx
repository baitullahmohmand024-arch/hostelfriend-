import { useEffect, useMemo, useState } from 'react';
import {
  Bookmark,
  Check,
  Film,
  ImageOff,
  Loader2,
  MessageCircle,
  Play,
  Share2,
  UserPlus,
} from 'lucide-react';
import { Post, ReactionType, UserProfile } from '../types';
import { formatCount, formatRelativeTime } from '../utils/formatters';
import { getTopReactionsSummary } from '../utils/reactions';
import { Avatar } from './Avatar';
import { ReactionControl } from './ReactionControl';

interface ExplorePersonCardProps {
  member: UserProfile;
  isFollowing: boolean;
  isSelf?: boolean;
  followBusy?: boolean;
  variant?: 'strip' | 'grid';
  onOpenProfile: (uid: string) => void;
  onToggleFollow: (member: UserProfile) => void;
}

export function ExplorePersonCard({
  member,
  isFollowing,
  isSelf = false,
  followBusy = false,
  variant = 'grid',
  onOpenProfile,
  onToggleFollow,
}: ExplorePersonCardProps) {
  const containerWidth =
    variant === 'strip'
      ? 'w-[260px] sm:w-[276px] shrink-0 snap-start'
      : 'w-full';

  return (
    <article
      className={`${containerWidth} glass-card-interactive rounded-2xl p-4 flex flex-col justify-between gap-3.5`}
    >
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => onOpenProfile(member.uid)}
          className="w-full text-left flex items-start gap-3 group focus:outline-none"
        >
          <Avatar src={member.avatarUrl} name={member.fullName} size="md" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-display font-semibold text-ink group-hover:text-accent transition-colors truncate">
              {member.fullName}
            </p>
            <p className="text-xs text-ink-muted truncate">@{member.username}</p>
            {member.hostel && (
              <p className="text-[11px] text-accent/90 font-medium truncate mt-0.5">
                {member.hostel}
              </p>
            )}
          </div>
        </button>

        {member.bio ? (
          <p className="text-xs text-ink-muted leading-relaxed line-clamp-2 min-h-[2.25rem]">
            {member.bio}
          </p>
        ) : (
          <p className="text-xs text-ink-subtle leading-relaxed min-h-[2.25rem]">
            Hostel Friend community member
          </p>
        )}
      </div>

      <div className="pt-2.5 border-t border-hairline flex items-center justify-between gap-2.5">
        <p className="text-[11px] font-mono tabular-nums text-ink-subtle truncate">
          {formatCount(member.followersCount || 0)} followers ·{' '}
          {formatCount(member.postsCount || 0)} posts
        </p>

        {!isSelf && (
          <button
            type="button"
            disabled={followBusy}
            onClick={() => onToggleFollow(member)}
            className={`min-h-[38px] px-3.5 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 hf-press disabled:opacity-60 ${
              isFollowing
                ? 'glass-btn text-ink'
                : 'gold-gradient-btn'
            }`}
          >
            {followBusy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : isFollowing ? (
              <Check className="w-3.5 h-3.5 text-accent" />
            ) : (
              <UserPlus className="w-3.5 h-3.5" />
            )}
            <span>{isFollowing ? 'Following' : 'Follow'}</span>
          </button>
        )}
      </div>
    </article>
  );
}

interface ExploreDiscoveryCardProps {
  post: Post;
  isLiked?: boolean;
  userReaction?: ReactionType | null;
  isAuthenticated?: boolean;
  isSaved: boolean;
  spotlightLabel?: string;
  onOpenPost: (post: Post) => void;
  onOpenProfile: (uid: string) => void;
  onSearchHashtag: (tag: string) => void;
  onToggleLike?: (post: Post) => void;
  onSelectReaction?: (post: Post, reaction: ReactionType | null) => void;
  onRequireAuth?: () => void;
  onToggleSave: (post: Post) => void;
  onSharePost: (post: Post) => void;
}

export function ExploreDiscoveryCard({
  post,
  isLiked = false,
  userReaction,
  isAuthenticated = true,
  isSaved,
  spotlightLabel,
  onOpenPost,
  onOpenProfile,
  onSearchHashtag,
  onToggleLike,
  onSelectReaction,
  onRequireAuth,
  onToggleSave,
  onSharePost,
}: ExploreDiscoveryCardProps) {
  const [mediaError, setMediaError] = useState(false);

  useEffect(() => {
    setMediaError(false);
  }, [post.id, post.mediaUrl, post.thumbnailUrl]);

  const hasMedia = post.mediaType === 'image' || post.mediaType === 'video';
  const visibleTags = (post.hashtags || []).slice(0, 2);
  const activeReaction: ReactionType | null =
    userReaction !== undefined ? userReaction : isLiked ? 'like' : null;
  const topReactions = useMemo(() => getTopReactionsSummary(post, 3), [post]);

  return (
    <article className="break-inside-avoid rounded-2xl glass-card-interactive flex flex-col">
      {/* Media or Editorial Text Body */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpenPost(post)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpenPost(post);
          }
        }}
        aria-label={`Open post by ${post.authorName}`}
        className="group relative w-full text-left bg-canvas-alt rounded-t-2xl overflow-hidden cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {post.mediaType === 'text' ? (
          <div className="p-5 bg-surface-2 space-y-3">
            {spotlightLabel && (
              <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">
                {spotlightLabel}
              </p>
            )}
            <p className="text-sm sm:text-[15px] text-ink leading-relaxed line-clamp-6 whitespace-pre-wrap break-words">
              {post.caption || 'Shared a note with the hostel community.'}
            </p>
          </div>
        ) : mediaError || !post.mediaUrl ? (
          <div className="aspect-[4/3] w-full bg-surface-2 flex flex-col items-center justify-center p-6 text-center gap-2">
            <ImageOff className="w-7 h-7 text-ink-subtle" />
            <p className="text-xs text-ink-muted line-clamp-2">
              {post.caption || 'Media unavailable — tap to open post'}
            </p>
          </div>
        ) : post.mediaType === 'video' ? (
          <div className="relative bg-black">
            {post.thumbnailUrl ? (
              <img
                src={post.thumbnailUrl}
                alt={post.caption || `Video by ${post.authorName}`}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={() => setMediaError(true)}
                className="w-full h-auto max-h-[440px] object-cover group-hover:scale-[1.02] transition-transform duration-300"
              />
            ) : (
              <video
                src={post.mediaUrl}
                muted
                playsInline
                preload="metadata"
                onError={() => setMediaError(true)}
                className="w-full h-auto max-h-[440px] object-cover"
              />
            )}

            <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none">
              {spotlightLabel ? (
                <span className="px-2.5 py-1 rounded-lg bg-black/75 text-white text-[11px] font-semibold">
                  {spotlightLabel}
                </span>
              ) : (
                <span />
              )}
              <span className="px-2 py-1 rounded-lg bg-black/75 text-white text-[11px] font-medium inline-flex items-center gap-1">
                <Film className="w-3 h-3" />
                <span>Video</span>
              </span>
            </div>

            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="w-11 h-11 rounded-full bg-black/65 border border-white/25 text-white flex items-center justify-center group-hover:scale-110 transition-transform">
                <Play className="w-4 h-4 fill-white ml-0.5" />
              </span>
            </div>

            {post.caption && (
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent p-3.5 pt-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
                <p className="text-xs text-white line-clamp-2">{post.caption}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="relative bg-canvas-alt">
            <img
              src={post.mediaUrl}
              alt={post.caption || `Photo by ${post.authorName}`}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => setMediaError(true)}
              className="w-full h-auto max-h-[460px] object-cover group-hover:scale-[1.02] transition-transform duration-300"
            />
            {spotlightLabel && (
              <span className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-black/75 text-white text-[11px] font-semibold pointer-events-none">
                {spotlightLabel}
              </span>
            )}
            {post.caption && (
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent p-3.5 pt-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
                <p className="text-xs text-white line-clamp-2">{post.caption}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Card Info & Quick Actions */}
      <div className="p-3.5 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => onOpenProfile(post.authorId)}
            className="flex items-center gap-2 min-w-0 text-left group/author"
          >
            <Avatar src={post.authorAvatarUrl} name={post.authorName} size="xs" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-ink group-hover/author:text-accent transition-colors truncate">
                {post.authorName}
              </p>
              <p className="text-[11px] text-ink-subtle truncate">
                @{post.authorUsername} · {formatRelativeTime(post.createdAt)}
              </p>
            </div>
          </button>
        </div>

        {hasMedia && post.caption && (
          <button
            type="button"
            onClick={() => onOpenPost(post)}
            className="block w-full text-left text-xs text-ink-muted hover:text-ink transition-colors line-clamp-2 leading-relaxed"
          >
            {post.caption}
          </button>
        )}

        {visibleTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-accent">
            {visibleTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => onSearchHashtag(tag)}
                className="hover:underline truncate max-w-[140px]"
              >
                #{tag}
              </button>
            ))}
          </div>
        )}

        <div className="pt-2 border-t border-hairline flex items-center justify-between gap-1 text-xs">
          <div className="flex items-center gap-1">
            <ReactionControl
              currentReaction={activeReaction}
              isAuthenticated={isAuthenticated}
              onSelectReaction={(reaction) => {
                if (onSelectReaction) {
                  onSelectReaction(post, reaction);
                } else if (onToggleLike) {
                  onToggleLike(post);
                }
              }}
              onRequireAuth={onRequireAuth}
              variant="explore"
              likesCount={topReactions.totalCount}
            />

            {topReactions.items.length > 0 && (
              <button
                type="button"
                onClick={() => onOpenPost(post)}
                aria-label="Open post reactions"
                className="hidden sm:inline-flex items-center -space-x-1 pl-0.5 pr-1 hover:scale-105 transition-transform"
              >
                {topReactions.items.slice(0, 2).map(({ meta }) => (
                  <span
                    key={meta.type}
                    className="w-4 h-4 rounded-full bg-surface-2 border border-hairline flex items-center justify-center text-[10px] leading-none"
                  >
                    {meta.emoji}
                  </span>
                ))}
              </button>
            )}

            <button
              type="button"
              onClick={() => onOpenPost(post)}
              aria-label="Open comments"
              className="min-h-[38px] px-2.5 rounded-lg inline-flex items-center gap-1.5 font-mono tabular-nums text-ink-muted hover:text-ink hover:bg-hover-tint transition-colors"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              <span>{formatCount(post.commentsCount || 0)}</span>
            </button>
          </div>

          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => onToggleSave(post)}
              aria-label={isSaved ? 'Remove saved post' : 'Save post'}
              className={`min-h-[38px] min-w-[38px] rounded-lg inline-flex items-center justify-center transition-colors ${
                isSaved
                  ? 'text-accent bg-hover-tint'
                  : 'text-ink-muted hover:text-ink hover:bg-hover-tint'
              }`}
            >
              <Bookmark className={`w-3.5 h-3.5 ${isSaved ? 'fill-current' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => onSharePost(post)}
              aria-label="Share post"
              className="min-h-[38px] min-w-[38px] rounded-lg inline-flex items-center justify-center text-ink-muted hover:text-ink hover:bg-hover-tint transition-colors"
            >
              <Share2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
