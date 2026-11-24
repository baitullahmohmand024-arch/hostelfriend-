import { useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import { Post, PostReaction, ReactionType } from '../types';
import { fetchPostReactions } from '../services/postService';
import { formatUserFriendlyError } from '../lib/firestoreError';
import { formatCount, formatRelativeTime } from '../utils/formatters';
import {
  getReactionMeta,
  getTopReactionsSummary,
  REACTION_OPTIONS,
} from '../utils/reactions';
import { Avatar } from './Avatar';

interface ReactionDetailsModalProps {
  open: boolean;
  post: Post;
  currentUserReaction: ReactionType | null;
  onClose: () => void;
  onOpenProfile: (userId: string) => void;
}

export function ReactionDetailsModal({
  open,
  post,
  currentUserReaction,
  onClose,
  onOpenProfile,
}: ReactionDetailsModalProps) {
  const [filter, setFilter] = useState<'all' | ReactionType>('all');
  const [reactions, setReactions] = useState<PostReaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const summary = useMemo(() => getTopReactionsSummary(post, 6), [post]);

  useEffect(() => {
    if (!open) return;
    setFilter('all');
  }, [open, post.id]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchPostReactions(post.id, 80)
      .then((list) => {
        if (!cancelled) {
          setReactions(list);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            formatUserFriendlyError(
              err,
              'Could not load the full reaction list right now.'
            )
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, post.id, post.likesCount, currentUserReaction, reloadTick]);

  const tabOptions = useMemo(() => {
    const countsFromRecords = new Map<ReactionType, number>();
    reactions.forEach((item) => {
      countsFromRecords.set(
        item.reactionType,
        (countsFromRecords.get(item.reactionType) || 0) + 1
      );
    });

    const summaryMap = new Map(summary.allNonZero.map((s) => [s.meta.type, s.count]));
    return REACTION_OPTIONS.map((meta) => ({
      meta,
      count: Math.max(summaryMap.get(meta.type) || 0, countsFromRecords.get(meta.type) || 0),
    })).filter((entry) => entry.count > 0);
  }, [reactions, summary.allNonZero]);

  const filteredReactions = useMemo(() => {
    if (filter === 'all') return reactions;
    return reactions.filter((item) => item.reactionType === filter);
  }, [filter, reactions]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Post reactions breakdown"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md glass-modal hf-modal-enter rounded-t-3xl sm:rounded-2xl overflow-hidden flex flex-col max-h-[82vh]"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-hairline flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-base font-bold text-ink flex items-center gap-2">
              <span>Reactions</span>
              <span className="font-mono text-xs font-semibold text-accent tabular-nums">
                {formatCount(Math.max(summary.totalCount, reactions.length))}
              </span>
            </h3>
            <p className="text-[11px] text-ink-muted truncate">
              People who reacted to @{post.authorUsername}&apos;s post
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close reactions modal"
            className="min-w-[40px] min-h-[40px] rounded-full glass-btn text-ink-muted hover:text-ink flex items-center justify-center shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Reaction Filter Tabs */}
        <div
          role="tablist"
          aria-label="Filter reactions by type"
          className="px-4 py-2.5 border-b border-hairline flex items-center gap-1.5 overflow-x-auto no-scrollbar"
        >
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'all'}
            onClick={() => setFilter('all')}
            className={`min-h-[36px] px-3 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
              filter === 'all'
                ? 'bg-accent text-accent-fg shadow-sm'
                : 'text-ink-muted hover:text-ink hover:bg-hover-tint'
            }`}
          >
            <span>All</span>
            <span className="font-mono tabular-nums opacity-85">
              {formatCount(Math.max(summary.totalCount, reactions.length))}
            </span>
          </button>

          {tabOptions.map(({ meta, count }) => (
            <button
              key={meta.type}
              type="button"
              role="tab"
              aria-selected={filter === meta.type}
              onClick={() => setFilter(meta.type)}
              className={`min-h-[36px] px-3 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                filter === meta.type
                  ? 'bg-accent/18 text-accent border border-accent/45'
                  : 'text-ink-muted hover:text-ink hover:bg-hover-tint border border-transparent'
              }`}
            >
              <span aria-hidden="true" className="text-sm leading-none">
                {meta.emoji}
              </span>
              <span className="font-mono tabular-nums">{formatCount(count)}</span>
            </button>
          ))}
        </div>

        {/* Users List */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-1.5 min-h-[200px]">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2.5 text-ink-muted">
              <Loader2 className="w-5 h-5 text-accent animate-spin" />
              <p className="text-xs">Loading reactions...</p>
            </div>
          ) : error ? (
            <div className="py-10 px-4 text-center space-y-3">
              <p className="text-xs text-ink-muted leading-relaxed">{error}</p>
              <button
                type="button"
                onClick={() => setReloadTick((t) => t + 1)}
                className="min-h-[38px] px-4 rounded-xl glass-btn text-xs font-semibold text-accent inline-flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Try Again</span>
              </button>
            </div>
          ) : filteredReactions.length === 0 ? (
            <div className="py-12 px-4 text-center space-y-2">
              <Sparkles className="w-6 h-6 text-accent/70 mx-auto" />
              <p className="text-sm font-medium text-ink">No reactions in this category yet</p>
              <p className="text-xs text-ink-muted">
                Be the first to react to this post.
              </p>
            </div>
          ) : (
            filteredReactions.map((item) => {
              const meta = getReactionMeta(item.reactionType);
              const displayName = item.userName || 'Hostel Member';
              const displayUsername = item.userUsername || '';
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenProfile(item.userId);
                  }}
                  className="w-full min-h-[52px] px-3 py-2 rounded-xl hover:bg-hover-tint flex items-center justify-between gap-3 text-left transition-colors group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative shrink-0">
                      <Avatar
                        src={item.userAvatarUrl || ''}
                        name={displayName}
                        size="sm"
                      />
                      <span
                        title={meta.label}
                        className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-surface border border-hairline-strong flex items-center justify-center text-[11px] leading-none shadow-sm"
                      >
                        {meta.emoji}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink group-hover:text-accent transition-colors truncate">
                        {displayName}
                      </p>
                      <p className="text-[11px] text-ink-muted truncate">
                        {displayUsername ? `@${displayUsername}` : 'Hostel Friend member'}
                        {item.updatedAt || item.createdAt
                          ? ` · ${formatRelativeTime(item.updatedAt || item.createdAt)}`
                          : ''}
                      </p>
                    </div>
                  </div>
                  <span className={`text-xs font-medium shrink-0 ${meta.activeTextClass}`}>
                    {meta.label}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
