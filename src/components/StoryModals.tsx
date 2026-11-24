import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Film,
  Heart,
  ImageOff,
  ImagePlus,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
  Trash2,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { StoryItem, StoryLike, UserProfile } from '../types';
import { createStory, deleteStory, fetchStoryLikers } from '../services/storyService';
import {
  formatBytes,
  formatEta,
  formatSpeed,
  PreparedMedia,
  prepareMediaForUpload,
  startResumableUpload,
  UploadCancelledError,
  UploadTelemetry,
  validateMediaFile,
} from '../services/mediaService';
import { useToast } from '../context/ToastContext';
import { Avatar } from './Avatar';
import { formatRelativeTime } from '../utils/formatters';
import { formatStoryExpiryRemaining } from '../utils/storyViewed';
import { formatUserFriendlyError } from '../lib/firestoreError';
import { useModalBackHandler } from '../lib/backNavigation';
import { playSound } from '../utils/soundVfx';

interface AddStoryModalProps {
  open: boolean;
  profile: UserProfile;
  maxUploadSizeMB: number;
  onClose: () => void;
  onStoryCreated: (story: StoryItem) => void;
}

export function AddStoryModal({
  open,
  profile,
  maxUploadSizeMB,
  onClose,
  onStoryCreated,
}: AddStoryModalProps) {
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelUploadRef = useRef<(() => void) | null>(null);
  const preparePromiseRef = useRef<Promise<PreparedMedia | null> | null>(null);
  const pickGenRef = useRef(0);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preparedMedia, setPreparedMedia] = useState<PreparedMedia | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image');
  const [previewUrl, setPreviewUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [telemetry, setTelemetry] = useState<UploadTelemetry | null>(null);
  const [phaseLabel, setPhaseLabel] = useState('Publishing story...');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (preparedMedia?.previewUrl && preparedMedia.previewUrl !== previewUrl) {
        URL.revokeObjectURL(preparedMedia.previewUrl);
      }
      if (preparedMedia?.thumbnailPreviewUrl) {
        URL.revokeObjectURL(preparedMedia.thumbnailPreviewUrl);
      }
    };
  }, [previewUrl, preparedMedia]);

  const clearSelection = useCallback(() => {
    pickGenRef.current += 1;
    preparePromiseRef.current = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (preparedMedia?.previewUrl && preparedMedia.previewUrl !== previewUrl) {
      URL.revokeObjectURL(preparedMedia.previewUrl);
    }
    if (preparedMedia?.thumbnailPreviewUrl) {
      URL.revokeObjectURL(preparedMedia.thumbnailPreviewUrl);
    }
    setSelectedFile(null);
    setPreparedMedia(null);
    setPreparing(false);
    setPreviewUrl('');
    setTelemetry(null);
    setErrorMsg('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [previewUrl, preparedMedia]);

  const resetAndClose = useCallback(() => {
    if (uploading) return;
    clearSelection();
    setCaption('');
    onClose();
  }, [uploading, clearSelection, onClose]);

  useModalBackHandler(open, resetAndClose);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !uploading) {
        resetAndClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, uploading, resetAndClose]);

  if (!open) return null;

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg('');
    const file = e.target.files?.[0];
    if (!file) return;

    const validation = validateMediaFile(file, maxUploadSizeMB);
    if (!validation.valid || !validation.mediaType) {
      setErrorMsg(validation.error || 'Please choose a photo or short video.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const gen = ++pickGenRef.current;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (preparedMedia?.previewUrl && preparedMedia.previewUrl !== previewUrl) {
      URL.revokeObjectURL(preparedMedia.previewUrl);
    }
    if (preparedMedia?.thumbnailPreviewUrl) {
      URL.revokeObjectURL(preparedMedia.thumbnailPreviewUrl);
    }

    const immediatePreview = URL.createObjectURL(file);
    setSelectedFile(file);
    setPreparedMedia(null);
    setMediaType(validation.mediaType);
    setPreviewUrl(immediatePreview);
    setPreparing(true);
    setTelemetry(null);

    const prepPromise = prepareMediaForUpload(file, {
      folder: 'posts',
      quality: 0.8,
    })
      .then((prepared) => {
        if (pickGenRef.current !== gen) {
          URL.revokeObjectURL(prepared.previewUrl);
          if (prepared.thumbnailPreviewUrl) URL.revokeObjectURL(prepared.thumbnailPreviewUrl);
          return null;
        }
        setPreparedMedia(prepared);
        setPreparing(false);
        return prepared;
      })
      .catch(() => {
        if (pickGenRef.current === gen) {
          setPreparing(false);
        }
        return null;
      });

    preparePromiseRef.current = prepPromise;
  };

  const handleCancelUpload = () => {
    cancelUploadRef.current?.();
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setErrorMsg('Please select a photo or video from your gallery.');
      return;
    }

    setUploading(true);
    setErrorMsg('');
    setPhaseLabel('Preparing media...');
    setTelemetry({
      phase: 'preparing',
      bytesTransferred: 0,
      totalBytes: selectedFile.size,
      percent: 4,
      speedBytesPerSec: 0,
      etaSeconds: null,
      elapsedMs: 0,
      attempt: 1,
    });

    try {
      let prepared = preparedMedia;
      if (!prepared && preparePromiseRef.current) {
        prepared = await preparePromiseRef.current;
      }

      const fileToUpload = prepared?.uploadFile || selectedFile;
      const precomputedDataUrl = prepared?.directDataUrl;

      setPhaseLabel('Uploading to cloud...');
      const { promise, cancel } = startResumableUpload({
        file: fileToUpload,
        folder: 'posts',
        userId: profile.uid,
        precomputedDataUrl,
        onProgress: (nextTelemetry) => {
          setTelemetry(nextTelemetry);
          if (nextTelemetry.phase === 'paused-offline') {
            setPhaseLabel('Paused (offline) — waiting for connection...');
          } else if (nextTelemetry.phase === 'retrying') {
            setPhaseLabel(`Retrying upload (attempt ${nextTelemetry.attempt})...`);
          } else if (nextTelemetry.phase === 'verifying') {
            setPhaseLabel('Finalizing upload...');
          } else if (nextTelemetry.phase === 'completed') {
            setPhaseLabel('Publishing story...');
          } else {
            setPhaseLabel('Uploading to cloud...');
          }
        },
      });

      cancelUploadRef.current = cancel;
      const uploadResult = await promise;
      cancelUploadRef.current = null;

      setPhaseLabel('Saving story...');
      const created = await createStory({
        author: profile,
        mediaUrl: uploadResult.downloadUrl,
        mediaType,
        caption,
      });

      playSound('upload-success');
      showToast({
        type: 'success',
        title: 'Story published!',
        description: 'Visible to your hostel friends for 24 hours.',
      });

      onStoryCreated(created);
      clearSelection();
      setCaption('');
      onClose();
    } catch (err) {
      cancelUploadRef.current = null;
      if (err instanceof UploadCancelledError) {
        setTelemetry(null);
        setErrorMsg('Upload cancelled. Your selected media and caption are still ready.');
      } else {
        setErrorMsg(formatUserFriendlyError(err, 'Could not publish your story.'));
      }
    } finally {
      setUploading(false);
    }
  };

  const progressPercent = telemetry ? Math.max(4, telemetry.percent) : 0;
  const durationLabel =
    preparedMedia?.durationSeconds && Number.isFinite(preparedMedia.durationSeconds)
      ? `${Math.floor(preparedMedia.durationSeconds / 60)}:${String(
          Math.round(preparedMedia.durationSeconds % 60)
        ).padStart(2, '0')}`
      : null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Add Story"
    >
      <form
        onSubmit={handlePublish}
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl glass-modal hf-modal-enter overflow-hidden pb-[env(safe-area-inset-bottom)] sm:pb-0"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-hairline flex items-center justify-between bg-surface-2">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-9 h-9 rounded-full bg-gradient-to-br from-accent-soft via-accent to-accent-deep text-accent-fg flex items-center justify-center shadow-[0_2px_10px_rgba(245,197,66,0.35)] shrink-0">
              <Sparkles className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h2 className="font-display text-base font-bold text-ink truncate">
                Create Story
              </h2>
              <p className="text-[11px] text-ink-muted truncate">
                @{profile.username} · Visible for 24 hours
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            disabled={uploading}
            aria-label="Close Create Story"
            className="min-w-[40px] min-h-[40px] rounded-full flex items-center justify-center text-ink-muted hover:text-ink hover:bg-hover-tint transition-colors disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {!previewUrl ? (
            <label className="cursor-pointer block rounded-2xl border-2 border-dashed border-accent/35 hover:border-accent bg-canvas-alt hover:bg-surface-2 transition-all px-6 py-9 text-center group">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-accent/20 to-accent-deep/10 border border-accent/35 flex items-center justify-center text-accent group-hover:scale-105 transition-transform">
                <ImagePlus className="w-6 h-6" />
              </div>
              <p className="mt-4 font-display text-sm font-semibold text-ink">
                Choose Photo or Video
              </p>
              <p className="mt-1.5 text-xs text-ink-muted leading-relaxed">
                JPG, PNG, WebP, GIF, MP4, WebM or MOV · Up to {maxUploadSizeMB} MB
              </p>
              <div className="mt-4 flex items-center justify-center gap-4 text-[11px] font-medium text-accent">
                <span className="inline-flex items-center gap-1.5">
                  <ImagePlus className="w-3.5 h-3.5" />
                  Photo Story
                </span>
                <span aria-hidden="true" className="text-white/25">
                  ·
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Film className="w-3.5 h-3.5" />
                  Video Story
                </span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
                onChange={handleFilePick}
                className="sr-only"
              />
            </label>
          ) : (
            <div className="space-y-2.5">
              <div className="relative rounded-2xl overflow-hidden bg-canvas border border-accent/30 aspect-[4/5] max-h-[320px] mx-auto flex items-center justify-center">
                {mediaType === 'video' ? (
                  <video
                    src={previewUrl}
                    controls
                    autoPlay
                    muted
                    loop
                    playsInline
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <img
                    src={previewUrl}
                    alt="Story preview"
                    className="w-full h-full object-cover"
                  />
                )}

                {/* Author overlay preview so user sees how their story header will appear */}
                <div className="pointer-events-none absolute top-0 inset-x-0 p-3 bg-gradient-to-b from-black/75 via-black/30 to-transparent flex items-center gap-2">
                  <Avatar src={profile.avatarUrl} name={profile.fullName} size="xs" />
                  <div className="min-w-0 text-left">
                    <p className="text-[11px] font-semibold text-white truncate">
                      {profile.fullName}
                    </p>
                    <p className="text-[10px] text-white/80 truncate">
                      @{profile.username} · Just now
                    </p>
                  </div>
                </div>

                {!uploading && (
                  <div className="absolute bottom-3 right-3 flex items-center gap-2">
                    <label className="cursor-pointer min-h-[34px] px-3 py-1.5 rounded-xl bg-black/80 border border-white/25 text-xs font-semibold text-white hover:border-accent backdrop-blur-sm inline-flex items-center">
                      Change
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
                        onChange={handleFilePick}
                        className="sr-only"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={clearSelection}
                      aria-label="Remove selected media"
                      className="min-h-[34px] px-3 py-1.5 rounded-xl bg-black/80 border border-white/25 text-xs font-medium text-white hover:border-rose-400/60 hover:text-rose-300 backdrop-blur-sm"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>

              {selectedFile && (
                <div className="flex items-center justify-between text-[11px] text-ink-muted px-1">
                  <span>
                    {mediaType === 'video' ? 'Video' : 'Image'}
                    {preparedMedia?.formatLabel ? ` · ${preparedMedia.formatLabel}` : ''}
                    {durationLabel ? ` · ${durationLabel}` : ''}
                  </span>
                  <span className="font-mono tabular-nums">
                    {preparing
                      ? 'Optimizing...'
                      : formatBytes(preparedMedia?.optimizedSize || selectedFile.size)}
                  </span>
                </div>
              )}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="story-caption-input"
                className="text-xs font-medium text-ink-muted"
              >
                Caption (optional)
              </label>
              <span className="font-mono text-[11px] text-ink-subtle tabular-nums">
                {caption.length}/280
              </span>
            </div>
            <input
              id="story-caption-input"
              type="text"
              maxLength={280}
              value={caption}
              disabled={uploading}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Evening tea at ICP lawn..."
              className="w-full min-h-[44px] rounded-xl bg-canvas border border-hairline px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-accent disabled:opacity-60"
            />
          </div>

          {uploading && (
            <div className="rounded-xl bg-canvas-alt border border-accent/25 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-accent font-medium truncate">{phaseLabel}</span>
                <span className="font-mono text-ink tabular-nums shrink-0">
                  {progressPercent}%
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-hover-tint overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-accent-deep to-accent-soft transition-all duration-150"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="flex items-center justify-between gap-2 text-[11px] text-ink-muted">
                <span className="font-mono tabular-nums truncate">
                  {telemetry && telemetry.speedBytesPerSec > 0
                    ? `${formatSpeed(telemetry.speedBytesPerSec)}${
                        telemetry.etaSeconds ? ` · ${formatEta(telemetry.etaSeconds)}` : ''
                      }`
                    : 'Uploading media...'}
                </span>
                <button
                  type="button"
                  onClick={handleCancelUpload}
                  className="text-rose-400 hover:text-rose-300 font-semibold shrink-0"
                >
                  Cancel upload
                </button>
              </div>
            </div>
          )}

          {errorMsg && (
            <div
              role="alert"
              className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-3.5 py-2.5 flex items-start gap-2 text-xs text-rose-300"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-hairline bg-surface-2 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={resetAndClose}
            disabled={uploading}
            className="min-h-[42px] px-4 py-2 rounded-xl text-xs font-medium border border-hairline-strong text-ink hover:bg-hover-tint disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={uploading || !selectedFile}
            className="min-h-[42px] gold-gradient-btn px-5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-2 disabled:opacity-45"
          >
            {uploading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{uploading ? 'Publishing...' : 'Publish Story'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}

interface StoryViewerModalProps {
  stories: StoryItem[];
  initialIndex: number;
  currentUser?: UserProfile | null;
  isAdmin?: boolean;
  likedStoryIds: Set<string>;
  onClose: () => void;
  onOpenProfile: (uid: string) => void;
  onStoryDeleted: (storyId: string) => void;
  onToggleLikeStory: (story: StoryItem) => void;
  onMarkStoryViewed?: (storyId: string) => void;
  onRequireAuth?: () => void;
}

const IMAGE_STORY_DURATION_MS = 6000;

export function StoryViewerModal({
  stories,
  initialIndex,
  currentUser,
  isAdmin = false,
  likedStoryIds,
  onClose,
  onOpenProfile,
  onStoryDeleted,
  onToggleLikeStory,
  onMarkStoryViewed,
  onRequireAuth,
}: StoryViewerModalProps) {
  const { showToast } = useToast();
  const currentUserId = currentUser?.uid;

  const [index, setIndex] = useState(
    Math.min(Math.max(0, initialIndex), Math.max(0, stories.length - 1))
  );
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [mediaStatus, setMediaStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retryNonce, setRetryNonce] = useState(0);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [heartBurst, setHeartBurst] = useState(false);
  const [likersOpen, setLikersOpen] = useState(false);
  const [likers, setLikers] = useState<StoryLike[]>([]);
  const [loadingLikers, setLoadingLikers] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastCenterTapRef = useRef(0);
  const singleTapTimerRef = useRef<number | null>(null);
  const burstTimeoutRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  // Clamp index if stories shrink dynamically (e.g. expiry or deletion)
  const clampedIndex = Math.min(Math.max(0, index), Math.max(0, stories.length - 1));
  const currentStory = stories[clampedIndex];
  const currentStoryId = currentStory?.id;
  const currentMediaType = currentStory?.mediaType;

  // Group progress bars strictly for the active story author's contiguous slides
  const { authorSlides, authorSlideIndex } = useMemo(() => {
    if (!currentStory || stories.length === 0) {
      return { authorSlides: [] as StoryItem[], authorSlideIndex: 0 };
    }
    const targetAuthorId = currentStory.authorId;
    let start = clampedIndex;
    while (start > 0 && stories[start - 1].authorId === targetAuthorId) {
      start -= 1;
    }
    let end = clampedIndex;
    while (end < stories.length - 1 && stories[end + 1].authorId === targetAuthorId) {
      end += 1;
    }
    return {
      authorSlides: stories.slice(start, end + 1),
      authorSlideIndex: clampedIndex - start,
    };
  }, [stories, clampedIndex, currentStory]);

  useEffect(() => {
    setIndex(Math.min(Math.max(0, initialIndex), Math.max(0, stories.length - 1)));
    setProgressPct(0);
    setPaused(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialIndex]);

  // Reset per-slide UI state and mark story as viewed
  useEffect(() => {
    if (!currentStoryId) return;
    setMediaStatus('loading');
    setProgressPct(0);
    setLikersOpen(false);
    setLikers([]);
    setConfirmDeleteOpen(false);
    onMarkStoryViewed?.(currentStoryId);
  }, [currentStoryId, onMarkStoryViewed]);

  // Silently preload the very next story image for smooth transitions without downloading all 50
  useEffect(() => {
    const nextStory = stories[clampedIndex + 1];
    if (!nextStory || nextStory.mediaType !== 'image' || !nextStory.mediaUrl) return;
    const preloader = new Image();
    preloader.referrerPolicy = 'no-referrer';
    preloader.src = nextStory.mediaUrl;
  }, [stories, clampedIndex]);

  useEffect(() => {
    return () => {
      if (burstTimeoutRef.current) window.clearTimeout(burstTimeoutRef.current);
      if (singleTapTimerRef.current) window.clearTimeout(singleTapTimerRef.current);
    };
  }, []);

  const isTimerHalted = paused || likersOpen || confirmDeleteOpen || mediaStatus !== 'ready';

  // Auto-advance timer for image stories (supports pause/resume preserving elapsed progress)
  const imageProgressRef = useRef(0);
  useEffect(() => {
    imageProgressRef.current = progressPct;
  }, [progressPct]);

  useEffect(() => {
    if (!currentStoryId || currentMediaType !== 'image' || isTimerHalted) return;
    const startingPct = imageProgressRef.current >= 100 ? 0 : imageProgressRef.current;
    const alreadyElapsedMs = (startingPct / 100) * IMAGE_STORY_DURATION_MS;
    const startedAt = performance.now() - alreadyElapsedMs;

    const timer = window.setInterval(() => {
      const elapsed = performance.now() - startedAt;
      const pct = Math.min(100, (elapsed / IMAGE_STORY_DURATION_MS) * 100);
      setProgressPct(pct);
      if (pct >= 100) {
        window.clearInterval(timer);
        if (clampedIndex < stories.length - 1) {
          setIndex(clampedIndex + 1);
          setProgressPct(0);
        } else {
          onClose();
        }
      }
    }, 50);

    return () => window.clearInterval(timer);
  }, [currentStoryId, currentMediaType, isTimerHalted, clampedIndex, stories.length, onClose]);

  // Sync Play/Pause and Mute state with HTMLVideoElement
  useEffect(() => {
    if (currentMediaType !== 'video' || !videoRef.current) return;
    const videoEl = videoRef.current;
    videoEl.muted = muted;
    if (paused || likersOpen || confirmDeleteOpen) {
      videoEl.pause();
    } else if (mediaStatus === 'ready') {
      const playPromise = videoEl.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          // Mobile browsers often block unmuted autoplay; fall back to muted playback cleanly
          if (!videoEl.muted) {
            videoEl.muted = true;
            setMuted(true);
            videoEl.play().catch(() => {
              setPaused(true);
            });
          } else {
            setPaused(true);
          }
        });
      }
    }
  }, [currentMediaType, currentStoryId, paused, muted, likersOpen, confirmDeleteOpen, mediaStatus]);

  const goPrev = useCallback(() => {
    setPaused(false);
    if (clampedIndex > 0) {
      setIndex(clampedIndex - 1);
      setProgressPct(0);
    } else {
      setProgressPct(0);
      if (videoRef.current) {
        videoRef.current.currentTime = 0;
      }
    }
  }, [clampedIndex]);

  const goNext = useCallback(() => {
    setPaused(false);
    if (clampedIndex < stories.length - 1) {
      setIndex(clampedIndex + 1);
      setProgressPct(0);
    } else {
      onClose();
    }
  }, [clampedIndex, stories.length, onClose]);

  useModalBackHandler(Boolean(currentStory), () => {
    if (confirmDeleteOpen) {
      if (!deleting) setConfirmDeleteOpen(false);
    } else if (likersOpen) {
      setLikersOpen(false);
    } else {
      onClose();
    }
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmDeleteOpen) {
          setConfirmDeleteOpen(false);
        } else if (likersOpen) {
          setLikersOpen(false);
        } else {
          onClose();
        }
      } else if (e.key === 'ArrowRight' && !likersOpen && !confirmDeleteOpen) {
        goNext();
      } else if (e.key === 'ArrowLeft' && !likersOpen && !confirmDeleteOpen) {
        goPrev();
      } else if (e.key === ' ' && !likersOpen && !confirmDeleteOpen) {
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [likersOpen, confirmDeleteOpen, goNext, goPrev, onClose]);

  if (!currentStory) return null;

  const isLiked = likedStoryIds.has(currentStory.id);
  const likesCount = Math.max(0, currentStory.likesCount ?? 0);
  const canDelete = Boolean(
    currentUserId && (currentUserId === currentStory.authorId || isAdmin)
  );
  const canViewLikers = Boolean(
    currentUserId && (currentUserId === currentStory.authorId || isAdmin)
  );
  const expiryRemaining = formatStoryExpiryRemaining(currentStory.expiresAt);

  const triggerHeartBurst = () => {
    setHeartBurst(true);
    if (burstTimeoutRef.current) window.clearTimeout(burstTimeoutRef.current);
    burstTimeoutRef.current = window.setTimeout(() => {
      setHeartBurst(false);
    }, 650);
  };

  const handleLikeButtonClick = () => {
    if (!currentUserId) {
      onRequireAuth?.();
      return;
    }
    if (!isLiked) {
      triggerHeartBurst();
    }
    onToggleLikeStory(currentStory);
  };

  const handleCenterZoneTap = () => {
    const now = Date.now();
    if (now - lastCenterTapRef.current < 280) {
      if (singleTapTimerRef.current) {
        window.clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      lastCenterTapRef.current = 0;
      if (!currentUserId) {
        onRequireAuth?.();
        return;
      }
      triggerHeartBurst();
      if (!isLiked) {
        onToggleLikeStory(currentStory);
      }
    } else {
      lastCenterTapRef.current = now;
      if (singleTapTimerRef.current) window.clearTimeout(singleTapTimerRef.current);
      singleTapTimerRef.current = window.setTimeout(() => {
        setPaused((p) => !p);
        singleTapTimerRef.current = null;
      }, 280);
    }
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY, time: Date.now() };
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || e.changedTouches.length !== 1 || likersOpen || confirmDeleteOpen) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;

    if (Math.abs(dx) > 52 && Math.abs(dx) > Math.abs(dy) * 1.25) {
      if (dx < 0) goNext();
      else goPrev();
      return;
    }

    if (dy > 95 && dy > Math.abs(dx) * 1.4) {
      onClose();
    }
  };

  const handleOpenLikers = async () => {
    if (!canViewLikers) return;
    setLikersOpen(true);
    setLoadingLikers(true);
    try {
      const items = await fetchStoryLikers(currentStory.id, currentStory.authorId);
      setLikers(items);
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Could not load likes',
        description: formatUserFriendlyError(err),
      });
    } finally {
      setLoadingLikers(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    setPaused(true);
    try {
      await deleteStory(currentStory.id);
      showToast({ type: 'success', title: 'Story deleted' });
      onStoryDeleted(currentStory.id);
      setConfirmDeleteOpen(false);
      if (stories.length <= 1) {
        onClose();
      } else if (clampedIndex >= stories.length - 1) {
        setIndex(Math.max(0, stories.length - 2));
      }
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Could not delete story',
        description: formatUserFriendlyError(err),
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Story Viewer"
    >
      {/* Desktop prev button */}
      {clampedIndex > 0 && (
        <button
          type="button"
          onClick={goPrev}
          aria-label="Previous story"
          className="hidden sm:flex absolute left-6 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-surface/90 border border-accent/35 text-ink hover:border-accent hover:text-accent items-center justify-center z-20 transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
      )}

      {/* Fullscreen Mobile / 9:16 Desktop Story Card Frame */}
      <div
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        className="relative w-full h-full sm:w-[420px] sm:h-[84vh] sm:max-h-[780px] sm:rounded-3xl overflow-hidden bg-[#050505] border-0 sm:border sm:border-accent/30 shadow-[0_24px_80px_rgba(0,0,0,0.9)] flex flex-col select-none hf-modal-enter"
      >
        {/* Top Overlay: Author-Segmented Progress Bars + Story Header */}
        <div className="absolute top-0 inset-x-0 z-30 px-3.5 pt-[max(0.875rem,env(safe-area-inset-top))] pb-6 bg-gradient-to-b from-black/90 via-black/55 to-transparent">
          {/* Progress Segments for current author's story items */}
          <div className="flex items-center gap-1.5 mb-3">
            {authorSlides.map((slide, idx) => {
              const fill =
                idx < authorSlideIndex
                  ? '100%'
                  : idx === authorSlideIndex
                  ? `${Math.min(100, Math.max(0, progressPct))}%`
                  : '0%';
              return (
                <div
                  key={slide.id}
                  className="flex-1 h-1 rounded-full bg-white/25 overflow-hidden"
                >
                  <div
                    className="h-full bg-accent transition-[width] duration-75 ease-linear"
                    style={{ width: fill }}
                  />
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenProfile(currentStory.authorId);
              }}
              className="flex items-center gap-2.5 min-w-0 text-left group"
            >
              <div className="p-[1.5px] rounded-full bg-gradient-to-tr from-accent-deep via-accent to-accent-soft shrink-0">
                <Avatar
                  src={currentStory.authorAvatarUrl}
                  name={currentStory.authorName}
                  size="sm"
                />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="text-xs font-semibold text-white group-hover:text-amber-300 transition-colors truncate">
                    {currentStory.authorName}
                  </p>
                  {paused && (
                    <span className="text-[10px] font-medium text-amber-300 shrink-0">
                      · Paused
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-white/80 truncate">
                  @{currentStory.authorUsername} · {formatRelativeTime(currentStory.createdAt)}
                  {expiryRemaining && expiryRemaining !== 'Expired' ? ` · ${expiryRemaining}` : ''}
                </p>
              </div>
            </button>

            <div className="flex items-center gap-1 shrink-0">
              {currentStory.mediaType === 'video' && (
                <button
                  type="button"
                  onClick={() => setMuted((m) => !m)}
                  aria-label={muted ? 'Unmute video' : 'Mute video'}
                  className="min-w-[40px] min-h-[40px] rounded-full bg-black/50 flex items-center justify-center text-white hover:text-amber-300 transition-colors"
                >
                  {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
              )}

              <button
                type="button"
                onClick={() => setPaused((p) => !p)}
                aria-label={paused ? 'Resume story' : 'Pause story'}
                className="min-w-[40px] min-h-[40px] rounded-full bg-black/50 flex items-center justify-center text-white hover:text-amber-300 transition-colors"
              >
                {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
              </button>

              {canDelete && (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteOpen(true)}
                  disabled={deleting}
                  aria-label="Delete story"
                  className="min-w-[40px] min-h-[40px] rounded-full bg-black/50 flex items-center justify-center text-rose-400 hover:bg-rose-500/20 disabled:opacity-40 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}

              <button
                type="button"
                onClick={onClose}
                aria-label="Close story viewer"
                className="min-w-[40px] min-h-[40px] rounded-full bg-black/50 flex items-center justify-center text-white hover:text-amber-300 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Media Stage */}
        <div className="relative flex-1 min-h-0 flex items-center justify-center bg-[#050505]">
          {mediaStatus === 'loading' && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2.5 bg-[#050505]">
              <Loader2 className="w-7 h-7 animate-spin text-accent" />
              <span className="text-xs text-white/75">Loading story...</span>
            </div>
          )}

          {mediaStatus === 'error' ? (
            <div className="relative z-20 px-6 text-center space-y-3 max-w-xs">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-surface-2 border border-hairline flex items-center justify-center text-accent">
                <ImageOff className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-ink">
                Story media could not be loaded
              </p>
              <p className="text-xs text-ink-muted">
                Check your connection or move to the next story.
              </p>
              <div className="pt-1 flex items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setMediaStatus('loading');
                    setRetryNonce((n) => n + 1);
                  }}
                  className="min-h-[40px] px-4 py-2 rounded-xl bg-surface-2 border border-accent/40 text-xs font-semibold text-accent inline-flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry</span>
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  className="min-h-[40px] gold-gradient-btn px-4 py-2 rounded-xl text-xs font-bold"
                >
                  Next
                </button>
              </div>
            </div>
          ) : currentStory.mediaType === 'video' ? (
            <video
              ref={videoRef}
              key={`${currentStory.id}-${retryNonce}`}
              src={currentStory.mediaUrl}
              autoPlay
              playsInline
              muted={muted}
              preload="auto"
              onLoadedData={() => setMediaStatus('ready')}
              onCanPlay={() => setMediaStatus('ready')}
              onTimeUpdate={() => {
                const v = videoRef.current;
                if (!v || !Number.isFinite(v.duration) || v.duration <= 0) return;
                setProgressPct(Math.min(100, (v.currentTime / v.duration) * 100));
              }}
              onEnded={goNext}
              onError={() => setMediaStatus('error')}
              className={`w-full h-full object-contain transition-opacity duration-200 ${
                mediaStatus === 'ready' ? 'opacity-100' : 'opacity-0'
              }`}
            />
          ) : (
            <img
              key={`${currentStory.id}-${retryNonce}`}
              src={currentStory.mediaUrl}
              alt={currentStory.caption || `${currentStory.authorName}'s story`}
              referrerPolicy="no-referrer"
              onLoad={() => setMediaStatus('ready')}
              onError={() => setMediaStatus('error')}
              className={`w-full h-full object-cover transition-opacity duration-200 ${
                mediaStatus === 'ready' ? 'opacity-100' : 'opacity-0'
              }`}
            />
          )}

          {/* Double-tap heart burst visual feedback */}
          {heartBurst && (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
              <Heart className="w-20 h-20 fill-rose-500 text-rose-400 drop-shadow-[0_8px_24px_rgba(244,63,94,0.65)] animate-ping" />
            </div>
          )}

          {/* Unified Tap Left / Center / Right Navigation & Pause/Like Zones (works for both Images & Videos) */}
          {mediaStatus !== 'error' && (
            <>
              <button
                type="button"
                aria-label="Previous story"
                onClick={goPrev}
                className="absolute inset-y-24 left-0 w-[28%] z-20 cursor-pointer focus:outline-none"
              />
              <button
                type="button"
                aria-label="Tap to pause or double-tap to like story"
                onClick={handleCenterZoneTap}
                className="absolute inset-y-24 left-[28%] w-[44%] z-20 cursor-pointer focus:outline-none"
              />
              <button
                type="button"
                aria-label="Next story"
                onClick={goNext}
                className="absolute inset-y-24 right-0 w-[28%] z-20 cursor-pointer focus:outline-none"
              />
            </>
          )}
        </div>

        {/* Bottom Caption + Like Controls */}
        <div className="absolute bottom-0 inset-x-0 z-30 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-14 bg-gradient-to-t from-black/95 via-black/75 to-transparent pointer-events-none space-y-3">
          {currentStory.caption && (
            <p className="text-sm text-white leading-relaxed text-center drop-shadow max-w-[36ch] mx-auto">
              {currentStory.caption}
            </p>
          )}

          <div className="flex items-center justify-between gap-3 pointer-events-auto">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                onClick={handleLikeButtonClick}
                aria-label={isLiked ? 'Unlike story' : 'Like story'}
                aria-pressed={isLiked}
                className={`min-h-[42px] inline-flex items-center gap-2 px-4 py-2 rounded-full border text-xs font-semibold transition-all active:scale-95 ${
                  isLiked
                    ? 'bg-rose-500/25 border-rose-400/60 text-rose-200 shadow-[0_4px_16px_rgba(244,63,94,0.28)]'
                    : 'bg-black/70 border-white/25 text-white hover:border-amber-300/70 hover:text-amber-300'
                } backdrop-blur-md`}
              >
                <Heart
                  className={`w-4 h-4 transition-transform ${
                    isLiked ? 'fill-rose-500 text-rose-500 scale-110' : ''
                  }`}
                />
                <span>{isLiked ? 'Liked' : 'Like'}</span>
                {likesCount > 0 && (
                  <span className="font-mono tabular-nums text-[11px] opacity-90">
                    {likesCount}
                  </span>
                )}
              </button>

              {canViewLikers && (
                <button
                  type="button"
                  onClick={handleOpenLikers}
                  className="min-h-[42px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-black/70 border border-white/25 text-xs font-medium text-white hover:border-amber-300/70 hover:text-amber-300 backdrop-blur-md transition-colors"
                >
                  <Users className="w-3.5 h-3.5 text-amber-300" />
                  <span>{likesCount === 0 ? 'No likes yet' : `Liked by ${likesCount}`}</span>
                </button>
              )}
            </div>

            {!canViewLikers && likesCount > 0 && (
              <span className="text-[11px] font-mono text-white/90 bg-black/65 px-3 py-1.5 rounded-full border border-white/20 backdrop-blur-sm tabular-nums">
                {likesCount} {likesCount === 1 ? 'like' : 'likes'}
              </span>
            )}
          </div>
        </div>

        {/* Safe 2-Step Inline Delete Confirmation Sheet */}
        {confirmDeleteOpen && (
          <div className="absolute inset-0 z-40 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-4">
            <div className="w-full max-w-xs rounded-2xl bg-surface border border-rose-500/35 p-5 space-y-4 shadow-2xl text-center">
              <div className="w-11 h-11 mx-auto rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="font-display text-sm font-bold text-ink">
                  Delete this story?
                </h3>
                <p className="text-xs text-ink-muted">
                  This removes the story immediately for all hostel friends.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setConfirmDeleteOpen(false)}
                  className="min-h-[42px] rounded-xl border border-hairline-strong text-xs font-semibold text-ink hover:bg-hover-tint disabled:opacity-50"
                >
                  Keep
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={handleConfirmDelete}
                  className="min-h-[42px] rounded-xl bg-rose-500 hover:bg-rose-600 text-xs font-bold text-ink inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                >
                  {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{deleting ? 'Deleting...' : 'Delete'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Author "Liked by" Sheet */}
        {likersOpen && (
          <div className="absolute inset-x-0 bottom-0 z-40 max-h-[65%] bg-surface/98 border-t border-accent/30 rounded-t-3xl shadow-[0_-16px_40px_rgba(0,0,0,0.85)] flex flex-col pb-[env(safe-area-inset-bottom)]">
            <div className="px-4 py-3.5 border-b border-hairline flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Heart className="w-4 h-4 fill-rose-500 text-rose-500" />
                <span className="font-display text-sm font-semibold text-ink">
                  Liked by {likesCount}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setLikersOpen(false)}
                aria-label="Close likes list"
                className="min-w-[36px] min-h-[36px] rounded-full flex items-center justify-center text-ink-muted hover:text-ink hover:bg-hover-tint"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
              {loadingLikers ? (
                <div className="py-8 flex items-center justify-center gap-2 text-xs text-ink-muted">
                  <Loader2 className="w-4 h-4 animate-spin text-accent" />
                  <span>Loading friends who liked...</span>
                </div>
              ) : likers.length === 0 ? (
                <p className="py-8 text-center text-xs text-ink-muted">
                  No one has liked this story yet.
                </p>
              ) : (
                likers.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setLikersOpen(false);
                      onClose();
                      onOpenProfile(item.userId);
                    }}
                    className="w-full min-h-[48px] flex items-center justify-between gap-3 p-2.5 rounded-xl hover:bg-hover-tint text-left transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar
                        src={item.userAvatarUrl}
                        name={item.userName}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-ink truncate">
                          {item.userName}
                        </p>
                        <p className="text-[11px] text-ink-muted truncate">
                          @{item.userUsername}
                        </p>
                      </div>
                    </div>
                    <span className="text-[10px] text-ink-muted shrink-0">
                      {formatRelativeTime(item.createdAt)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Desktop next button */}
      <button
        type="button"
        onClick={goNext}
        aria-label={clampedIndex < stories.length - 1 ? 'Next story' : 'Finish stories'}
        className="hidden sm:flex absolute right-6 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-surface/90 border border-accent/35 text-ink hover:border-accent hover:text-accent items-center justify-center z-20 transition-colors"
      >
        <ChevronRight className="w-5 h-5" />
      </button>
    </div>
  );
}
