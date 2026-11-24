import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ThumbsUp } from 'lucide-react';
import { Post, ReactionType } from '../types';
import { formatCount } from '../utils/formatters';
import { getReactionMeta, getTopReactionsSummary, REACTION_OPTIONS } from '../utils/reactions';
import { playSound } from '../utils/soundVfx';

interface ReactionControlProps {
  currentReaction: ReactionType | null;
  isAuthenticated: boolean;
  onSelectReaction: (reaction: ReactionType | null) => void;
  onRequireAuth?: () => void;
  variant?: 'feed' | 'compact' | 'explore' | 'moment';
  likesCount?: number;
  align?: 'left' | 'right';
}

export function ReactionControl({
  currentReaction,
  isAuthenticated,
  onSelectReaction,
  onRequireAuth,
  variant = 'feed',
  likesCount = 0,
  align = 'left',
}: ReactionControlProps) {
  const [trayOpen, setTrayOpen] = useState(false);
  const [hoveredReaction, setHoveredReaction] = useState<ReactionType | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const pointerTypeRef = useRef<string>('mouse');

  const clearHoverTimers = useCallback(() => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearHoverTimers();
      clearLongPressTimer();
    };
  }, [clearHoverTimers, clearLongPressTimer]);

  // Close floating glassy tray on outside pointerdown or Escape
  useEffect(() => {
    if (!trayOpen) return;

    const handleOutsidePointer = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setTrayOpen(false);
        setHoveredReaction(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTrayOpen(false);
        setHoveredReaction(null);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', handleOutsidePointer);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [trayOpen]);

  const handleChooseReaction = useCallback(
    (chosen: ReactionType) => {
      clearHoverTimers();
      clearLongPressTimer();
      setTrayOpen(false);
      setHoveredReaction(null);

      if (!isAuthenticated) {
        onRequireAuth?.();
        return;
      }

      const next = currentReaction === chosen ? null : chosen;
      playSound(next ? 'like' : 'unlike');
      onSelectReaction(next);
    },
    [
      clearHoverTimers,
      clearLongPressTimer,
      currentReaction,
      isAuthenticated,
      onRequireAuth,
      onSelectReaction,
    ]
  );

  const handleMouseEnter = () => {
    if (pointerTypeRef.current === 'touch') return;
    clearHoverTimers();
    openTimerRef.current = window.setTimeout(() => {
      setTrayOpen(true);
    }, 150);
  };

  const handleMouseLeave = () => {
    if (pointerTypeRef.current === 'touch') return;
    clearHoverTimers();
    closeTimerRef.current = window.setTimeout(() => {
      setTrayOpen(false);
      setHoveredReaction(null);
    }, 260);
  };

  const handleTriggerClick = () => {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }

    if (!isAuthenticated) {
      onRequireAuth?.();
      return;
    }

    // Touch users without hover get one-tap access to the glassy 6-reaction tray when tray is closed.
    if (pointerTypeRef.current !== 'mouse' && !trayOpen) {
      setTrayOpen(true);
      setHoveredReaction(currentReaction || 'like');
      return;
    }

    // Quick click on desktop (or second tap while tray is open on mobile) toggles Like / removes current reaction.
    setTrayOpen(false);
    setHoveredReaction(null);
    const next = currentReaction ? null : 'like';
    playSound(next ? 'like' : 'unlike');
    onSelectReaction(next);
  };

  const handleTriggerPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    pointerTypeRef.current = e.pointerType || 'mouse';
    longPressTriggeredRef.current = false;
    clearLongPressTimer();

    if (e.pointerType !== 'mouse') {
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTriggeredRef.current = true;
        setTrayOpen(true);
        setHoveredReaction(currentReaction || 'like');
      }, 300);
    }
  };

  const handleTriggerPointerUp = () => {
    clearLongPressTimer();
  };

  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      setTrayOpen((prev) => !prev);
      setHoveredReaction(currentReaction || 'like');
    }
  };

  const activeMeta = currentReaction ? getReactionMeta(currentReaction) : null;
  const focusedOrHovered = hoveredReaction || currentReaction;

  const triggerClass =
    variant === 'feed'
      ? `w-full min-h-[44px] px-2 rounded-xl flex items-center justify-center gap-1.5 text-xs sm:text-sm font-semibold hf-press whitespace-nowrap ${
          activeMeta
            ? `${activeMeta.activeTextClass} ${activeMeta.activeSurfaceClass} border`
            : 'text-ink-2 hover:text-accent hover:bg-surface-hover border border-transparent'
        }`
      : variant === 'moment'
        ? 'hf-press flex flex-col items-center gap-1 min-w-[44px]'
        : variant === 'explore'
          ? `min-h-[38px] px-2.5 rounded-lg inline-flex items-center gap-1.5 font-mono tabular-nums transition-colors ${
              activeMeta
                ? `${activeMeta.activeTextClass} bg-hover-tint font-semibold`
                : 'text-ink-muted hover:text-ink hover:bg-hover-tint'
            }`
          : `min-h-[40px] px-2.5 rounded-xl flex items-center gap-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeMeta
                ? `${activeMeta.activeTextClass} bg-hover-tint`
                : 'text-ink-muted hover:text-ink-2 hover:bg-hover-tint'
            }`;

  return (
    <div
      ref={containerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`relative ${variant === 'feed' ? 'flex-1' : 'inline-flex'}`}
    >
      {/* Floating Liquid-Glass Reaction Capsule */}
      {trayOpen && (
        <div
          role="toolbar"
          aria-label="Choose a reaction"
          className={`absolute bottom-full mb-2.5 z-40 ${
            align === 'right' ? 'right-0' : 'left-0'
          } max-w-[calc(100vw-2rem)]`}
          onMouseEnter={() => {
            clearHoverTimers();
          }}
        >
          <div className="hf-reaction-capsule rounded-full px-2 py-1.5 flex items-center gap-1 sm:gap-1.5">
            {REACTION_OPTIONS.map((option, index) => {
              const isHighlighted = focusedOrHovered === option.type;
              const isSelected = currentReaction === option.type;
              return (
                <button
                  key={option.type}
                  type="button"
                  onClick={() => handleChooseReaction(option.type)}
                  onMouseEnter={() => setHoveredReaction(option.type)}
                  onFocus={() => setHoveredReaction(option.type)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowRight') {
                      e.preventDefault();
                      const nextIdx = (index + 1) % REACTION_OPTIONS.length;
                      const nextBtn = e.currentTarget.parentElement?.children[nextIdx] as
                        | HTMLButtonElement
                        | undefined;
                      nextBtn?.focus();
                    } else if (e.key === 'ArrowLeft') {
                      e.preventDefault();
                      const prevIdx =
                        (index - 1 + REACTION_OPTIONS.length) % REACTION_OPTIONS.length;
                      const prevBtn = e.currentTarget.parentElement?.children[prevIdx] as
                        | HTMLButtonElement
                        | undefined;
                      prevBtn?.focus();
                    }
                  }}
                  aria-label={`React with ${option.label}${isSelected ? ' (selected)' : ''}`}
                  aria-pressed={isSelected}
                  style={
                    isHighlighted
                      ? { boxShadow: `0 6px 18px rgba(0,0,0,0.34), inset 0 1px 1.5px rgba(255,255,255,0.48), 0 0 14px ${option.glowColor}` }
                      : undefined
                  }
                  className={`hf-reaction-item min-w-[44px] min-h-[44px] w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    isHighlighted
                      ? 'hf-reaction-orb -translate-y-1.5 scale-110 z-10'
                      : 'hover:bg-white/10'
                  }`}
                >
                  {/* Floating Label above Active/Hovered Reaction */}
                  {isHighlighted && (
                    <span className="pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-black/85 border border-white/20 text-[10px] font-semibold tracking-wide text-white whitespace-nowrap shadow-md">
                      {option.label}
                    </span>
                  )}

                  <span
                    aria-hidden="true"
                    className={`leading-none transition-transform duration-150 ${
                      isHighlighted ? 'text-[26px] sm:text-[28px]' : 'text-[22px] sm:text-[24px]'
                    }`}
                  >
                    {option.emoji}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        onClick={handleTriggerClick}
        onPointerDown={handleTriggerPointerDown}
        onPointerUp={handleTriggerPointerUp}
        onPointerCancel={handleTriggerPointerUp}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="menu"
        aria-expanded={trayOpen}
        aria-pressed={Boolean(currentReaction)}
        aria-label={
          activeMeta
            ? `Reacted ${activeMeta.label}. Tap to change or remove reaction`
            : 'React to post'
        }
        className={triggerClass}
      >
        {variant === 'moment' ? (
          <>
            <div
              className={`w-11 h-11 rounded-full flex items-center justify-center backdrop-blur-md border border-white/20 ${
                activeMeta
                  ? 'bg-accent/90 text-accent-fg shadow-[0_6px_18px_var(--hf-accent-glow)]'
                  : 'bg-black/55 text-white'
              }`}
            >
              {activeMeta ? (
                <span aria-hidden="true" className="text-xl leading-none">
                  {activeMeta.emoji}
                </span>
              ) : (
                <ThumbsUp className="w-5 h-5" />
              )}
            </div>
            <span className="text-[11px] font-mono tabular-nums text-white">
              {formatCount(likesCount)}
            </span>
          </>
        ) : (
          <>
            {activeMeta ? (
              <span aria-hidden="true" className="text-base leading-none">
                {activeMeta.emoji}
              </span>
            ) : (
              <ThumbsUp
                className={`${
                  variant === 'explore' ? 'w-3.5 h-3.5' : 'w-4 h-4'
                } ${variant === 'feed' ? 'text-accent' : ''}`}
              />
            )}

            {variant === 'feed' ? (
              <span>{activeMeta ? activeMeta.label : 'React'}</span>
            ) : (
              <span className="tabular-nums text-xs">{formatCount(likesCount)}</span>
            )}
          </>
        )}
      </button>
    </div>
  );
}

interface ReactionSummaryTriggerProps {
  post: Pick<Post, 'likesCount' | 'reactionCounts'>;
  onOpenDetails: () => void;
  compact?: boolean;
}

export function ReactionSummaryTrigger({
  post,
  onOpenDetails,
  compact = false,
}: ReactionSummaryTriggerProps) {
  const summary = useMemo(() => getTopReactionsSummary(post, compact ? 3 : 4), [post, compact]);

  if (summary.totalCount <= 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-ink-muted tabular-nums">
        <span aria-hidden="true" className="text-xs opacity-70">
          👍
        </span>
        <span>0 reactions</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpenDetails}
      aria-label={`View ${summary.totalCount} reactions`}
      className="group inline-flex items-center gap-2 text-left hover:text-accent transition-colors focus:outline-none focus-visible:underline"
    >
      {/* Overlapping frosted mini emoji icons */}
      <span className="inline-flex items-center -space-x-1.5 shrink-0">
        {summary.items.map(({ meta }, idx) => (
          <span
            key={meta.type}
            style={{ zIndex: 10 - idx }}
            className="w-5 h-5 rounded-full bg-surface-2 border border-hairline-strong flex items-center justify-center text-[11px] leading-none shadow-xs"
            title={`${meta.label}`}
          >
            {meta.emoji}
          </span>
        ))}
      </span>

      {/* Top reaction breakdown on larger screens + total reactions count */}
      {!compact && summary.allNonZero.length > 1 ? (
        <span className="inline-flex items-center gap-2 text-xs tabular-nums">
          <span className="hidden sm:inline-flex items-center gap-1.5 text-ink-muted">
            {summary.items.slice(0, 3).map(({ meta, count }) => (
              <span key={meta.type} className="inline-flex items-center gap-0.5">
                <span aria-hidden="true" className="text-[11px]">
                  {meta.emoji}
                </span>
                <span className="text-ink font-medium">{formatCount(count)}</span>
              </span>
            ))}
          </span>
          <span className="sm:hidden text-ink font-medium group-hover:text-accent">
            {formatCount(summary.totalCount)}{' '}
            {summary.totalCount === 1 ? 'reaction' : 'reactions'}
          </span>
          <span className="hidden sm:inline text-ink-subtle group-hover:text-accent">
            · {formatCount(summary.totalCount)} total
          </span>
        </span>
      ) : (
        <span className="text-xs tabular-nums">
          <span className="text-ink font-medium group-hover:text-accent">
            {formatCount(summary.totalCount)}
          </span>{' '}
          <span className="text-ink-muted group-hover:text-accent">
            {summary.totalCount === 1 ? 'reaction' : 'reactions'}
          </span>
        </span>
      )}
    </button>
  );
}
