import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  FileText,
  Film,
  Hash,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  RefreshCw,
  Send,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { AspectRatioType, Poll, Post } from '../types';
import {
  checkStorageBucketAvailable,
  formatBytes,
  PreparedMedia,
  prepareMediaForUpload,
  startResumableUpload,
  UploadCancelledError,
  UploadTelemetry,
  validateMediaFile,
} from '../services/mediaService';
import { createPost, fetchPostById } from '../services/postService';
import { parseHashtags } from '../utils/formatters';
import { formatUserFriendlyError } from '../lib/firestoreError';
import { playSound } from '../utils/soundVfx';
import { Avatar } from './Avatar';
import { PollCreator } from './PollCreator';

interface FeedComposerProps {
  onPostCreated: (post: Post | null) => void;
  onPollCreated?: (poll: Poll) => void;
  onOpenFullCreate: () => void;
  onRequireAuth: () => void;
}

type Stage = 'idle' | 'optimizing' | 'uploading' | 'saving' | 'failed';

export function FeedComposer({
  onPostCreated,
  onPollCreated,
  onOpenFullCreate,
  onRequireAuth,
}: FeedComposerProps) {
  const { profile, platformSettings, refreshUserState } = useAuth();
  const { showToast } = useToast();

  const [expanded, setExpanded] = useState(false);
  const [composerMode, setComposerMode] = useState<'post' | 'poll'>('post');
  const [caption, setCaption] = useState('');
  const [hashtagInput, setHashtagInput] = useState('');
  const [showHashtags, setShowHashtags] = useState(false);
  const [prepared, setPrepared] = useState<PreparedMedia | null>(null);
  const [originalFileName, setOriginalFileName] = useState('');
  const [aspectRatio, setAspectRatio] = useState<AspectRatioType>('landscape');
  const [stage, setStage] = useState<Stage>('idle');
  const [optimizingStatus, setOptimizingStatus] = useState<string>('');
  const [optimizingPercent, setOptimizingPercent] = useState<number | null>(null);
  const [telemetry, setTelemetry] = useState<UploadTelemetry | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [instantPreviewUrl, setInstantPreviewUrl] = useState<string | null>(null);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const instantPreviewRef = useRef<string | null>(null);
  const selectionSeqRef = useRef(0);
  const submittingRef = useRef(false);
  const cancelActiveUploadRef = useRef<(() => void) | null>(null);
  const uploadedCacheRef = useRef<{
    fingerprint: string;
    mediaUrl: string;
    thumbnailUrl?: string;
  } | null>(null);

  const revokePreparedUrls = (item: PreparedMedia | null) => {
    if (!item) return;
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    if (item.thumbnailPreviewUrl) URL.revokeObjectURL(item.thumbnailPreviewUrl);
  };

  useEffect(() => {
    return () => {
      cancelActiveUploadRef.current?.();
      if (instantPreviewRef.current) {
        URL.revokeObjectURL(instantPreviewRef.current);
        instantPreviewRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      revokePreparedUrls(prepared);
    };
  }, [prepared]);

  const isBusy = stage === 'optimizing' || stage === 'uploading' || stage === 'saving';
  const parsedTags = parseHashtags(hashtagInput, caption);
  const hasText = caption.trim().length > 0;
  const canPublish = Boolean(prepared || hasText);

  const clearMedia = () => {
    if (submittingRef.current) return;
    selectionSeqRef.current++;
    if (instantPreviewRef.current) {
      URL.revokeObjectURL(instantPreviewRef.current);
      instantPreviewRef.current = null;
    }
    setInstantPreviewUrl(null);
    setPrepared((prev) => {
      revokePreparedUrls(prev);
      return null;
    });
    uploadedCacheRef.current = null;
    setOriginalFileName('');
    setTelemetry(null);
    setStage('idle');
    setErrorMsg('');
  };

  const resetComposer = () => {
    clearMedia();
    setCaption('');
    setHashtagInput('');
    setShowHashtags(false);
    setComposerMode('post');
    setExpanded(false);
  };

  const handleOpenTextComposer = () => {
    if (!profile) {
      onRequireAuth();
      return;
    }
    setComposerMode('post');
    setExpanded(true);
    setTimeout(() => textareaRef.current?.focus(), 40);
  };

  const handleOpenPollComposer = () => {
    if (!profile) {
      onRequireAuth();
      return;
    }
    setErrorMsg('');
    setComposerMode('poll');
    setExpanded(true);
  };

  const handlePickMedia = (kind: 'image' | 'video') => {
    if (!profile) {
      onRequireAuth();
      return;
    }
    if (isBusy) return;
    if (kind === 'image') {
      imageInputRef.current?.click();
    } else {
      videoInputRef.current?.click();
    }
  };

  const handleFileSelected = async (file: File) => {
    if (!profile || submittingRef.current) return;
    setErrorMsg('');
    const validation = validateMediaFile(file, platformSettings.maxUploadSizeMB);
    if (!validation.valid) {
      setExpanded(true);
      setErrorMsg(validation.error || 'Invalid media file.');
      return;
    }

    const seq = ++selectionSeqRef.current;
    uploadedCacheRef.current = null;
    setTelemetry(null);
    setOriginalFileName(file.name);
    setComposerMode('post');
    setExpanded(true);
    setStage('optimizing');

    if (instantPreviewRef.current) {
      URL.revokeObjectURL(instantPreviewRef.current);
      instantPreviewRef.current = null;
    }
    if (validation.mediaType === 'image') {
      const quickUrl = URL.createObjectURL(file);
      instantPreviewRef.current = quickUrl;
      setInstantPreviewUrl(quickUrl);
    } else {
      setInstantPreviewUrl(null);
    }

    try {
      setOptimizingStatus(
        validation.mediaType === 'video' ? 'Inspecting video clip (10s max)...' : 'Optimizing image...'
      );
      setOptimizingPercent(null);
      const nextPrepared = await prepareMediaForUpload(file, {
        folder: 'posts',
        maxDimension: 1280,
        quality: 0.78,
        onVideoProgress: (percent, label) => {
          if (seq !== selectionSeqRef.current) return;
          setOptimizingPercent(percent);
          setOptimizingStatus(label);
        },
      });
      if (seq !== selectionSeqRef.current) {
        revokePreparedUrls(nextPrepared);
        return;
      }
      setPrepared((prev) => {
        revokePreparedUrls(prev);
        return nextPrepared;
      });
      if (instantPreviewRef.current) {
        URL.revokeObjectURL(instantPreviewRef.current);
        instantPreviewRef.current = null;
      }
      setInstantPreviewUrl(null);
      setAspectRatio(nextPrepared.suggestedAspectRatio);
      setStage('idle');
      playSound('ui-tap');
    } catch (err) {
      if (seq !== selectionSeqRef.current) return;
      if (instantPreviewRef.current) {
        URL.revokeObjectURL(instantPreviewRef.current);
        instantPreviewRef.current = null;
      }
      setInstantPreviewUrl(null);
      setStage('idle');
      setErrorMsg(formatUserFriendlyError(err, 'Could not process selected media.'));
    }
  };

  const executePublish = async () => {
    if (!profile || submittingRef.current) return;
    if (!prepared && !hasText) {
      setErrorMsg('Write a post or attach a photo or video to publish.');
      return;
    }

    submittingRef.current = true;
    setErrorMsg('');
    playSound('upload-start');

    try {
      let postId: string;

      if (!prepared) {
        setStage('saving');
        postId = await createPost({
          author: profile,
          mediaUrl: '',
          mediaType: 'text',
          aspectRatio: 'square',
          caption,
          hashtags: parsedTags,
        });
      } else {
        let mediaUrl: string;
        let thumbnailUrl: string | undefined;

        if (uploadedCacheRef.current?.fingerprint === prepared.fingerprint) {
          mediaUrl = uploadedCacheRef.current.mediaUrl;
          thumbnailUrl = uploadedCacheRef.current.thumbnailUrl;
        } else {
          const storageAvailable =
            prepared.mediaType === 'image' && prepared.directDataUrl
              ? await checkStorageBucketAvailable()
              : true;

          if (!storageAvailable && prepared.directDataUrl) {
            mediaUrl = prepared.directDataUrl;
          } else {
            setStage('uploading');
            setTelemetry({
              phase: 'uploading',
              bytesTransferred: 0,
              totalBytes: prepared.optimizedSize,
              percent: 0,
              speedBytesPerSec: 0,
              etaSeconds: null,
              elapsedMs: 0,
              attempt: 1,
            });

            const mainUpload = startResumableUpload({
              file: prepared.uploadFile,
              folder: 'posts',
              userId: profile.uid,
              precomputedDataUrl: prepared.directDataUrl,
              onProgress: (next) => setTelemetry(next),
            });

            const thumbUpload =
              prepared.mediaType === 'video' && prepared.thumbnailFile
                ? startResumableUpload({
                    file: prepared.thumbnailFile,
                    folder: 'thumbnails',
                    userId: profile.uid,
                    maxAutoRetries: 1,
                  })
                : null;

            cancelActiveUploadRef.current = () => {
              mainUpload.cancel();
              thumbUpload?.cancel();
            };

            const [mainRes, thumbRes] = await Promise.all([
              mainUpload.promise,
              thumbUpload ? thumbUpload.promise.catch(() => null) : Promise.resolve(null),
            ]);

            cancelActiveUploadRef.current = null;
            mediaUrl = mainRes.downloadUrl;
            thumbnailUrl = thumbRes?.downloadUrl;
          }

          uploadedCacheRef.current = {
            fingerprint: prepared.fingerprint,
            mediaUrl,
            thumbnailUrl,
          };
        }

        setStage('saving');
        postId = await createPost({
          author: profile,
          mediaUrl,
          thumbnailUrl,
          mediaType: prepared.mediaType,
          aspectRatio,
          caption,
          hashtags: parsedTags,
        });
      }

      const createdPost = await fetchPostById(postId).catch(() => null);
      void refreshUserState();
      playSound('upload-success');
      showToast({
        type: 'success',
        title: 'Post published!',
        description: 'Your post is now live on the Hostel Friend feed.',
      });
      resetComposer();
      onPostCreated(createdPost);
    } catch (err) {
      cancelActiveUploadRef.current = null;
      setStage('failed');
      if (err instanceof UploadCancelledError) {
        playSound('unlike');
        setErrorMsg('Upload cancelled. Your caption and media are still ready.');
      } else {
        playSound('error');
        setErrorMsg(formatUserFriendlyError(err, 'Could not publish your post. Please try again.'));
      }
    } finally {
      submittingRef.current = false;
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canPublish) {
      setErrorMsg('Write something or attach a photo or video first.');
      return;
    }
    void executePublish();
  };

  const firstName = profile?.fullName?.split(' ')[0] || 'Friend';

  return (
    <section
      aria-label="Create a post"
      className="glass-card rounded-2xl p-3.5 sm:p-4"
    >
      {/* Hidden native inputs for 1-tap photo / video selection */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFileSelected(file);
          e.target.value = '';
        }}
        className="hidden"
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFileSelected(file);
          e.target.value = '';
        }}
        className="hidden"
      />

      {!expanded ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Avatar
              src={profile?.avatarUrl}
              name={profile?.fullName || 'Hostel Friend'}
              size="sm"
            />
            <button
              type="button"
              onClick={handleOpenTextComposer}
              className="flex-1 min-h-[44px] px-4 rounded-xl bg-canvas hover:bg-surface-2 border border-hairline hover:border-accent/40 text-left text-sm text-ink-muted hover:text-ink transition-colors truncate"
            >
              Share a moment, {firstName}...
            </button>
          </div>

          <div className="pt-2.5 border-t border-hairline grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              type="button"
              onClick={() => handlePickMedia('image')}
              className="min-h-[42px] px-2.5 rounded-xl glass-btn flex items-center justify-center gap-2 text-xs font-semibold text-ink whitespace-nowrap"
            >
              <ImageIcon className="w-4 h-4 text-accent shrink-0" />
              <span>Photo</span>
            </button>

            <button
              type="button"
              onClick={() => handlePickMedia('video')}
              className="min-h-[42px] px-2.5 rounded-xl glass-btn flex items-center justify-center gap-2 text-xs font-semibold text-ink whitespace-nowrap"
            >
              <Film className="w-4 h-4 text-accent shrink-0" />
              <span>Video</span>
            </button>

            <button
              type="button"
              onClick={handleOpenTextComposer}
              className="min-h-[42px] px-2.5 rounded-xl glass-btn flex items-center justify-center gap-2 text-xs font-semibold text-ink whitespace-nowrap"
            >
              <FileText className="w-4 h-4 text-accent shrink-0" />
              <span>Text Post</span>
            </button>

            <button
              type="button"
              onClick={handleOpenPollComposer}
              className="min-h-[42px] px-2.5 rounded-xl glass-btn flex items-center justify-center gap-2 text-xs font-semibold text-ink whitespace-nowrap"
            >
              <BarChart3 className="w-4 h-4 text-accent shrink-0" />
              <span>Poll</span>
            </button>
          </div>
        </div>
      ) : composerMode === 'poll' ? (
        <PollCreator
          onPollCreated={(createdPoll) => {
            resetComposer();
            onPollCreated?.(createdPoll);
          }}
          onCancel={resetComposer}
        />
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <Avatar
                src={profile?.avatarUrl}
                name={profile?.fullName || 'Hostel Friend'}
                size="sm"
              />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-ink truncate">
                  {profile?.fullName}
                </p>
                <p className="text-[11px] text-ink-muted truncate">
                  Posting to Home Feed
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                disabled={isBusy}
                onClick={onOpenFullCreate}
                title="Open full post studio"
                aria-label="Open full post studio"
                className="min-w-[38px] min-h-[38px] flex items-center justify-center rounded-xl text-ink-muted hover:text-accent hover:bg-hover-tint transition-colors disabled:opacity-40"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={resetComposer}
                aria-label="Close composer"
                className="min-w-[38px] min-h-[38px] flex items-center justify-center rounded-xl text-ink-muted hover:text-ink hover:bg-hover-tint transition-colors disabled:opacity-40"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-300 flex items-center justify-between gap-2"
            >
              <span className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </span>
              {canPublish && stage === 'failed' && (
                <button
                  type="button"
                  onClick={() => void executePublish()}
                  className="px-2.5 py-1 rounded-lg bg-rose-500/20 text-rose-200 font-semibold inline-flex items-center gap-1 shrink-0"
                >
                  <RefreshCw className="w-3 h-3" />
                  Retry
                </button>
              )}
            </div>
          )}

          <textarea
            ref={textareaRef}
            rows={3}
            maxLength={1000}
            disabled={isBusy}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="What's happening in your hostel? Mention peers with @username or add #hashtags..."
            className="w-full rounded-xl bg-canvas border border-hairline px-3.5 py-3 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-accent resize-none disabled:opacity-60"
          />

          {/* Instant / Prepared Media Preview */}
          {stage === 'optimizing' && instantPreviewUrl ? (
            <div className="relative rounded-xl overflow-hidden bg-canvas border border-hairline">
              <img
                src={instantPreviewUrl}
                alt="Optimizing preview"
                className="w-full max-h-[300px] object-contain mx-auto"
              />
              <div className="px-3 py-2 bg-surface border-t border-hairline flex items-center gap-2 text-xs text-accent">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Optimizing image...</span>
              </div>
            </div>
          ) : stage === 'optimizing' && !prepared ? (
            <div className="rounded-xl bg-canvas border border-hairline py-8 px-4 flex flex-col items-center justify-center gap-2.5 text-center">
              <Loader2 className="w-5 h-5 text-accent animate-spin" />
              <p className="text-xs text-ink-muted">
                {optimizingStatus || `Preparing ${originalFileName}...`}
              </p>
              {optimizingPercent !== null && (
                <div className="w-44 h-1.5 rounded-full bg-surface-hover overflow-hidden">
                  <div
                    className="h-full bg-accent transition-all duration-150"
                    style={{ width: `${optimizingPercent}%` }}
                  />
                </div>
              )}
            </div>
          ) : prepared ? (
            <div className="space-y-2.5">
              <div className="relative rounded-xl overflow-hidden bg-canvas border border-hairline">
                {prepared.mediaType === 'video' ? (
                  <video
                    src={prepared.previewUrl}
                    poster={prepared.thumbnailPreviewUrl}
                    controls
                    playsInline
                    preload="metadata"
                    className="w-full max-h-[340px] object-contain mx-auto"
                  />
                ) : (
                  <img
                    src={prepared.previewUrl}
                    alt="Selected post media"
                    className="w-full max-h-[340px] object-contain mx-auto"
                  />
                )}
                {!isBusy && (
                  <button
                    type="button"
                    onClick={clearMedia}
                    aria-label="Remove media"
                    className="min-w-[36px] min-h-[36px] flex items-center justify-center absolute top-2.5 right-2.5 rounded-full bg-black/75 text-white hover:bg-black transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-muted">
                <span className="truncate font-mono tabular-nums">
                  {originalFileName} · {formatBytes(prepared.optimizedSize)} {prepared.formatLabel}
                  {prepared.mediaType === 'video' && prepared.durationSeconds
                    ? ` · ${prepared.durationSeconds.toFixed(1)}s${
                        prepared.wasTrimmed ? ' (first 10s cut)' : ''
                      }`
                    : ''}
                </span>
                <div className="flex items-center gap-1">
                  {(
                    [
                      { id: 'landscape', label: '4:3' },
                      { id: 'square', label: '1:1' },
                      { id: 'portrait', label: '3:4' },
                      { id: 'vertical', label: '9:16' },
                    ] as const
                  ).map((ratio) => (
                    <button
                      key={ratio.id}
                      type="button"
                      disabled={isBusy}
                      onClick={() => setAspectRatio(ratio.id)}
                      className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap ${
                        aspectRatio === ratio.id
                          ? 'bg-accent text-accent-fg'
                          : 'bg-canvas text-ink-muted border border-hairline hover:text-ink'
                      }`}
                    >
                      {ratio.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {showHashtags && (
            <div className="space-y-1.5">
              <input
                type="text"
                disabled={isBusy}
                value={hashtagInput}
                onChange={(e) => setHashtagInput(e.target.value)}
                placeholder="Add hashtags (e.g. hostellife, chai, studyroom)"
                className="w-full rounded-xl bg-canvas border border-hairline px-3.5 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-accent"
              />
              {parsedTags.length > 0 && (
                <p className="text-[11px] text-accent">
                  {parsedTags.map((t) => `#${t}`).join(' · ')}
                </p>
              )}
            </div>
          )}

          {(stage === 'uploading' || stage === 'saving') && (
            <div className="rounded-xl bg-canvas border border-hairline p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-ink">
                  <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />
                  <span>
                    {stage === 'saving' ? 'Publishing post...' : 'Uploading media...'}
                  </span>
                </span>
                <span className="font-mono tabular-nums text-accent font-semibold">
                  {stage === 'saving' ? '100%' : `${telemetry?.percent ?? 0}%`}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-hover-tint overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-accent-deep to-accent transition-[width] duration-150"
                  style={{ width: `${stage === 'saving' ? 100 : telemetry?.percent ?? 0}%` }}
                />
              </div>
              {stage === 'uploading' && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => cancelActiveUploadRef.current?.()}
                    className="text-[11px] text-rose-400 hover:text-rose-300 font-medium"
                  >
                    Cancel Upload
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="pt-2 border-t border-hairline flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => handlePickMedia('image')}
                className="min-h-[38px] px-3 rounded-xl bg-surface-2 hover:bg-surface-hover border border-hairline text-xs font-medium text-ink inline-flex items-center gap-1.5 disabled:opacity-45 whitespace-nowrap"
              >
                <ImageIcon className="w-3.5 h-3.5 text-accent" />
                <span>Photo</span>
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => handlePickMedia('video')}
                className="min-h-[38px] px-3 rounded-xl bg-surface-2 hover:bg-surface-hover border border-hairline text-xs font-medium text-ink inline-flex items-center gap-1.5 disabled:opacity-45 whitespace-nowrap"
              >
                <Film className="w-3.5 h-3.5 text-accent" />
                <span>Video</span>
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => setShowHashtags((s) => !s)}
                className={`min-h-[38px] px-3 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-45 whitespace-nowrap transition-colors ${
                  showHashtags || hashtagInput
                    ? 'bg-accent/12 border-accent/40 text-accent'
                    : 'bg-surface-2 hover:bg-surface-hover border-hairline text-ink'
                }`}
              >
                <Hash className="w-3.5 h-3.5 text-accent" />
                <span>Tags</span>
              </button>
            </div>

            <button
              type="submit"
              disabled={isBusy || !canPublish}
              className="min-h-[40px] gold-gradient-btn px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-45 whitespace-nowrap"
            >
              <Send className="w-3.5 h-3.5" />
              <span>
                {stage === 'uploading'
                  ? `Uploading ${telemetry?.percent ?? 0}%`
                  : stage === 'saving'
                  ? 'Publishing...'
                  : 'Publish Post'}
              </span>
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
