import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Loader2,
  MoreHorizontal,
  Trash2,
} from 'lucide-react';
import { Poll, UserProfile } from '../types';
import {
  getPollOptionCounts,
  getPollOptionPercentage,
} from '../services/pollService';
import { formatCount, formatRelativeTime } from '../utils/formatters';
import { playSound } from '../utils/soundVfx';
import { Avatar } from './Avatar';
import { ConfirmDialog } from './ConfirmDialog';

interface PollCardProps {
  poll: Poll;
  currentUser: UserProfile | null;
  isAdmin?: boolean;
  userVotedIndex?: number;
  onVote: (poll: Poll, optionIndex: number) => Promise<void>;
  onDeletePoll: (poll: Poll) => Promise<void>;
  onOpenProfile: (userId: string) => void;
  onRequireAuth?: () => void;
}

export function PollCard({
  poll,
  currentUser,
  isAdmin = false,
  userVotedIndex,
  onVote,
  onDeletePoll,
  onOpenProfile,
  onRequireAuth,
}: PollCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [votingIndex, setVotingIndex] = useState<number | null>(null);
  const [voteError, setVoteError] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [menuOpen]);

  const counts = getPollOptionCounts(poll);
  const totalVotes =
    typeof poll.totalVotes === 'number' && Number.isFinite(poll.totalVotes) && poll.totalVotes >= 0
      ? Math.max(poll.totalVotes, counts.reduce((sum, c) => sum + c, 0))
      : counts.reduce((sum, c) => sum + c, 0);

  const hasVoted = typeof userVotedIndex === 'number' && userVotedIndex >= 0 && userVotedIndex < poll.options.length;
  const canDelete = Boolean(currentUser && (currentUser.uid === poll.authorId || isAdmin));

  const handleOptionClick = async (idx: number) => {
    setVoteError('');
    if (!currentUser) {
      onRequireAuth?.();
      return;
    }
    if (hasVoted || votingIndex !== null) return;

    setVotingIndex(idx);
    playSound('ui-tap');
    try {
      await onVote(poll, idx);
      playSound('like');
    } catch (err) {
      playSound('error');
      setVoteError(err instanceof Error ? err.message : 'Unable to record your vote.');
    } finally {
      setVotingIndex(null);
    }
  };

  const handleConfirmDelete = async () => {
    setDeleting(true);
    try {
      await onDeletePoll(poll);
      setConfirmDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <article
      aria-label={`Poll by ${poll.authorName}`}
      className="glass-card md:hover:border-accent/35 rounded-2xl overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 sm:px-5 pt-4 pb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onOpenProfile(poll.authorId)}
            aria-label={`View ${poll.authorName}'s profile`}
            className="rounded-full p-[1.5px] bg-gradient-to-tr from-accent-deep/75 via-accent/80 to-accent-soft/65 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Avatar src={poll.authorAvatarUrl} name={poll.authorName} size="md" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={() => onOpenProfile(poll.authorId)}
                className="text-[15px] font-display font-semibold text-ink hover:text-accent transition-colors truncate"
              >
                {poll.authorName}
              </button>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent shrink-0">
                <BarChart3 className="w-3 h-3" />
                <span>Poll</span>
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-ink-muted truncate">
              <span className="truncate">@{poll.authorUsername}</span>
              <span aria-hidden="true">·</span>
              <span className="shrink-0">{formatRelativeTime(poll.createdAt)}</span>
            </div>
          </div>
        </div>

        {canDelete && (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Poll options"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-ink-muted hover:text-accent hover:bg-surface-hover transition-colors"
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-1.5 w-44 glass-popover hf-popover-enter rounded-xl py-1.5 z-20">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setConfirmDeleteOpen(true);
                  }}
                  className="w-full min-h-[40px] px-3.5 py-2 text-left text-xs font-medium text-rose-400 hover:bg-rose-500/10 flex items-center gap-2.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Poll</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Question + Interactive Options */}
      <div className="px-4 sm:px-5 pb-4 space-y-3">
        <p className="text-[15.5px] sm:text-base font-display font-semibold text-ink leading-snug break-words">
          {poll.question}
        </p>

        {voteError && (
          <div
            role="alert"
            className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-3 py-2 text-xs text-rose-300 flex items-start gap-2"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
            <span>{voteError}</span>
          </div>
        )}

        <div className="space-y-2" role="group" aria-label="Poll choices">
          {poll.options.map((optionLabel, idx) => {
            const count = counts[idx] ?? 0;
            const pct = getPollOptionPercentage(count, totalVotes);
            const isSelected = hasVoted && userVotedIndex === idx;
            const isSubmittingThis = votingIndex === idx;
            const disabled = hasVoted || votingIndex !== null;

            return (
              <button
                key={idx}
                type="button"
                disabled={disabled}
                onClick={() => void handleOptionClick(idx)}
                aria-pressed={isSelected}
                className={`relative w-full min-h-[46px] rounded-xl border text-left overflow-hidden transition-all ${
                  hasVoted
                    ? isSelected
                      ? 'border-accent/65 bg-canvas-alt cursor-default'
                      : 'border-hairline bg-canvas-alt/75 cursor-default'
                    : 'border-hairline bg-canvas-alt hover:border-accent/60 hover:bg-accent/6 hf-press cursor-pointer'
                } ${votingIndex !== null && !isSubmittingThis ? 'opacity-65' : ''}`}
              >
                {/* Animated Percentage Fill Bar */}
                {hasVoted && (
                  <div
                    aria-hidden="true"
                    className={`absolute inset-y-0 left-0 transition-[width] duration-500 ease-out ${
                      isSelected
                        ? 'bg-gradient-to-r from-accent/28 via-accent/18 to-accent/10'
                        : 'bg-ink/8'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                )}

                <div className="relative z-10 px-3.5 py-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {isSubmittingThis ? (
                      <Loader2 className="w-4 h-4 text-accent animate-spin shrink-0" />
                    ) : isSelected ? (
                      <CheckCircle2 className="w-4 h-4 text-accent shrink-0" />
                    ) : !hasVoted ? (
                      <span
                        aria-hidden="true"
                        className="w-4 h-4 rounded-full border border-hairline-strong shrink-0"
                      />
                    ) : null}

                    <span
                      className={`text-sm leading-snug break-words ${
                        isSelected ? 'font-semibold text-ink' : 'font-medium text-ink-2'
                      }`}
                    >
                      {optionLabel}
                    </span>
                  </div>

                  {hasVoted && (
                    <div className="flex items-center gap-2 shrink-0 tabular-nums">
                      <span className="text-[11px] text-ink-muted">
                        {formatCount(count)}
                      </span>
                      <span
                        className={`text-xs font-mono font-bold min-w-[36px] text-right ${
                          isSelected ? 'text-accent' : 'text-ink-2'
                        }`}
                      >
                        {pct}%
                      </span>
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer Summary */}
        <div className="pt-2 border-t border-hairline flex items-center justify-between gap-2 text-xs text-ink-muted">
          <span className="tabular-nums font-medium">
            {formatCount(totalVotes)} {totalVotes === 1 ? 'vote' : 'votes'}
          </span>

          {hasVoted ? (
            <span className="text-accent font-semibold inline-flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>You voted</span>
            </span>
          ) : currentUser ? (
            <span className="text-ink-subtle">Tap an option to vote</span>
          ) : (
            <button
              type="button"
              onClick={() => onRequireAuth?.()}
              className="text-accent font-semibold hover:text-accent-soft"
            >
              Sign in to vote
            </button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Delete this poll?"
        description="This permanently removes the poll and its results from the Hostel Friend feed."
        confirmLabel="Delete Poll"
        destructive
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </article>
  );
}
