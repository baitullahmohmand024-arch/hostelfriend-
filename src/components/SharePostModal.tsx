import React, { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, MessageCircle, Share2, X } from 'lucide-react';
import { Post } from '../types';
import { useToast } from '../context/ToastContext';
import { playSound } from '../utils/soundVfx';

interface SharePostModalProps {
  open: boolean;
  post: Post;
  onClose: () => void;
}

function copyTextReliably(text: string): Promise<boolean> {
  return (async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Clipboard API can be blocked inside sandboxed iframes — fall back below
    }

    try {
      if (typeof document === 'undefined') return false;
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '0';
      textarea.style.left = '0';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  })();
}

export function SharePostModal({ open, post, onClose }: SharePostModalProps) {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);

  const shareUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/?post=${encodeURIComponent(post.id)}`
      : `/?post=${encodeURIComponent(post.id)}`;

  const previewText = post.caption
    ? post.caption.trim().slice(0, 110) + (post.caption.trim().length > 110 ? '...' : '')
    : `Check out ${post.authorName}'s post on Hostel Friend`;

  const shareMessage = `${post.authorName} on Hostel Friend: "${previewText}"\n${shareUrl}`;
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(shareMessage)}`;
  const supportsNativeShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useEffect(() => {
    if (!open) {
      setCopied(false);
    }
  }, [open]);

  if (!open) return null;

  const handleCopyLink = async () => {
    const ok = await copyTextReliably(shareUrl);
    if (ok) {
      setCopied(true);
      playSound('ui-tap');
      showToast({
        type: 'success',
        title: 'Link copied!',
        description: 'Post link is ready to paste anywhere.',
      });
      setTimeout(() => setCopied(false), 2500);
    } else {
      showToast({
        type: 'info',
        title: 'Select link below to copy',
        description: 'Tap the link box and copy it manually.',
      });
    }
  };

  const handleNativeShare = async () => {
    if (!supportsNativeShare) return;
    try {
      await navigator.share({
        title: `${post.authorName} · Hostel Friend`,
        text: previewText,
        url: shareUrl,
      });
      playSound('ui-tap');
      onClose();
    } catch (err) {
      const name = (err as { name?: string })?.name || '';
      if (name === 'AbortError') return;
      // If navigator.share is blocked by iframe policy, copy link as helpful fallback
      await handleCopyLink();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Share Post"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl glass-modal hf-modal-enter overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-hairline flex items-center justify-between bg-surface-2">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-full bg-gradient-to-br from-accent-soft via-accent to-accent-deep text-accent-fg flex items-center justify-center">
              <Share2 className="w-4 h-4" />
            </span>
            <div>
              <h2 className="font-display text-base font-bold text-ink">Share Post</h2>
              <p className="text-[11px] text-ink-muted truncate max-w-[230px]">
                By {post.authorName} · @{post.authorUsername}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close share dialog"
            className="p-2 rounded-full text-ink-muted hover:text-ink hover:bg-hover-tint transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="rounded-xl bg-canvas-alt border border-hairline px-3.5 py-2.5">
            <p className="text-xs text-ink-muted line-clamp-2 leading-relaxed">{previewText}</p>
          </div>

          <div className="grid grid-cols-1 gap-2.5">
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => playSound('ui-tap')}
              className="w-full min-h-[46px] px-4 rounded-xl bg-[#25D366]/15 border border-[#25D366]/40 hover:bg-[#25D366]/25 text-ink text-sm font-semibold flex items-center justify-between transition-colors"
            >
              <span className="flex items-center gap-2.5">
                <MessageCircle className="w-4 h-4 text-[#25D366]" />
                Share on WhatsApp
              </span>
              <ExternalLink className="w-4 h-4 text-[#25D366]" />
            </a>

            <button
              type="button"
              onClick={handleCopyLink}
              className={`w-full min-h-[46px] px-4 rounded-xl text-sm font-semibold flex items-center justify-between transition-all ${
                copied
                  ? 'bg-emerald-500/20 border border-emerald-400/50 text-emerald-300'
                  : 'gold-gradient-btn'
              }`}
            >
              <span className="flex items-center gap-2.5">
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Link Copied!' : 'Copy Post Link'}
              </span>
              <span className="text-xs opacity-80">{copied ? 'Ready' : 'One tap'}</span>
            </button>

            {supportsNativeShare && (
              <button
                type="button"
                onClick={handleNativeShare}
                className="w-full min-h-[44px] px-4 rounded-xl bg-surface-hover border border-accent/25 hover:border-accent/50 text-ink text-sm font-semibold flex items-center justify-between transition-colors"
              >
                <span className="flex items-center gap-2.5">
                  <Share2 className="w-4 h-4 text-accent" />
                  More Apps
                </span>
                <span className="text-xs text-ink-muted">System Share</span>
              </button>
            )}
          </div>

          <div>
            <label className="block text-[11px] font-medium text-ink-muted mb-1.5">
              Post Link
              <input
                type="text"
                readOnly
                value={shareUrl}
                onClick={(e) => e.currentTarget.select()}
                className="mt-1 w-full rounded-xl bg-canvas border border-hairline px-3 py-2 text-xs font-mono text-accent focus:outline-none focus:border-accent"
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
