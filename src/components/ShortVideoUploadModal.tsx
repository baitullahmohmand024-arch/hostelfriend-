import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Film,
  Hash,
  Loader2,
  Scissors,
  Sparkles,
  Upload,
  WifiOff,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { AspectRatioType, Post } from '../types';
import {
  checkStorageBucketAvailable,
  formatBytes,
  formatEta,
  formatSpeed,
  MAX_VIDEO_CLIP_SECONDS,
  PreparedMedia,
  prepareVideoForUpload,
  startResumableUpload,
  UploadCancelledError,
  UploadTelemetry,
  validateMediaFile,
} from '../services/mediaService';
import { createPost, fetchPostById } from '../services/postService';
import { Avatar } from './Avatar';
import { formatUserFriendlyError } from '../lib/firestoreError';
import { useModalBackHandler } from '../lib/backNavigation';
import { parseHashtags } from '../utils/formatters';
import { playSound } from '../utils/soundVfx';

interface ShortVideoUploadModalProps {
  open: boolean;
  onClose: () => void;
  onPublished: (createdPost: Post) => void;
  onOpenFullStudio?: () => void;
}

type ModalStage = 'idle' | 'trimming' | 'ready' | 'uploading' | 'saving' | 'failed';

const SHORT_ASPECT_OPTIONS: ReadonlyArray<{ id: AspectRatioType; label: string }> = [
  { id: 'vertical', label: '9:16' },
  { id: 'portrait', label: '3:4' },
  { id: 'square', label: '1:1' },
  { id: 'landscape', label: '4:3' },
];

export function ShortVideoUploadModal({
  open,
  onClose,
  onPublished,
  onOpenFullStudio,
}: ShortVideoUploadModalProps) {
  const { profile, platformSettings, refreshUserState } = useAuth();
  const { showToast } = useToast();

  const [stage, setStage] = useState<ModalStage>('idle');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [prepared, setPrepared] = useState<PreparedMedia | null>(null);
  const [aspectRatio, setAspectRatio] = useState<AspectRatioType>('vertical');
  const [caption, setCaption] = useState('');
  const [hashtagInput, setHashtagInput] = useState('');
  const [trimPercent, setTrimPercent] = useState(0);
  const [trimLabel, setTrimLabel] = useState('');
  const [telemetry, setTelemetry] = useState<UploadTelemetry | null>(null);
  const [statusLabel, setStatusLabel] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [dragActive, setDragActive] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const trimAbortRef = useRef<AbortController | null>(null);
  const cancelUploadRef = useRef<(() => void) | null>(null);
  const submittingRef = useRef(false);
  const preparedRef = useRef<PreparedMedia | null>(null);
  const uploadedCacheRef = useRef<{
    fingerprint: string;
    mediaUrl: string;
    thumbnailUrl?: string;
  } | null>(null);

  preparedRef.current = prepared;

  const revokePreparedUrls = (media: PreparedMedia | null) => {
    if (!media) return;
    if (media.previewUrl) URL.revokeObjectURL(media.previewUrl);
    if (media.thumbnailPreviewUrl) URL.revokeObjectURL(media.thumbnailPreviewUrl);
  };

  const resetAllState = () => {
    trimAbortRef.current?.abort();
    trimAbortRef.current = null;
    cancelUploadRef.current?.();
    cancelUploadRef.current = null;
    submittingRef.current = false;
    revokePreparedUrls(preparedRef.current);
    uploadedCacheRef.current = null;
    setSelectedFile(null);
    setPrepared(null);
    setAspectRatio('vertical');
    setCaption('');
    setHashtagInput('');
    setTrimPercent(0);
    setTrimLabel('');
    setTelemetry(null);
    setStatusLabel('');
    setErrorMsg('');
    setDragActive(false);
    setStage('idle');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  useEffect(() => {
    if (open) {
      void checkStorageBucketAvailable();
    } else {
      resetAllState();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    return () => {
      trimAbortRef.current?.abort();
      cancelUploadRef.current?.();
      revokePreparedUrls(preparedRef.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stage !== 'uploading' && stage !== 'saving') {
        e.stopPropagation();
        handleCloseRequest();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, stage]);

  const parsedTags = useMemo(
    () => parseHashtags(hashtagInput, caption),
    [hashtagInput, caption]
  );

  const suggestedTags = useMemo(() => {
    const merged = [
      ...platformSettings.featuredHashtags,
      'moments',
      'hostellife',
      'campus',
      'shorts',
      'music',
    ];
    const seen = new Set<string>();
    return merged
      .map((t) => t.replace(/^#/, '').trim().toLowerCase())
      .filter((t) => {
        if (!t || seen.has(t)) return false;
        seen.add(t);
        return true;
      })
      .slice(0, 8);
  }, [platformSettings.featuredHashtags]);

  const handleCloseRequest = () => {
    if (stage === 'uploading' || stage === 'saving') return;
    if (stage === 'trimming') {
      trimAbortRef.current?.abort();
    }
    resetAllState();
    onClose();
  };

  useModalBackHandler(open, handleCloseRequest);

  const handleCancelTrim = () => {
    trimAbortRef.current?.abort();
    trimAbortRef.current = null;
    revokePreparedUrls(preparedRef.current);
    setSelectedFile(null);
    setPrepared(null);
    setTrimPercent(0);
    setTrimLabel('');
    setErrorMsg('Video clipping cancelled. You can choose another clip anytime.');
    setStage('idle');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleCancelUpload = () => {
    cancelUploadRef.current?.();
    cancelUploadRef.current = null;
    submittingRef.current = false;
    setTelemetry(null);
    setStatusLabel('');
    setStage(prepared ? 'ready' : 'idle');
    showToast({ type: 'info', title: 'Upload cancelled' });
  };

  const handleChooseVideo = async (file: File | undefined | null) => {
    if (!file || stage === 'uploading' || stage === 'saving') return;
    setErrorMsg('');

    const check = validateMediaFile(file, platformSettings.maxUploadSizeMB);
    if (!check.valid) {
      setErrorMsg(check.error || 'Unsupported video file.');
      return;
    }
    if (check.mediaType !== 'video') {
      setErrorMsg('Short Videos only accepts video clips (MP4, WebM, MOV).');
      return;
    }

    trimAbortRef.current?.abort();
    const abortCtrl = new AbortController();
    trimAbortRef.current = abortCtrl;

    revokePreparedUrls(preparedRef.current);
    uploadedCacheRef.current = null;
    setPrepared(null);
    setSelectedFile(file);
    setTrimPercent(4);
    setTrimLabel('Inspecting video length...');
    setStage('trimming');
    playSound('ui-tap');

    try {
      const result = await prepareVideoForUpload(file, {
        maxDurationSeconds: MAX_VIDEO_CLIP_SECONDS,
        signal: abortCtrl.signal,
        onProgress: (percent, label) => {
          setTrimPercent(percent);
          setTrimLabel(label);
        },
      });

      if (abortCtrl.signal.aborted) {
        revokePreparedUrls(result);
        return;
      }

      setPrepared(result);
      setAspectRatio(result.suggestedAspectRatio || 'vertical');
      setStage('ready');

      if (result.wasTrimmed) {
        showToast({
          type: 'info',
          title: `First ${MAX_VIDEO_CLIP_SECONDS}s clip ready`,
          description: result.originalDurationSeconds
            ? `Automatically cut from ${Math.round(result.originalDurationSeconds)}s to the first ${MAX_VIDEO_CLIP_SECONDS}s.`
            : `Automatically cut to the first ${MAX_VIDEO_CLIP_SECONDS} seconds.`,
        });
      }
    } catch (err) {
      if (err instanceof UploadCancelledError || abortCtrl.signal.aborted) {
        return;
      }
      setSelectedFile(null);
      setPrepared(null);
      setStage('idle');
      setErrorMsg(
        formatUserFriendlyError(
          err,
          `Could not prepare this video. Please select an MP4, WebM, or MOV clip.`
        )
      );
    } finally {
      if (trimAbortRef.current === abortCtrl) {
        trimAbortRef.current = null;
      }
    }
  };

  const handleClearPreparedVideo = () => {
    if (stage === 'uploading' || stage === 'saving') return;
    revokePreparedUrls(preparedRef.current);
    uploadedCacheRef.current = null;
    setPrepared(null);
    setSelectedFile(null);
    setErrorMsg('');
    setStage('idle');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleAddSuggestedTag = (tag: string) => {
    const clean = tag.replace(/^#/, '').toLowerCase();
    const existing = parseHashtags(hashtagInput, '');
    if (existing.includes(clean)) return;
    setHashtagInput((prev) => (prev.trim() ? `${prev.trim()} #${clean}` : `#${clean}`));
    playSound('ui-tap');
  };

  const handlePublishShort = async () => {
    if (submittingRef.current || !profile || !prepared) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setErrorMsg('You are offline. Reconnect to Wi-Fi or mobile data and try publishing again.');
      setStage('failed');
      return;
    }

    submittingRef.current = true;
    setErrorMsg('');
    setTelemetry(null);

    try {
      let mediaUrl = '';
      let thumbnailUrl: string | undefined;

      if (uploadedCacheRef.current?.fingerprint === prepared.fingerprint) {
        mediaUrl = uploadedCacheRef.current.mediaUrl;
        thumbnailUrl = uploadedCacheRef.current.thumbnailUrl;
      } else {
        setStage('uploading');
        setStatusLabel('Uploading 10s short video...');

        const thumbPromise = prepared.thumbnailFile
          ? startResumableUpload({
              file: prepared.thumbnailFile,
              folder: 'thumbnails',
              userId: profile.uid,
              maxAutoRetries: 1,
            })
              .promise.then((res) => res.downloadUrl)
              .catch(() => undefined)
          : Promise.resolve(undefined);

        const videoUpload = startResumableUpload({
          file: prepared.uploadFile,
          folder: 'posts',
          userId: profile.uid,
          onProgress: (t) => setTelemetry(t),
          maxAutoRetries: 2,
        });
        cancelUploadRef.current = videoUpload.cancel;

        const [videoResult, resolvedThumbUrl] = await Promise.all([
          videoUpload.promise,
          thumbPromise,
        ]);
        cancelUploadRef.current = null;
        mediaUrl = videoResult.downloadUrl;
        thumbnailUrl = resolvedThumbUrl;
        uploadedCacheRef.current = {
          fingerprint: prepared.fingerprint,
          mediaUrl,
          thumbnailUrl,
        };
      }

      setStage('saving');
      setStatusLabel('Publishing to Moments feed...');

      const postId = await createPost({
        author: profile,
        mediaUrl,
        thumbnailUrl,
        mediaType: 'video',
        aspectRatio,
        caption: caption.trim(),
        hashtags: parsedTags,
      });

      await refreshUserState();
      const fetched = await fetchPostById(postId).catch(() => null);
      const createdPost: Post = fetched || {
        id: postId,
        authorId: profile.uid,
        authorUsername: profile.username,
        authorName: profile.fullName,
        authorAvatarUrl: profile.avatarUrl,
        mediaUrl,
        thumbnailUrl,
        mediaType: 'video',
        aspectRatio,
        caption: caption.trim(),
        hashtags: parsedTags,
        visibility: 'public',
        likesCount: 0,
        commentsCount: 0,
        createdAt: null,
        updatedAt: null,
      };

      playSound('upload-success');
      showToast({
        type: 'success',
        title: 'Short Video published!',
        description: 'Your 10-second clip is now live in Moments.',
      });

      submittingRef.current = false;
      onPublished(createdPost);
      resetAllState();
      onClose();
    } catch (err) {
      cancelUploadRef.current = null;
      submittingRef.current = false;
      if (err instanceof UploadCancelledError) {
        setStage('ready');
        setTelemetry(null);
        return;
      }
      setStage('failed');
      setErrorMsg(
        formatUserFriendlyError(
          err,
          'Could not upload your short video. Check your connection and tap Retry.'
        )
      );
    }
  };

  if (!open || !profile) return null;

  const isBusy = stage === 'trimming' || stage === 'uploading' || stage === 'saving';
  const durationLabel = prepared?.durationSeconds
    ? `${Math.min(MAX_VIDEO_CLIP_SECONDS, prepared.durationSeconds).toFixed(1).replace(/\.0$/, '')}s`
    : `≤${MAX_VIDEO_CLIP_SECONDS}s`;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Upload Short Video"
      onClick={handleCloseRequest}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-xl max-h-[92dvh] glass-modal hf-modal-enter rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col border border-hairline-strong"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-hairline flex items-center justify-between gap-3 bg-surface-2/80">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar src={profile.avatarUrl} name={profile.fullName} size="sm" />
            <div className="min-w-0">
              <h2 className="font-display text-base font-bold text-ink flex items-center gap-1.5">
                <Film className="w-4 h-4 text-accent shrink-0" />
                <span className="truncate">Upload Short Video</span>
              </h2>
              <p className="text-[11px] text-ink-muted truncate">
                Auto-cuts first {MAX_VIDEO_CLIP_SECONDS}s of any video · Max{' '}
                {platformSettings.maxUploadSizeMB} MB
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleCloseRequest}
            disabled={stage === 'uploading' || stage === 'saving'}
            aria-label="Close short video upload"
            className="min-w-[40px] min-h-[40px] rounded-full glass-btn text-ink-muted hover:text-ink flex items-center justify-center shrink-0 disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {errorMsg && (
            <div className="rounded-2xl bg-red-500/12 border border-red-400/35 px-3.5 py-3 flex items-start gap-2.5 text-xs text-red-200">
              {typeof navigator !== 'undefined' && navigator.onLine === false ? (
                <WifiOff className="w-4 h-4 text-red-300 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-300 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 leading-relaxed">{errorMsg}</div>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              void handleChooseVideo(f);
            }}
          />

          {/* Stage: Idle / Dropzone */}
          {stage === 'idle' && !prepared && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                void handleChooseVideo(e.dataTransfer.files?.[0]);
              }}
              className={`rounded-2xl border-2 border-dashed p-7 text-center transition-colors ${
                dragActive
                  ? 'border-accent bg-accent/10'
                  : 'border-hairline-strong bg-canvas-alt/70 hover:border-accent/55'
              }`}
            >
              <div className="w-14 h-14 mx-auto rounded-2xl bg-accent/15 border border-accent/35 text-accent flex items-center justify-center mb-3.5">
                <Upload className="w-6 h-6" />
              </div>
              <h3 className="font-display text-base font-bold text-ink">
                Select a video from your device
              </h3>
              <p className="mt-1.5 text-xs text-ink-muted max-w-sm mx-auto leading-relaxed">
                Videos longer than {MAX_VIDEO_CLIP_SECONDS} seconds are automatically trimmed to{' '}
                <span className="text-accent font-semibold">
                  only their first {MAX_VIDEO_CLIP_SECONDS} seconds
                </span>{' '}
                before preview and upload.
              </p>

              <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="gold-gradient-btn min-h-[44px] px-5 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center gap-2"
                >
                  <Film className="w-4 h-4" />
                  <span>Choose Video</span>
                </button>
                {onOpenFullStudio && (
                  <button
                    type="button"
                    onClick={() => {
                      handleCloseRequest();
                      onOpenFullStudio();
                    }}
                    className="glass-btn min-h-[44px] px-4 py-2.5 rounded-xl text-xs font-semibold text-ink-2 hover:text-accent"
                  >
                    Open Full Post Studio
                  </button>
                )}
              </div>

              <p className="mt-4 text-[11px] font-mono text-ink-subtle">
                MP4 · WebM · MOV · Max {MAX_VIDEO_CLIP_SECONDS}s clip · Up to{' '}
                {platformSettings.maxUploadSizeMB} MB
              </p>
            </div>
          )}

          {/* Stage: Trimming */}
          {stage === 'trimming' && (
            <div className="rounded-2xl glass-card p-6 text-center space-y-4">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-accent/15 border border-accent/35 text-accent flex items-center justify-center">
                <Scissors className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <p className="font-display text-sm font-bold text-ink">
                  {trimLabel || `Cutting first ${MAX_VIDEO_CLIP_SECONDS}s clip...`}
                </p>
                <p className="mt-1 text-xs text-ink-muted truncate">
                  {selectedFile?.name}
                </p>
              </div>
              <div className="w-full h-2.5 rounded-full bg-canvas border border-hairline overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-accent-soft via-accent to-accent-deep transition-all duration-150"
                  style={{ width: `${Math.max(4, Math.min(100, trimPercent))}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] font-mono text-ink-muted">
                <span>Preparing {MAX_VIDEO_CLIP_SECONDS}s limit</span>
                <span>{trimPercent}%</span>
              </div>
              <button
                type="button"
                onClick={handleCancelTrim}
                className="min-h-[40px] px-4 rounded-xl glass-btn text-xs font-semibold text-ink-2 hover:text-red-300"
              >
                Cancel Clipping
              </button>
            </div>
          )}

          {/* Stage: Ready / Uploading / Failed Preview & Metadata */}
          {prepared && stage !== 'trimming' && (
            <div className="space-y-4">
              <div className="rounded-2xl overflow-hidden bg-black border border-hairline-strong relative">
                <video
                  src={prepared.previewUrl}
                  poster={prepared.thumbnailPreviewUrl}
                  controls
                  playsInline
                  loop
                  muted
                  className="w-full max-h-[300px] object-contain mx-auto bg-black"
                />
                {!isBusy && (
                  <button
                    type="button"
                    onClick={handleClearPreparedVideo}
                    aria-label="Remove video and select another"
                    className="absolute top-3 right-3 min-w-[38px] min-h-[38px] rounded-full bg-black/70 backdrop-blur-md border border-white/20 text-white hover:bg-black/90 flex items-center justify-center"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Clip Metadata Line (no pills, clean dot separators) */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-ink-muted">
                <div className="flex flex-wrap items-center gap-1.5 font-mono tabular-nums">
                  <span className="text-accent font-semibold">{durationLabel}</span>
                  <span>·</span>
                  <span>{prepared.formatLabel}</span>
                  <span>·</span>
                  <span>{formatBytes(prepared.optimizedSize)}</span>
                  {prepared.wasTrimmed && (
                    <>
                      <span>·</span>
                      <span className="text-emerald-300 font-sans font-medium">
                        First {MAX_VIDEO_CLIP_SECONDS}s auto-cut
                        {prepared.originalDurationSeconds
                          ? ` from ${Math.round(prepared.originalDurationSeconds)}s`
                          : ''}
                      </span>
                    </>
                  )}
                </div>

                {/* Aspect Ratio Chooser */}
                <div className="flex items-center gap-1">
                  {SHORT_ASPECT_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      disabled={isBusy}
                      onClick={() => setAspectRatio(opt.id)}
                      className={`px-2 py-1 rounded-lg text-[11px] font-mono transition-colors ${
                        aspectRatio === opt.id
                          ? 'bg-accent text-accent-fg font-bold'
                          : 'bg-canvas-alt border border-hairline text-ink-muted hover:text-ink'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Caption */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="short-video-caption" className="text-xs font-semibold text-ink-2">
                    Caption
                  </label>
                  <span className="text-[11px] font-mono tabular-nums text-ink-subtle">
                    {caption.length}/1000
                  </span>
                </div>
                <textarea
                  id="short-video-caption"
                  rows={3}
                  maxLength={1000}
                  disabled={isBusy}
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Share what's happening in this 10s moment..."
                  className="w-full rounded-xl bg-canvas-alt border border-hairline px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-accent-strong resize-none disabled:opacity-60"
                />
              </div>

              {/* Optional Hashtags */}
              <div>
                <label
                  htmlFor="short-video-hashtags"
                  className="text-xs font-semibold text-ink-2 flex items-center gap-1.5 mb-1.5"
                >
                  <Hash className="w-3.5 h-3.5 text-accent" />
                  <span>Hashtags (optional)</span>
                </label>
                <input
                  id="short-video-hashtags"
                  type="text"
                  disabled={isBusy}
                  value={hashtagInput}
                  onChange={(e) => setHashtagInput(e.target.value)}
                  placeholder="#hostellife #rooftop #campus"
                  className="w-full rounded-xl bg-canvas-alt border border-hairline px-3.5 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-accent-strong disabled:opacity-60"
                />
                {suggestedTags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {suggestedTags.map((tag) => {
                      const active = parsedTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          disabled={isBusy || active}
                          onClick={() => handleAddSuggestedTag(tag)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                            active
                              ? 'bg-accent/20 text-accent border border-accent/40'
                              : 'bg-canvas-alt border border-hairline text-ink-muted hover:text-ink hover:border-accent/40'
                          }`}
                        >
                          #{tag}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Live Upload Progress */}
              {(stage === 'uploading' || stage === 'saving') && (
                <div className="rounded-2xl glass-card p-3.5 space-y-2 border border-accent/30">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-ink flex items-center gap-1.5">
                      <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />
                      {statusLabel || 'Uploading clip...'}
                    </span>
                    <span className="font-mono tabular-nums text-accent font-semibold">
                      {stage === 'saving' ? '100%' : `${telemetry?.percent ?? 0}%`}
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-canvas overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-accent-soft via-accent to-accent-deep transition-all duration-150"
                      style={{
                        width: `${stage === 'saving' ? 100 : Math.max(4, telemetry?.percent ?? 0)}%`,
                      }}
                    />
                  </div>
                  {telemetry && stage === 'uploading' && (
                    <div className="flex flex-wrap items-center justify-between text-[11px] font-mono text-ink-muted">
                      <span>
                        {formatBytes(telemetry.bytesTransferred)} / {formatBytes(telemetry.totalBytes)}
                      </span>
                      <span>
                        {formatSpeed(telemetry.speedBytesPerSec)}{' '}
                        {telemetry.etaSeconds ? `· ${formatEta(telemetry.etaSeconds)}` : ''}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 border-t border-hairline bg-surface-2/80 flex items-center justify-between gap-3">
          {stage === 'uploading' ? (
            <>
              <span className="text-xs text-ink-muted">Uploading clipped short video...</span>
              <button
                type="button"
                onClick={handleCancelUpload}
                className="min-h-[42px] px-4 rounded-xl glass-btn text-xs font-semibold text-red-300 hover:bg-red-500/15"
              >
                Cancel Upload
              </button>
            </>
          ) : stage === 'saving' ? (
            <div className="w-full flex items-center justify-center gap-2 py-1 text-xs font-semibold text-accent">
              <Sparkles className="w-4 h-4 animate-pulse" />
              <span>Saving to Hostel Friend Moments...</span>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={handleCloseRequest}
                className="min-h-[42px] px-4 rounded-xl glass-btn text-xs font-semibold text-ink-muted hover:text-ink"
              >
                Cancel
              </button>

              {prepared && (
                <button
                  type="button"
                  onClick={() => void handlePublishShort()}
                  disabled={stage === 'trimming'}
                  className="gold-gradient-btn min-h-[44px] px-5 py-2 rounded-xl text-sm font-bold inline-flex items-center gap-2 disabled:opacity-40"
                >
                  <Check className="w-4 h-4" />
                  <span>{stage === 'failed' ? 'Retry Publish' : 'Publish Short Video'}</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
