import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bookmark,
  Check,
  Crop,
  Eye,
  FileText,
  Film,
  Globe,
  Hash,
  Heart,
  Image as ImageIcon,
  Loader2,
  MapPin,
  MessageCircle,
  Plus,
  RefreshCw,
  Send,
  Share2,
  Smile,
  Trash2,
  Upload,
  WifiOff,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { AspectRatioType } from '../types';
import {
  checkStorageBucketAvailable,
  formatBytes,
  formatEta,
  formatSpeed,
  PreparedMedia,
  prepareMediaForUpload,
  startResumableUpload,
  supportsWebPEncoding,
  UploadCancelledError,
  UploadTelemetry,
  validateMediaFile,
} from '../services/mediaService';
import { createPost } from '../services/postService';
import { Avatar } from '../components/Avatar';
import { MediaCropModal } from '../components/MediaCropModal';
import { PollCreator } from '../components/PollCreator';
import {
  buildFinalCaption,
  clearAutosaveDraft,
  COMMON_CAMPUS_SPOTS,
  DEFAULT_CROP_CONFIG,
  deletePostDraft,
  EMOJI_QUICK_BAR,
  ImageCropConfig,
  isCropModified,
  loadAutosaveDraft,
  loadPostDrafts,
  PostDraft,
  renderCroppedImageFile,
  saveAutosaveDraft,
  savePostDraft,
  TEXT_POST_TEMPLATES,
} from '../utils/postComposerHelpers';
import { formatRelativeTime, parseHashtags } from '../utils/formatters';
import { formatUserFriendlyError } from '../lib/firestoreError';
import { playSound } from '../utils/soundVfx';

interface CreatePostPageProps {
  onPublished: () => void;
  onCancel: () => void;
}

type ComposerMode = 'media' | 'text' | 'poll';
type PublishStage = 'idle' | 'optimizing' | 'uploading' | 'saving' | 'failed';

interface ComposerMediaItem {
  id: string;
  originalFile: File;
  originalFileName: string;
  mediaType: 'image' | 'video';
  cropConfig: ImageCropConfig;
  aspectRatio: AspectRatioType;
  prepared: PreparedMedia | null;
  instantPreviewUrl: string | null;
  optimizing: boolean;
  optimizingLabel?: string;
  optimizingPercent?: number;
  published: boolean;
  uploaded?: {
    fingerprint: string;
    mediaUrl: string;
    thumbnailUrl?: string;
  };
}

const MAX_PHOTOS_PER_BATCH = 4;

const ASPECT_RATIO_OPTIONS: ReadonlyArray<{ id: AspectRatioType; label: string }> = [
  { id: 'landscape', label: '4:3' },
  { id: 'square', label: '1:1' },
  { id: 'portrait', label: '3:4' },
  { id: 'vertical', label: '9:16' },
];

export function CreatePostPage({ onPublished, onCancel }: CreatePostPageProps) {
  const { profile, privateSettings, platformSettings, refreshUserState } = useAuth();
  const { showToast } = useToast();

  const [composerMode, setComposerMode] = useState<ComposerMode>('media');
  const [mediaItems, setMediaItems] = useState<ComposerMediaItem[]>([]);
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);
  const [caption, setCaption] = useState('');
  const [hashtagInput, setHashtagInput] = useState('');
  const [locationTag, setLocationTag] = useState('');
  const [customLocationInput, setCustomLocationInput] = useState('');
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);

  const [cropTargetId, setCropTargetId] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<PostDraft[]>(() => loadPostDrafts(profile?.uid));
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [autosaveCandidate, setAutosaveCandidate] = useState<PostDraft | null>(() =>
    loadAutosaveDraft(profile?.uid)
  );

  const [stage, setStage] = useState<PublishStage>('idle');
  const [publishingProgressLabel, setPublishingProgressLabel] = useState('');
  const [telemetry, setTelemetry] = useState<UploadTelemetry | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [dragActive, setDragActive] = useState(false);

  const captionRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaItemsRef = useRef<ComposerMediaItem[]>([]);
  const submittingRef = useRef(false);
  const cancelActiveUploadRef = useRef<(() => void) | null>(null);
  const unmountedRef = useRef(false);

  mediaItemsRef.current = mediaItems;

  const revokeItemUrls = (item: ComposerMediaItem) => {
    if (item.instantPreviewUrl) URL.revokeObjectURL(item.instantPreviewUrl);
    if (item.prepared?.previewUrl) URL.revokeObjectURL(item.prepared.previewUrl);
    if (item.prepared?.thumbnailPreviewUrl) URL.revokeObjectURL(item.prepared.thumbnailPreviewUrl);
  };

  useEffect(() => {
    unmountedRef.current = false;
    void checkStorageBucketAvailable();
    void supportsWebPEncoding();
    return () => {
      unmountedRef.current = true;
      cancelActiveUploadRef.current?.();
      for (const item of mediaItemsRef.current) {
        revokeItemUrls(item);
      }
    };
  }, []);

  useEffect(() => {
    setDrafts(loadPostDrafts(profile?.uid));
    setAutosaveCandidate(loadAutosaveDraft(profile?.uid));
  }, [profile?.uid]);

  // Autosave text/tags/location silently with debounce
  useEffect(() => {
    if (stage === 'uploading' || stage === 'saving') return;
    const timer = window.setTimeout(() => {
      saveAutosaveDraft(profile?.uid, {
        composerMode: composerMode === 'poll' ? 'text' : composerMode,
        caption,
        hashtagInput,
        aspectRatio: mediaItems[0]?.aspectRatio || 'landscape',
        locationTag,
        updatedAt: Date.now(),
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [profile?.uid, composerMode, caption, hashtagInput, locationTag, mediaItems, stage]);

  const activeMedia = mediaItems[activeMediaIndex] || mediaItems[0] || null;
  const anyOptimizing = mediaItems.some((m) => m.optimizing);
  const isBusy = anyOptimizing || stage === 'optimizing' || stage === 'uploading' || stage === 'saving';

  const finalCaption = useMemo(
    () => buildFinalCaption(caption, locationTag),
    [caption, locationTag]
  );
  const parsedTags = useMemo(
    () => parseHashtags(hashtagInput, finalCaption),
    [hashtagInput, finalCaption]
  );

  const locationSuffixLength = locationTag.trim() ? `\n\n📍 ${locationTag.trim()}`.length : 0;
  const maxBodyChars = Math.max(200, 1000 - locationSuffixLength);

  const hasText = finalCaption.trim().length > 0;
  const hasReadyMedia = mediaItems.some((m) => Boolean(m.prepared));
  const isTextOnlyPublish = composerMode === 'text' || (!hasReadyMedia && hasText);
  const canPublish = Boolean((hasReadyMedia || hasText) && !anyOptimizing);

  const suggestedTags = useMemo(() => {
    const merged = [
      ...platformSettings.featuredHashtags,
      'hostellife',
      'campus',
      'chai',
      'latenightstudy',
      'memories',
    ];
    const seen = new Set<string>();
    return merged
      .map((t) => t.replace(/^#/, '').trim().toLowerCase())
      .filter((t) => {
        if (!t || seen.has(t)) return false;
        seen.add(t);
        return true;
      })
      .slice(0, 10);
  }, [platformSettings.featuredHashtags]);

  const campusSpotSuggestions = useMemo(() => {
    const list: string[] = [];
    if (profile?.hostel?.trim()) {
      list.push(profile.hostel.trim());
    }
    for (const spot of COMMON_CAMPUS_SPOTS) {
      if (!list.some((existing) => existing.toLowerCase() === spot.toLowerCase())) {
        list.push(spot);
      }
    }
    return list;
  }, [profile?.hostel]);

  const firstName = profile?.fullName?.split(' ')[0] || 'Friend';

  const processItemMedia = async (itemId: string, sourceFile: File, cropConfig: ImageCropConfig) => {
    try {
      const processedSource =
        sourceFile.type.startsWith('image/') && isCropModified(cropConfig)
          ? await renderCroppedImageFile(sourceFile, cropConfig)
          : sourceFile;

      const prepared = await prepareMediaForUpload(processedSource, {
        folder: 'posts',
        maxDimension: 1280,
        quality: 0.78,
        onVideoProgress: (percent, label) => {
          if (unmountedRef.current) return;
          setMediaItems((prev) =>
            prev.map((m) =>
              m.id === itemId
                ? { ...m, optimizingLabel: label, optimizingPercent: percent }
                : m
            )
          );
        },
      });

      if (unmountedRef.current) {
        if (prepared.previewUrl) URL.revokeObjectURL(prepared.previewUrl);
        if (prepared.thumbnailPreviewUrl) URL.revokeObjectURL(prepared.thumbnailPreviewUrl);
        return;
      }

      setMediaItems((prev) =>
        prev.map((item) => {
          if (item.id !== itemId) return item;
          if (item.instantPreviewUrl) URL.revokeObjectURL(item.instantPreviewUrl);
          if (item.prepared?.previewUrl) URL.revokeObjectURL(item.prepared.previewUrl);
          if (item.prepared?.thumbnailPreviewUrl) {
            URL.revokeObjectURL(item.prepared.thumbnailPreviewUrl);
          }
          const resolvedAspect: AspectRatioType =
            cropConfig.aspectRatio !== 'original'
              ? cropConfig.aspectRatio
              : prepared.suggestedAspectRatio;
          return {
            ...item,
            cropConfig,
            aspectRatio: resolvedAspect,
            prepared,
            instantPreviewUrl: null,
            optimizing: false,
            uploaded: undefined,
          };
        })
      );
    } catch (err) {
      if (unmountedRef.current) return;
      setMediaItems((prev) =>
        prev.filter((item) => {
          if (item.id !== itemId) return true;
          revokeItemUrls(item);
          return false;
        })
      );
      setErrorMsg(formatUserFriendlyError(err, 'Could not prepare the selected media file.'));
    }
  };

  const handleFilesSelected = (fileList: FileList | File[]) => {
    if (submittingRef.current) return;
    setErrorMsg('');
    setAutosaveCandidate(null);
    const incomingFiles = Array.from(fileList);
    if (incomingFiles.length === 0) return;

    const firstValidation = validateMediaFile(incomingFiles[0], platformSettings.maxUploadSizeMB);
    if (!firstValidation.valid) {
      setErrorMsg(firstValidation.error || 'Invalid media file.');
      return;
    }

    // Video mode: 1 video at a time cleanly
    if (firstValidation.mediaType === 'video') {
      const videoFile = incomingFiles[0];
      const itemId = `media_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const newItem: ComposerMediaItem = {
        id: itemId,
        originalFile: videoFile,
        originalFileName: videoFile.name,
        mediaType: 'video',
        cropConfig: DEFAULT_CROP_CONFIG,
        aspectRatio: 'vertical',
        prepared: null,
        instantPreviewUrl: null,
        optimizing: true,
        published: false,
      };
      setMediaItems((prev) => {
        prev.forEach(revokeItemUrls);
        return [newItem];
      });
      setActiveMediaIndex(0);
      setComposerMode('media');
      playSound('ui-tap');
      void processItemMedia(itemId, videoFile, DEFAULT_CROP_CONFIG);
      return;
    }

    // Image mode: support adding up to MAX_PHOTOS_PER_BATCH photos
    const existingImages = mediaItems.filter((m) => m.mediaType === 'image');
    const availableSlots = MAX_PHOTOS_PER_BATCH - existingImages.length;
    if (availableSlots <= 0) {
      setErrorMsg(`You can attach up to ${MAX_PHOTOS_PER_BATCH} photos in one batch.`);
      return;
    }

    const acceptedImages: File[] = [];
    for (const file of incomingFiles) {
      if (acceptedImages.length >= availableSlots) break;
      const check = validateMediaFile(file, platformSettings.maxUploadSizeMB);
      if (!check.valid) {
        setErrorMsg(check.error || 'One of the selected files could not be added.');
        continue;
      }
      if (check.mediaType === 'image') {
        acceptedImages.push(file);
      } else {
        setErrorMsg('Videos must be uploaded separately from photo batches.');
      }
    }

    if (acceptedImages.length === 0) return;

    const createdItems: ComposerMediaItem[] = acceptedImages.map((file) => ({
      id: `media_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      originalFile: file,
      originalFileName: file.name,
      mediaType: 'image',
      cropConfig: DEFAULT_CROP_CONFIG,
      aspectRatio: 'landscape',
      prepared: null,
      instantPreviewUrl: URL.createObjectURL(file),
      optimizing: true,
      published: false,
    }));

    setMediaItems((prev) => {
      const onlyImages = prev.filter((item) => {
        if (item.mediaType === 'video') {
          revokeItemUrls(item);
          return false;
        }
        return true;
      });
      const next = [...onlyImages, ...createdItems].slice(0, MAX_PHOTOS_PER_BATCH);
      setActiveMediaIndex(onlyImages.length);
      return next;
    });
    setComposerMode('media');
    playSound('ui-tap');

    for (const item of createdItems) {
      void processItemMedia(item.id, item.originalFile, DEFAULT_CROP_CONFIG);
    }
  };

  const removeMediaItem = (id: string) => {
    if (isBusy) return;
    setMediaItems((prev) => {
      const idx = prev.findIndex((item) => item.id === id);
      if (idx === -1) return prev;
      revokeItemUrls(prev[idx]);
      const next = prev.filter((item) => item.id !== id);
      setActiveMediaIndex((curr) => Math.max(0, Math.min(curr, next.length - 1)));
      return next;
    });
    setErrorMsg('');
  };

  const moveMediaItem = (index: number, direction: -1 | 1) => {
    if (isBusy) return;
    const target = index + direction;
    setMediaItems((prev) => {
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      copy.splice(target, 0, moved);
      return copy;
    });
    setActiveMediaIndex(target);
  };

  const clearAllMedia = () => {
    if (submittingRef.current) return;
    setMediaItems((prev) => {
      prev.forEach(revokeItemUrls);
      return [];
    });
    setActiveMediaIndex(0);
    setTelemetry(null);
    setStage('idle');
    setErrorMsg('');
  };

  const handleModeChange = (nextMode: ComposerMode) => {
    if (isBusy) return;
    setErrorMsg('');
    setComposerMode(nextMode);
  };

  const handleApplyCrop = (item: ComposerMediaItem, nextCrop: ImageCropConfig) => {
    setCropTargetId(null);
    setMediaItems((prev) =>
      prev.map((m) =>
        m.id === item.id ? { ...m, optimizing: true, cropConfig: nextCrop } : m
      )
    );
    void processItemMedia(item.id, item.originalFile, nextCrop);
  };

  const handleInsertEmoji = (emoji: string) => {
    const el = captionRef.current;
    if (!el) {
      setCaption((prev) => `${prev}${emoji}`.slice(0, maxBodyChars));
      return;
    }
    const start = el.selectionStart ?? caption.length;
    const end = el.selectionEnd ?? caption.length;
    const next = (caption.slice(0, start) + emoji + caption.slice(end)).slice(0, maxBodyChars);
    setCaption(next);
    window.requestAnimationFrame(() => {
      el.focus();
      const cursor = Math.min(next.length, start + emoji.length);
      el.setSelectionRange(cursor, cursor);
    });
  };

  const handleToggleSuggestedTag = (tag: string) => {
    const clean = tag.replace(/^#/, '').toLowerCase();
    const currentTokens = hashtagInput
      .split(/[\s,]+/)
      .map((t) => t.trim().replace(/^#/, '').toLowerCase())
      .filter(Boolean);

    if (currentTokens.includes(clean)) {
      const next = currentTokens.filter((t) => t !== clean).join(', ');
      setHashtagInput(next);
    } else {
      if (parsedTags.length >= 10) {
        showToast({ type: 'info', title: 'Maximum 10 hashtags per post' });
        return;
      }
      const next = [...currentTokens, clean].join(', ');
      setHashtagInput(next);
    }
  };

  const handleSaveDraft = () => {
    if (isBusy) return;
    if (!caption.trim() && !hashtagInput.trim() && !locationTag.trim() && mediaItems.length === 0) {
      showToast({ type: 'info', title: 'Write something or attach media before saving a draft' });
      return;
    }

    const primaryMedia = mediaItems[0];
    const draftId = activeDraftId || `draft_${Date.now()}`;
    const previewDataUrl =
      primaryMedia?.mediaType === 'image' &&
      primaryMedia.prepared?.directDataUrl &&
      primaryMedia.prepared.directDataUrl.length <= 280_000
        ? primaryMedia.prepared.directDataUrl
        : undefined;

    const draft: PostDraft = {
      id: draftId,
      composerMode: composerMode === 'poll' ? 'text' : composerMode,
      caption,
      hashtagInput,
      aspectRatio: primaryMedia?.aspectRatio || 'landscape',
      locationTag,
      mediaPreviewDataUrl: previewDataUrl,
      mediaFileName: primaryMedia?.originalFileName,
      mediaType: primaryMedia?.mediaType,
      updatedAt: Date.now(),
    };

    const result = savePostDraft(profile?.uid, draft);
    setDrafts(result.drafts);
    setActiveDraftId(draftId);
    playSound('ui-tap');
    showToast({
      type: 'success',
      title: 'Draft saved',
      description:
        primaryMedia && !previewDataUrl
          ? 'Caption, hashtags, and location saved. Re-attach large media or video when publishing.'
          : result.trimmedMedia
            ? 'Text saved (preview skipped due to browser storage space).'
            : 'You can restore and edit this draft anytime.',
    });
  };

  const handleLoadDraft = (draft: PostDraft, isAutosave = false) => {
    if (isBusy) return;
    setComposerMode(draft.composerMode);
    setCaption(draft.caption);
    setHashtagInput(draft.hashtagInput || '');
    setLocationTag(draft.locationTag || '');
    if (!isAutosave) {
      setActiveDraftId(draft.id);
    }
    setAutosaveCandidate(null);
    setErrorMsg('');

    if (draft.mediaPreviewDataUrl) {
      // Rehydrate saved compact image preview cleanly into a real File so it can be edited & published!
      void fetch(draft.mediaPreviewDataUrl)
        .then((res) => res.blob())
        .then((blob) => {
          const file = new File([blob], draft.mediaFileName || 'draft-photo.webp', {
            type: blob.type || 'image/webp',
          });
          clearAllMedia();
          handleFilesSelected([file]);
        })
        .catch(() => {
          // Non-blocking: text fields still restore cleanly
        });
    } else if (draft.mediaFileName) {
      showToast({
        type: 'info',
        title: 'Text & tags restored',
        description: `Re-select "${draft.mediaFileName}" if you want to attach that file.`,
      });
    } else {
      showToast({ type: 'success', title: 'Draft loaded' });
    }
  };

  const handleDeleteDraft = (draftId: string) => {
    const next = deletePostDraft(profile?.uid, draftId);
    setDrafts(next);
    if (activeDraftId === draftId) setActiveDraftId(null);
    showToast({ type: 'info', title: 'Draft deleted' });
  };

  const handleCancelUpload = () => {
    cancelActiveUploadRef.current?.();
    cancelActiveUploadRef.current = null;
  };

  const executePublish = async () => {
    if (!profile || submittingRef.current) return;
    if (anyOptimizing) {
      setErrorMsg('Please wait a moment while your media preview finishes preparing.');
      return;
    }

    const readyMediaItems = composerMode === 'media' ? mediaItems.filter((m) => Boolean(m.prepared)) : [];
    if (readyMediaItems.length === 0 && !hasText) {
      setErrorMsg('Write something or attach a photo or video to publish.');
      return;
    }

    submittingRef.current = true;
    setErrorMsg('');
    const startedAt = performance.now();
    playSound('upload-start');

    try {
      // 1. Direct Text-Only Post
      if (readyMediaItems.length === 0) {
        setStage('saving');
        setPublishingProgressLabel('Publishing text post...');
        await createPost({
          author: profile,
          mediaUrl: '',
          mediaType: 'text',
          aspectRatio: 'square',
          caption: finalCaption,
          hashtags: parsedTags,
        });

        clearAutosaveDraft(profile.uid);
        if (activeDraftId) {
          setDrafts(deletePostDraft(profile.uid, activeDraftId));
          setActiveDraftId(null);
        }
        void refreshUserState();
        playSound('upload-success');
        const elapsedSec = ((performance.now() - startedAt) / 1000).toFixed(1);
        showToast({
          type: 'success',
          title: 'Post published',
          description: `Live in the Hostel Friend feed in ${elapsedSec}s.`,
        });
        onPublished();
        return;
      }

      // 2. Single Media or Ordered Multi-Photo Batch (tracks per-item published status so retries never duplicate)
      const pendingItems = readyMediaItems.filter((item) => !item.published);
      for (let i = 0; i < pendingItems.length; i++) {
        const item = pendingItems[i];
        const prepared = item.prepared!;
        const batchSuffix =
          readyMediaItems.length > 1 ? ` (${i + 1} of ${pendingItems.length})` : '';

        let mediaUrl: string;
        let thumbnailUrl: string | undefined;

        if (item.uploaded?.fingerprint === prepared.fingerprint) {
          mediaUrl = item.uploaded.mediaUrl;
          thumbnailUrl = item.uploaded.thumbnailUrl;
        } else {
          const storageAvailable =
            prepared.mediaType === 'image' && prepared.directDataUrl
              ? await checkStorageBucketAvailable()
              : true;

          if (!storageAvailable && prepared.directDataUrl) {
            mediaUrl = prepared.directDataUrl;
          } else {
            setStage('uploading');
            setPublishingProgressLabel(
              `Uploading ${prepared.formatLabel}${batchSuffix}...`
            );
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
              onProgress: (nextTelemetry) => setTelemetry(nextTelemetry),
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

          setMediaItems((prev) =>
            prev.map((m) =>
              m.id === item.id
                ? {
                    ...m,
                    uploaded: {
                      fingerprint: prepared.fingerprint,
                      mediaUrl,
                      thumbnailUrl,
                    },
                  }
                : m
            )
          );
        }

        setStage('saving');
        setPublishingProgressLabel(`Saving post${batchSuffix} to feed...`);
        await createPost({
          author: profile,
          mediaUrl,
          thumbnailUrl,
          mediaType: prepared.mediaType,
          aspectRatio: item.aspectRatio,
          caption: finalCaption,
          hashtags: parsedTags,
        });

        setMediaItems((prev) =>
          prev.map((m) => (m.id === item.id ? { ...m, published: true } : m))
        );
      }

      clearAutosaveDraft(profile.uid);
      if (activeDraftId) {
        setDrafts(deletePostDraft(profile.uid, activeDraftId));
        setActiveDraftId(null);
      }
      void refreshUserState();
      playSound('upload-success');
      const totalSec = ((performance.now() - startedAt) / 1000).toFixed(1);
      showToast({
        type: 'success',
        title: readyMediaItems.length > 1 ? `${readyMediaItems.length} photo posts published` : 'Post published',
        description: `Live in the Hostel Friend feed in ${totalSec}s.`,
      });
      onPublished();
    } catch (err) {
      cancelActiveUploadRef.current = null;
      setStage('failed');
      setPublishingProgressLabel('');
      if (err instanceof UploadCancelledError) {
        playSound('unlike');
        setErrorMsg('Upload cancelled. Your caption, hashtags, and media are preserved.');
      } else {
        playSound('error');
        setErrorMsg(formatUserFriendlyError(err, 'Could not publish your post. Please try again.'));
      }
    } finally {
      submittingRef.current = false;
    }
  };

  const handlePublishSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canPublish) {
      setErrorMsg('Write something or attach a photograph or video to publish.');
      return;
    }
    void executePublish();
  };

  const getStageMessage = (): string => {
    if (publishingProgressLabel) return publishingProgressLabel;
    if (stage === 'saving') return 'Publishing to Hostel Friend feed...';
    if (!telemetry) return 'Preparing upload...';
    if (telemetry.phase === 'paused-offline') return 'Paused — waiting for network connection...';
    if (telemetry.phase === 'retrying') return `Reconnecting (attempt ${telemetry.attempt})...`;
    if (telemetry.phase === 'stalled') return 'Connection looks stalled — wait, cancel, or retry.';
    if (telemetry.phase === 'verifying') return 'Confirming media URL...';
    return 'Uploading media to Hostel Friend...';
  };

  const activePrepared = activeMedia?.prepared || null;
  const savedPercent =
    activePrepared &&
    activePrepared.originalSize > 0 &&
    activePrepared.optimizedSize < activePrepared.originalSize
      ? Math.round(
          ((activePrepared.originalSize - activePrepared.optimizedSize) / activePrepared.originalSize) *
            100
        )
      : 0;

  const previewAspectClass =
    activeMedia?.aspectRatio === 'square'
      ? 'aspect-square'
      : activeMedia?.aspectRatio === 'portrait'
        ? 'aspect-[3/4]'
        : activeMedia?.aspectRatio === 'vertical'
          ? 'aspect-[9/16] max-h-[340px] mx-auto'
          : 'aspect-[4/3]';

  const cropModalTarget = mediaItems.find((m) => m.id === cropTargetId) || null;

  return (
    <div className="max-w-6xl mx-auto pb-8 space-y-5">
      {/* Studio Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-ink">
            Create Post
          </h1>
          <p className="text-xs sm:text-sm text-ink-muted mt-0.5">
            Share thoughts, photo batches (up to {MAX_PHOTOS_PER_BATCH}), or videos · Max{' '}
            {platformSettings.maxUploadSizeMB} MB
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="inline-flex items-center gap-1 p-1 bg-surface-2 rounded-xl border border-hairline">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => handleModeChange('media')}
              className={`min-h-[38px] px-3.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                composerMode === 'media'
                  ? 'bg-accent text-accent-fg'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              <ImageIcon className="w-3.5 h-3.5" />
              <span>Photo / Video</span>
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => handleModeChange('text')}
              className={`min-h-[38px] px-3.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                composerMode === 'text'
                  ? 'bg-accent text-accent-fg'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Text Only</span>
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => handleModeChange('poll')}
              className={`min-h-[38px] px-3.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                composerMode === 'poll'
                  ? 'bg-accent text-accent-fg'
                  : 'text-ink-muted hover:text-ink'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Poll</span>
            </button>
          </div>

          {composerMode !== 'poll' && (
            <button
              type="button"
              onClick={() => setMobilePreviewOpen((o) => !o)}
              className="lg:hidden min-h-[42px] px-3.5 rounded-xl text-xs font-semibold border border-hairline bg-surface-2 text-ink hover:border-accent/40 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Eye className="w-3.5 h-3.5 text-accent" />
              <span>{mobilePreviewOpen ? 'Hide Preview' : 'Preview'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={onCancel}
            disabled={isBusy}
            className="min-h-[42px] px-4 rounded-xl text-xs font-medium border border-hairline text-ink-muted hover:text-ink disabled:opacity-40 whitespace-nowrap shrink-0"
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Restore Unfinished Autosave Banner */}
      {autosaveCandidate && !caption.trim() && mediaItems.length === 0 && (
        <div className="rounded-2xl glass-card border-accent/35 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-accent">Unfinished draft found</p>
            <p className="text-xs text-ink-muted truncate mt-0.5">
              {autosaveCandidate.caption || autosaveCandidate.hashtagInput || 'Saved post progress'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                clearAutosaveDraft(profile?.uid);
                setAutosaveCandidate(null);
              }}
              className="min-h-[38px] px-3 rounded-xl border border-hairline text-xs font-medium text-ink-muted hover:text-ink"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={() => handleLoadDraft(autosaveCandidate, true)}
              className="min-h-[38px] px-4 rounded-xl gold-gradient-btn text-xs font-semibold"
            >
              Restore Draft
            </button>
          </div>
        </div>
      )}

      {/* Main Studio Area */}
      {composerMode === 'poll' ? (
        <div className="max-w-2xl mx-auto glass-card rounded-2xl p-4 sm:p-6">
          <PollCreator
            showPreviewByDefault
            onPollCreated={() => {
              onPublished();
            }}
            onCancel={onCancel}
          />
        </div>
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Composer Column */}
        <form
          onSubmit={handlePublishSubmit}
          className="lg:col-span-7 glass-card rounded-2xl p-4 sm:p-6 space-y-5"
        >
          {/* Author Identity + Honest Audience Row */}
          <div className="flex items-center justify-between gap-3 pb-4 border-b border-hairline">
            <div className="flex items-center gap-3 min-w-0">
              <Avatar
                src={profile?.avatarUrl}
                name={profile?.fullName || 'Hostel Friend'}
                size="md"
              />
              <div className="min-w-0">
                <p className="text-sm font-display font-semibold text-ink truncate">
                  {profile?.fullName || 'Hostel Friend Member'}
                </p>
                <p className="text-xs text-ink-muted truncate">
                  @{profile?.username || 'member'}
                  {profile?.hostel ? ` · ${profile.hostel}` : ''}
                </p>
              </div>
            </div>

            <div
              className="text-right shrink-0"
              title="All published posts are visible across the Hostel Friend community"
            >
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent">
                <Globe className="w-3.5 h-3.5" />
                <span>Public Post</span>
              </span>
              <p className="text-[11px] text-ink-subtle mt-0.5">
                {privateSettings?.privacyMode === 'followers'
                  ? 'Feed posts stay public'
                  : 'Visible to Hostel Friend'}
              </p>
            </div>
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3.5 text-xs text-rose-500 leading-relaxed flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
              {canPublish && stage === 'failed' && (
                <button
                  type="button"
                  onClick={() => void executePublish()}
                  className="min-h-[38px] px-3.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-500 font-semibold inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Retry</span>
                </button>
              )}
            </div>
          )}

          {/* Caption / Post Input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs">
              <label htmlFor="post-caption" className="font-semibold text-ink-muted">
                {composerMode === 'text' ? 'Your Post' : 'Caption'}
              </label>
              <span className="font-mono tabular-nums text-ink-subtle">
                {finalCaption.length}/1000
              </span>
            </div>

            <textarea
              ref={captionRef}
              id="post-caption"
              rows={composerMode === 'text' ? 5 : 3}
              maxLength={maxBodyChars}
              value={caption}
              disabled={isBusy}
              onChange={(e) => setCaption(e.target.value)}
              placeholder={
                composerMode === 'text'
                  ? `What's on your mind, ${firstName}? Share hostel news, room notes, or thoughts... Mention peers with @username.`
                  : `What's on your mind, ${firstName}? Tell the story behind this moment or tag @friends...`
              }
              className="w-full rounded-xl bg-surface-2 border border-hairline px-4 py-3 text-sm sm:text-[15px] leading-relaxed text-ink placeholder:text-ink-subtle focus:outline-none focus:border-accent resize-none disabled:opacity-60 transition-colors"
            />

            {/* Text Starters when in Text Mode */}
            {composerMode === 'text' && !caption.trim() && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-[11px] text-ink-subtle">Quick starters:</span>
                {TEXT_POST_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.label}
                    type="button"
                    disabled={isBusy}
                    onClick={() => {
                      setCaption(tpl.prompt);
                      if (!hashtagInput.trim()) setHashtagInput(tpl.tags);
                      captionRef.current?.focus();
                    }}
                    className="min-h-[32px] px-2.5 rounded-lg bg-surface-2 border border-hairline hover:border-accent/40 text-[11px] font-medium text-ink-muted hover:text-ink transition-colors"
                  >
                    {tpl.label}
                  </button>
                ))}
              </div>
            )}

            {/* Quick Composer Toolbar: Emoji + Optional Campus Location */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => {
                  setEmojiPickerOpen((o) => !o);
                  setLocationPickerOpen(false);
                }}
                className={`min-h-[38px] px-3 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                  emojiPickerOpen
                    ? 'bg-accent/15 border-accent/40 text-accent'
                    : 'bg-surface-2 border-hairline text-ink-muted hover:text-ink'
                }`}
              >
                <Smile className="w-3.5 h-3.5 text-accent" />
                <span>Emoji</span>
              </button>

              <button
                type="button"
                disabled={isBusy}
                onClick={() => {
                  setLocationPickerOpen((o) => !o);
                  setEmojiPickerOpen(false);
                }}
                className={`min-h-[38px] px-3 rounded-xl border text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
                  locationTag || locationPickerOpen
                    ? 'bg-accent/15 border-accent/40 text-accent'
                    : 'bg-surface-2 border-hairline text-ink-muted hover:text-ink'
                }`}
              >
                <MapPin className="w-3.5 h-3.5 text-accent" />
                <span>{locationTag ? locationTag : 'Add Location'}</span>
              </button>

              {locationTag && !isBusy && (
                <button
                  type="button"
                  onClick={() => setLocationTag('')}
                  aria-label="Remove location tag"
                  className="min-h-[36px] px-2 rounded-lg text-[11px] text-ink-subtle hover:text-rose-400"
                >
                  Clear location
                </button>
              )}
            </div>

            {emojiPickerOpen && (
              <div className="rounded-xl bg-surface-2 border border-hairline p-2.5 flex flex-wrap gap-1">
                {EMOJI_QUICK_BAR.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => handleInsertEmoji(emoji)}
                    className="min-w-[38px] min-h-[38px] rounded-lg hover:bg-hover-tint text-lg flex items-center justify-center transition-transform active:scale-90"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}

            {locationPickerOpen && (
              <div className="rounded-xl bg-surface-2 border border-hairline p-3 space-y-2.5">
                <p className="text-[11px] text-ink-muted">
                  Optional — select a campus spot manually (never detected automatically):
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {campusSpotSuggestions.map((spot) => {
                    const active = locationTag.toLowerCase() === spot.toLowerCase();
                    return (
                      <button
                        key={spot}
                        type="button"
                        onClick={() => {
                          setLocationTag(active ? '' : spot);
                          setLocationPickerOpen(false);
                        }}
                        className={`min-h-[34px] px-2.5 rounded-lg text-xs font-medium transition-colors ${
                          active
                            ? 'bg-accent text-accent-fg'
                            : 'bg-surface border border-hairline text-ink-muted hover:text-ink'
                        }`}
                      >
                        {spot}
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    maxLength={40}
                    value={customLocationInput}
                    onChange={(e) => setCustomLocationInput(e.target.value)}
                    placeholder="Or type a custom spot (e.g. Block B Rooftop)"
                    className="flex-1 rounded-xl bg-surface border border-hairline px-3 py-2 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    disabled={!customLocationInput.trim()}
                    onClick={() => {
                      setLocationTag(customLocationInput.trim().slice(0, 40));
                      setCustomLocationInput('');
                      setLocationPickerOpen(false);
                    }}
                    className="min-h-[36px] px-3 rounded-xl bg-accent text-accent-fg text-xs font-semibold disabled:opacity-45"
                  >
                    Set
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Media Upload, Queue & Editing Area */}
          {composerMode === 'media' && (
            <div className="space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
                onChange={(e) => {
                  if (e.target.files?.length) {
                    handleFilesSelected(e.target.files);
                  }
                  e.target.value = '';
                }}
                className="hidden"
              />

              {mediaItems.length === 0 ? (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragActive(false);
                    if (e.dataTransfer.files?.length) {
                      handleFilesSelected(e.dataTransfer.files);
                    }
                  }}
                  onClick={() => !isBusy && fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && !isBusy) {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  className={`cursor-pointer flex flex-col items-center justify-center rounded-2xl border border-dashed py-10 px-6 text-center transition-colors ${
                    dragActive
                      ? 'border-accent bg-accent/5'
                      : 'border-hairline-strong bg-surface-2/60 hover:border-accent/50'
                  }`}
                >
                  <div className="w-12 h-12 rounded-2xl bg-surface border border-hairline flex items-center justify-center text-accent mb-3">
                    <Upload className="w-5 h-5" />
                  </div>
                  <p className="font-display text-base font-semibold text-ink">
                    Drop photos or a video here
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    Select up to {MAX_PHOTOS_PER_BATCH} photos (JPG, PNG, WebP, GIF) or 1 video (MP4, WebM, MOV)
                  </p>
                  <span className="mt-4 min-h-[42px] px-5 rounded-xl text-xs font-semibold gold-gradient-btn inline-flex items-center">
                    Choose Photos or Video
                  </span>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Active Selected Media Preview */}
                  {activeMedia && (
                    <div className="relative rounded-2xl overflow-hidden bg-canvas-alt border border-hairline">
                      {activeMedia.optimizing && activeMedia.instantPreviewUrl ? (
                        <div className="relative">
                          <img
                            src={activeMedia.instantPreviewUrl}
                            alt="Optimizing preview"
                            className="w-full max-h-[400px] object-contain mx-auto"
                          />
                          <div className="absolute bottom-3 left-3 inline-flex items-center gap-2 rounded-full bg-black/75 border border-white/25 px-3 py-1.5 text-xs text-white">
                            <Loader2 className="w-3.5 h-3.5 text-amber-300 animate-spin" />
                            <span>Optimizing photo...</span>
                          </div>
                        </div>
                      ) : activeMedia.optimizing ? (
                        <div className="py-12 px-6 flex flex-col items-center justify-center gap-3 text-center">
                          <Loader2 className="w-6 h-6 text-accent animate-spin" />
                          <p className="text-xs font-medium text-ink">
                            {activeMedia.optimizingLabel || `Preparing ${activeMedia.originalFileName}...`}
                          </p>
                          {typeof activeMedia.optimizingPercent === 'number' && (
                            <div className="w-48 h-1.5 rounded-full bg-surface-hover overflow-hidden">
                              <div
                                className="h-full bg-accent transition-all duration-150"
                                style={{ width: `${activeMedia.optimizingPercent}%` }}
                              />
                            </div>
                          )}
                        </div>
                      ) : activeMedia.prepared ? (
                        activeMedia.mediaType === 'video' ? (
                          <video
                            src={activeMedia.prepared.previewUrl}
                            poster={activeMedia.prepared.thumbnailPreviewUrl}
                            controls
                            playsInline
                            preload="metadata"
                            className="w-full max-h-[420px] object-contain mx-auto"
                          />
                        ) : (
                          <img
                            src={activeMedia.prepared.previewUrl}
                            alt="Selected media preview"
                            className="w-full max-h-[420px] object-contain mx-auto"
                          />
                        )
                      ) : null}

                      {/* Top Overlay Actions: Crop (for images) + Remove */}
                      {!isBusy && (
                        <div className="absolute top-3 right-3 flex items-center gap-2">
                          {activeMedia.mediaType === 'image' && activeMedia.prepared && (
                            <button
                              type="button"
                              onClick={() => setCropTargetId(activeMedia.id)}
                              className="min-h-[40px] px-3 rounded-full bg-black/75 hover:bg-black text-white border border-white/20 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors"
                            >
                              <Crop className="w-3.5 h-3.5" />
                              <span>Crop</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => removeMediaItem(activeMedia.id)}
                            aria-label="Remove media"
                            className="min-w-[40px] min-h-[40px] rounded-full bg-black/75 hover:bg-black text-white border border-white/20 flex items-center justify-center transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Active Media Info + Aspect Ratio Controls */}
                  {activeMedia && activePrepared && (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs text-ink-muted">
                      <div className="flex items-center gap-2 min-w-0">
                        {activeMedia.mediaType === 'video' ? (
                          <Film className="w-4 h-4 text-accent shrink-0" />
                        ) : (
                          <ImageIcon className="w-4 h-4 text-accent shrink-0" />
                        )}
                        <span className="truncate font-mono tabular-nums">
                          {activeMedia.originalFileName} ·{' '}
                          {activePrepared.wasCompressed ? (
                            <>
                              {formatBytes(activePrepared.originalSize)} →{' '}
                              <span className="text-accent font-semibold">
                                {formatBytes(activePrepared.optimizedSize)} {activePrepared.formatLabel}
                              </span>
                              {savedPercent > 0 ? ` (-${savedPercent}%)` : ''}
                            </>
                          ) : (
                            `${formatBytes(activePrepared.optimizedSize)} ${activePrepared.formatLabel}`
                          )}
                          {activePrepared.mediaType === 'video' && activePrepared.durationSeconds
                            ? ` · ${activePrepared.durationSeconds.toFixed(1)}s${
                                activePrepared.wasTrimmed ? ' (first 10s auto-cut)' : ''
                              }`
                            : ''}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 flex-wrap">
                        {ASPECT_RATIO_OPTIONS.map((ratio) => (
                          <button
                            key={ratio.id}
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              setMediaItems((prev) =>
                                prev.map((m) =>
                                  m.id === activeMedia.id ? { ...m, aspectRatio: ratio.id } : m
                                )
                              )
                            }
                            className={`min-h-[34px] px-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                              activeMedia.aspectRatio === ratio.id
                                ? 'bg-accent text-accent-fg'
                                : 'bg-surface-2 text-ink-muted border border-hairline hover:text-ink'
                            }`}
                          >
                            {ratio.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Multi-Photo Queue & Reordering Strip */}
                  {mediaItems[0]?.mediaType === 'image' && (
                    <div className="rounded-xl bg-surface-2 border border-hairline p-3 space-y-2">
                      <div className="flex items-center justify-between text-[11px] text-ink-muted">
                        <span>
                          {mediaItems.length === 1
                            ? 'Photo ready · You can add up to 3 more'
                            : `Photo series (${mediaItems.length}/${MAX_PHOTOS_PER_BATCH}) — published in order`}
                        </span>
                        {!isBusy && mediaItems.length > 1 && (
                          <button
                            type="button"
                            onClick={clearAllMedia}
                            className="text-rose-400 hover:underline font-medium"
                          >
                            Clear all
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-2.5 overflow-x-auto pb-1">
                        {mediaItems.map((item, idx) => {
                          const thumbSrc =
                            item.prepared?.previewUrl || item.instantPreviewUrl || '';
                          const isSelected = idx === activeMediaIndex;
                          return (
                            <div
                              key={item.id}
                              className={`relative shrink-0 rounded-xl border p-1 bg-surface transition-colors ${
                                isSelected ? 'border-accent' : 'border-hairline'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => setActiveMediaIndex(idx)}
                                className="w-16 h-16 rounded-lg overflow-hidden block bg-canvas-alt"
                              >
                                {thumbSrc ? (
                                  <img
                                    src={thumbSrc}
                                    alt={`Queue item ${idx + 1}`}
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center">
                                    <Loader2 className="w-4 h-4 text-accent animate-spin" />
                                  </div>
                                )}
                              </button>

                              {!isBusy && mediaItems.length > 1 && (
                                <div className="mt-1 flex items-center justify-between gap-1">
                                  <button
                                    type="button"
                                    disabled={idx === 0}
                                    onClick={() => moveMediaItem(idx, -1)}
                                    aria-label="Move photo earlier"
                                    className="p-1 rounded text-ink-muted hover:text-ink disabled:opacity-30"
                                  >
                                    <ArrowLeft className="w-3 h-3" />
                                  </button>
                                  <span className="text-[10px] font-mono tabular-nums text-ink-subtle">
                                    {idx + 1}
                                  </span>
                                  <button
                                    type="button"
                                    disabled={idx === mediaItems.length - 1}
                                    onClick={() => moveMediaItem(idx, 1)}
                                    aria-label="Move photo later"
                                    className="p-1 rounded text-ink-muted hover:text-ink disabled:opacity-30"
                                  >
                                    <ArrowRight className="w-3 h-3" />
                                  </button>
                                </div>
                              )}

                              {item.published && (
                                <span
                                  title="Already published"
                                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center"
                                >
                                  <Check className="w-3 h-3" />
                                </span>
                              )}
                            </div>
                          );
                        })}

                        {!isBusy && mediaItems.length < MAX_PHOTOS_PER_BATCH && (
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="w-16 h-16 shrink-0 rounded-xl border border-dashed border-hairline-strong hover:border-accent/50 bg-surface flex flex-col items-center justify-center gap-1 text-[11px] font-medium text-ink-muted hover:text-accent transition-colors"
                          >
                            <Plus className="w-4 h-4" />
                            <span>Add</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Hashtags Input & Quick Tag Suggestions */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <label
                htmlFor="post-hashtags"
                className="font-semibold text-ink-muted inline-flex items-center gap-1.5"
              >
                <Hash className="w-3.5 h-3.5 text-accent" />
                <span>Hashtags (up to 10)</span>
              </label>
              <span className="font-mono tabular-nums text-ink-subtle">
                {parsedTags.length}/10
              </span>
            </div>

            <input
              id="post-hashtags"
              type="text"
              value={hashtagInput}
              disabled={isBusy}
              onChange={(e) => setHashtagInput(e.target.value)}
              placeholder="rooftop, latenightstudy, hostellife"
              className="w-full rounded-xl bg-surface-2 border border-hairline px-4 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-accent disabled:opacity-60"
            />

            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {suggestedTags.map((tag) => {
                const selected = parsedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    disabled={isBusy}
                    onClick={() => handleToggleSuggestedTag(tag)}
                    className={`min-h-[32px] px-2.5 rounded-lg text-[11px] font-medium transition-colors ${
                      selected
                        ? 'bg-accent text-accent-fg'
                        : 'bg-surface-2 border border-hairline text-ink-muted hover:text-ink'
                    }`}
                  >
                    #{tag}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Upload & Saving Progress Panel */}
          {(stage === 'uploading' || stage === 'saving') && (
            <div className="rounded-xl bg-surface-2 border border-hairline p-4 space-y-3">
              <div className="flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 text-ink min-w-0">
                  {telemetry?.phase === 'paused-offline' ? (
                    <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
                  ) : (
                    <Loader2 className="w-4 h-4 text-accent animate-spin shrink-0" />
                  )}
                  <span className="truncate font-medium">{getStageMessage()}</span>
                </div>
                <span className="font-mono tabular-nums text-accent font-semibold shrink-0">
                  {stage === 'saving' ? '100%' : `${telemetry?.percent ?? 0}%`}
                </span>
              </div>

              <div className="h-2 w-full rounded-full bg-canvas-alt overflow-hidden border border-hairline">
                <div
                  className="h-full bg-gradient-to-r from-accent-deep to-accent transition-[width] duration-150"
                  style={{ width: `${stage === 'saving' ? 100 : telemetry?.percent ?? 0}%` }}
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-muted font-mono tabular-nums">
                <span>
                  {stage === 'saving'
                    ? 'Writing post to Firestore...'
                    : telemetry
                      ? `${formatBytes(telemetry.bytesTransferred)} / ${formatBytes(telemetry.totalBytes)}`
                      : ''}
                  {stage === 'uploading' && telemetry && telemetry.speedBytesPerSec > 0
                    ? ` · ${formatSpeed(telemetry.speedBytesPerSec)}`
                    : ''}
                  {stage === 'uploading' && telemetry?.etaSeconds
                    ? ` · ${formatEta(telemetry.etaSeconds)}`
                    : ''}
                </span>

                {stage === 'uploading' && (
                  <button
                    type="button"
                    onClick={handleCancelUpload}
                    className="min-h-[34px] px-3 rounded-lg border border-hairline-strong text-ink hover:border-rose-400/50 hover:text-rose-300 font-sans font-medium transition-colors whitespace-nowrap"
                  >
                    Cancel Upload
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Action Footer: Save Draft + Discard + Publish */}
          <div className="pt-3 border-t border-hairline flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              disabled={isBusy}
              onClick={handleSaveDraft}
              className="min-h-[44px] px-4 rounded-xl bg-surface-2 border border-hairline hover:border-accent/40 text-xs font-semibold text-ink inline-flex items-center gap-1.5 disabled:opacity-45 whitespace-nowrap"
            >
              <Bookmark className="w-3.5 h-3.5 text-accent" />
              <span>Save Draft</span>
            </button>

            <div className="flex items-center gap-2.5 ml-auto">
              <button
                type="button"
                onClick={onCancel}
                disabled={isBusy}
                className="min-h-[44px] px-4 rounded-xl text-xs font-medium border border-hairline text-ink-muted hover:text-ink disabled:opacity-40 whitespace-nowrap"
              >
                Discard
              </button>

              {stage === 'failed' && canPublish ? (
                <button
                  type="button"
                  onClick={() => void executePublish()}
                  className="min-h-[44px] gold-gradient-btn px-6 rounded-xl text-xs sm:text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Retry Publish</span>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={isBusy || !canPublish}
                  className="min-h-[44px] gold-gradient-btn px-6 rounded-xl text-xs sm:text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-45 whitespace-nowrap"
                >
                  <Send className="w-4 h-4" />
                  <span>
                    {anyOptimizing
                      ? 'Preparing Media...'
                      : stage === 'uploading'
                        ? `Uploading ${telemetry?.percent ?? 0}%`
                        : stage === 'saving'
                          ? 'Publishing...'
                          : isTextOnlyPublish
                            ? 'Publish Text Post'
                            : mediaItems.length > 1
                              ? `Publish ${mediaItems.length} Photos`
                              : 'Publish Post'}
                  </span>
                </button>
              )}
            </div>
          </div>
        </form>

        {/* Live Feed Preview + Saved Drafts Column */}
        <aside
          className={`lg:col-span-5 space-y-5 ${
            mobilePreviewOpen ? 'block' : 'hidden lg:block'
          }`}
        >
          {/* Live Feed Preview */}
          <section className="rounded-2xl glass-card p-4 sm:p-5 space-y-3.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-ink inline-flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-accent" />
                <span>Live Feed Preview</span>
              </span>
              <span className="text-ink-subtle">How your post appears in feed</span>
            </div>

            <div className="rounded-2xl bg-canvas-alt border border-hairline overflow-hidden">
              {/* Mocked Card Author Row using real user profile */}
              <div className="px-4 pt-3.5 pb-2.5 flex items-center gap-2.5">
                <Avatar
                  src={profile?.avatarUrl}
                  name={profile?.fullName || 'Hostel Friend'}
                  size="sm"
                />
                <div className="min-w-0">
                  <p className="text-xs font-display font-semibold text-ink truncate">
                    {profile?.fullName || 'Your Name'}
                  </p>
                  <p className="text-[11px] text-ink-muted truncate">
                    @{profile?.username || 'username'} · {formatRelativeTime(null)}
                  </p>
                </div>
              </div>

              {(finalCaption || parsedTags.length > 0) && (
                <div className="px-4 pb-3 space-y-1.5">
                  {finalCaption && (
                    <p
                      className={`${
                        isTextOnlyPublish ? 'text-sm sm:text-[15px]' : 'text-xs sm:text-[13px]'
                      } text-ink-2 leading-relaxed whitespace-pre-wrap break-words`}
                    >
                      {finalCaption}
                    </p>
                  )}
                  {parsedTags.length > 0 && (
                    <p className="text-xs font-medium text-accent">
                      {parsedTags.map((t) => `#${t}`).join(' ')}
                    </p>
                  )}
                </div>
              )}

              {composerMode === 'media' && activeMedia?.prepared && (
                <div className="px-4 pb-3">
                  <div
                    className={`${previewAspectClass} w-full rounded-xl overflow-hidden bg-black border border-hairline`}
                  >
                    {activeMedia.mediaType === 'video' ? (
                      <video
                        src={activeMedia.prepared.previewUrl}
                        poster={activeMedia.prepared.thumbnailPreviewUrl}
                        muted
                        playsInline
                        preload="metadata"
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <img
                        src={activeMedia.prepared.previewUrl}
                        alt="Live preview"
                        className="w-full h-full object-cover"
                      />
                    )}
                  </div>
                  {mediaItems.length > 1 && (
                    <p className="mt-1.5 text-[11px] text-ink-subtle text-center">
                      Showing photo {activeMediaIndex + 1} of {mediaItems.length} in your batch
                    </p>
                  )}
                </div>
              )}

              {!finalCaption && !activeMedia?.prepared && (
                <div className="px-4 pb-4 text-xs text-ink-subtle">
                  Start typing or attach media to preview your card live.
                </div>
              )}

              <div className="px-4 py-2.5 border-t border-hairline grid grid-cols-4 gap-2 text-[11px] text-ink-muted">
                <span className="inline-flex items-center justify-center gap-1">
                  <Heart className="w-3.5 h-3.5" />
                  Like
                </span>
                <span className="inline-flex items-center justify-center gap-1">
                  <MessageCircle className="w-3.5 h-3.5" />
                  Comment
                </span>
                <span className="inline-flex items-center justify-center gap-1">
                  <Bookmark className="w-3.5 h-3.5" />
                  Save
                </span>
                <span className="inline-flex items-center justify-center gap-1">
                  <Share2 className="w-3.5 h-3.5" />
                  Share
                </span>
              </div>
            </div>
          </section>

          {/* Saved Drafts Panel */}
          <section className="rounded-2xl glass-card p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-bold text-ink">
                Saved Drafts
              </h2>
              <span className="text-xs font-mono tabular-nums text-ink-subtle">
                {drafts.length}
              </span>
            </div>

            {drafts.length === 0 ? (
              <p className="text-xs text-ink-muted leading-relaxed">
                No saved drafts yet. Tap <span className="text-ink font-medium">Save Draft</span> anytime to finish a post later.
              </p>
            ) : (
              <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                {drafts.map((draft) => (
                  <div
                    key={draft.id}
                    className={`rounded-xl border p-3 bg-surface-2 space-y-2 ${
                      activeDraftId === draft.id ? 'border-accent/50' : 'border-hairline'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      {draft.mediaPreviewDataUrl && (
                        <img
                          src={draft.mediaPreviewDataUrl}
                          alt="Draft preview"
                          className="w-11 h-11 rounded-lg object-cover border border-hairline shrink-0"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-ink line-clamp-2 leading-relaxed">
                          {draft.caption || draft.mediaFileName || draft.hashtagInput || 'Untitled draft'}
                        </p>
                        <p className="text-[11px] text-ink-subtle mt-0.5">
                          {new Date(draft.updatedAt).toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {draft.locationTag ? ` · ${draft.locationTag}` : ''}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleDeleteDraft(draft.id)}
                        aria-label="Delete draft"
                        className="min-h-[34px] px-2.5 rounded-lg text-[11px] text-rose-400 hover:bg-rose-500/10 inline-flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Delete</span>
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleLoadDraft(draft)}
                        className="min-h-[34px] px-3 rounded-lg bg-surface border border-hairline hover:border-accent/40 text-[11px] font-semibold text-ink"
                      >
                        Edit Draft
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
      )}

      {/* Crop & Frame Editor Modal */}
      <MediaCropModal
        open={Boolean(cropModalTarget)}
        file={cropModalTarget?.originalFile || null}
        initialConfig={cropModalTarget?.cropConfig || DEFAULT_CROP_CONFIG}
        onClose={() => setCropTargetId(null)}
        onApply={(nextConfig) => {
          if (cropModalTarget) {
            handleApplyCrop(cropModalTarget, nextConfig);
          }
        }}
      />
    </div>
  );
}
