import { AspectRatioType } from '../types';

export interface ImageCropConfig {
  aspectRatio: AspectRatioType | 'original';
  rotation: 0 | 90 | 180 | 270;
  zoom: number; // 1.0 to 2.0
  panX: number; // 0 to 100 (50 = centered)
  panY: number; // 0 to 100 (50 = centered)
}

export const DEFAULT_CROP_CONFIG: ImageCropConfig = {
  aspectRatio: 'original',
  rotation: 0,
  zoom: 1,
  panX: 50,
  panY: 50,
};

export interface PostDraft {
  id: string;
  composerMode: 'media' | 'text';
  caption: string;
  hashtagInput: string;
  aspectRatio: AspectRatioType;
  locationTag: string;
  mediaPreviewDataUrl?: string;
  mediaFileName?: string;
  mediaType?: 'image' | 'video';
  updatedAt: number;
}

export const EMOJI_QUICK_BAR = [
  '😊',
  '🔥',
  '✨',
  '📸',
  '🎉',
  '☕',
  '📚',
  '🎶',
  '🙌',
  '❤️',
  '😂',
  '🤩',
  '🎓',
  '🌙',
];

export const COMMON_CAMPUS_SPOTS = [
  'Hostel Courtyard',
  'Central Library',
  'Campus Canteen',
  'Study Room',
  'Main Ground',
  'Rooftop Lounge',
];

export const TEXT_POST_TEMPLATES: ReadonlyArray<{
  label: string;
  prompt: string;
  tags: string;
}> = [
  {
    label: 'Announcement',
    prompt: 'Quick heads up for everyone in the hostel: ',
    tags: 'announcement, hostellife',
  },
  {
    label: 'Study Invite',
    prompt: 'Setting up a study session tonight — anyone joining? ',
    tags: 'studygroup, campus',
  },
  {
    label: 'Chai & Hangout',
    prompt: 'Grabbing chai outside in a few minutes. Who is around? ',
    tags: 'chai, eveningvibes',
  },
];

const DRAFTS_KEY_PREFIX = 'hf_post_drafts_v1_';
const AUTOSAVE_KEY_PREFIX = 'hf_post_autosave_v1_';
const MAX_DRAFTS = 8;

function draftsKey(uid?: string | null): string {
  return `${DRAFTS_KEY_PREFIX}${uid || 'guest'}`;
}

function autosaveKey(uid?: string | null): string {
  return `${AUTOSAVE_KEY_PREFIX}${uid || 'guest'}`;
}

export function loadPostDrafts(uid?: string | null): PostDraft[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(draftsKey(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (d): d is PostDraft =>
          Boolean(d && typeof d === 'object' && typeof d.id === 'string' && typeof d.updatedAt === 'number')
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_DRAFTS);
  } catch {
    return [];
  }
}

export function savePostDraft(uid: string | null | undefined, draft: PostDraft): {
  drafts: PostDraft[];
  trimmedMedia: boolean;
} {
  const existing = loadPostDrafts(uid).filter((d) => d.id !== draft.id);
  const nextList = [draft, ...existing].slice(0, MAX_DRAFTS);

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(draftsKey(uid), JSON.stringify(nextList));
      return { drafts: nextList, trimmedMedia: false };
    } catch {
      // Storage quota tight — strip heavy preview dataUrl and retry gracefully
      const compactDraft: PostDraft = { ...draft, mediaPreviewDataUrl: undefined };
      const compactList = [compactDraft, ...existing].slice(0, MAX_DRAFTS);
      try {
        window.localStorage.setItem(draftsKey(uid), JSON.stringify(compactList));
        return { drafts: compactList, trimmedMedia: Boolean(draft.mediaPreviewDataUrl) };
      } catch {
        // Keep only the current compact draft if storage is critically low
        try {
          window.localStorage.setItem(draftsKey(uid), JSON.stringify([compactDraft]));
          return { drafts: [compactDraft], trimmedMedia: Boolean(draft.mediaPreviewDataUrl) };
        } catch {
          return { drafts: existing, trimmedMedia: true };
        }
      }
    }
  }
  return { drafts: nextList, trimmedMedia: false };
}

export function deletePostDraft(uid: string | null | undefined, draftId: string): PostDraft[] {
  const next = loadPostDrafts(uid).filter((d) => d.id !== draftId);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(draftsKey(uid), JSON.stringify(next));
    } catch {
      // ignore
    }
  }
  return next;
}

export function loadAutosaveDraft(uid?: string | null): PostDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(autosaveKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PostDraft;
    if (!parsed || typeof parsed.caption !== 'string') return null;
    if (!parsed.caption.trim() && !parsed.hashtagInput?.trim() && !parsed.locationTag?.trim()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveAutosaveDraft(uid: string | null | undefined, draft: Omit<PostDraft, 'id'>): void {
  if (typeof window === 'undefined') return;
  try {
    if (!draft.caption.trim() && !draft.hashtagInput.trim() && !draft.locationTag.trim()) {
      window.localStorage.removeItem(autosaveKey(uid));
      return;
    }
    window.localStorage.setItem(
      autosaveKey(uid),
      JSON.stringify({
        id: 'autosave',
        ...draft,
        mediaPreviewDataUrl: undefined,
      })
    );
  } catch {
    // ignore storage quota issues for autosave
  }
}

export function clearAutosaveDraft(uid?: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(autosaveKey(uid));
  } catch {
    // ignore
  }
}

export function isCropModified(config: ImageCropConfig): boolean {
  return (
    config.aspectRatio !== 'original' ||
    config.rotation !== 0 ||
    Math.abs(config.zoom - 1) > 0.01 ||
    Math.abs(config.panX - 50) > 1 ||
    Math.abs(config.panY - 50) > 1
  );
}

export function getTargetAspectNumeric(
  aspectRatio: AspectRatioType | 'original',
  naturalWidth: number,
  naturalHeight: number
): number {
  if (aspectRatio === 'square') return 1;
  if (aspectRatio === 'landscape') return 4 / 3;
  if (aspectRatio === 'portrait') return 3 / 4;
  if (aspectRatio === 'vertical') return 9 / 16;
  return naturalHeight > 0 ? naturalWidth / naturalHeight : 4 / 3;
}

export async function renderCroppedImageFile(
  sourceFile: File,
  config: ImageCropConfig
): Promise<File> {
  if (!isCropModified(config)) return sourceFile;

  const objectUrl = URL.createObjectURL(sourceFile);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode image for cropping.'));
      el.src = objectUrl;
    });

    const rotatedSwap = config.rotation === 90 || config.rotation === 270;
    const rotW = rotatedSwap ? img.naturalHeight : img.naturalWidth;
    const rotH = rotatedSwap ? img.naturalWidth : img.naturalHeight;
    if (!rotW || !rotH) return sourceFile;

    // 1. Draw rotated original onto intermediate canvas
    const rotCanvas = document.createElement('canvas');
    rotCanvas.width = rotW;
    rotCanvas.height = rotH;
    const rotCtx = rotCanvas.getContext('2d');
    if (!rotCtx) return sourceFile;

    rotCtx.save();
    rotCtx.translate(rotW / 2, rotH / 2);
    rotCtx.rotate((config.rotation * Math.PI) / 180);
    rotCtx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    rotCtx.restore();

    // 2. Compute crop box within rotated bounds
    const targetAspect = getTargetAspectNumeric(config.aspectRatio, rotW, rotH);
    const sourceAspect = rotW / rotH;

    let baseCropW = rotW;
    let baseCropH = rotH;
    if (sourceAspect > targetAspect) {
      baseCropH = rotH;
      baseCropW = Math.round(rotH * targetAspect);
    } else {
      baseCropW = rotW;
      baseCropH = Math.round(rotW / targetAspect);
    }

    const safeZoom = Math.min(2, Math.max(1, config.zoom));
    const cropW = Math.max(16, Math.round(baseCropW / safeZoom));
    const cropH = Math.max(16, Math.round(baseCropH / safeZoom));

    const maxOffsetX = Math.max(0, rotW - cropW);
    const maxOffsetY = Math.max(0, rotH - cropH);
    const sx = Math.round((Math.min(100, Math.max(0, config.panX)) / 100) * maxOffsetX);
    const sy = Math.round((Math.min(100, Math.max(0, config.panY)) / 100) * maxOffsetY);

    const maxOutDim = 1440;
    const outScale = Math.max(cropW, cropH) > maxOutDim ? maxOutDim / Math.max(cropW, cropH) : 1;
    const outW = Math.max(1, Math.round(cropW * outScale));
    const outH = Math.max(1, Math.round(cropH * outScale));

    const outCanvas = document.createElement('canvas');
    outCanvas.width = outW;
    outCanvas.height = outH;
    const outCtx = outCanvas.getContext('2d');
    if (!outCtx) {
      rotCanvas.width = 0;
      rotCanvas.height = 0;
      return sourceFile;
    }

    outCtx.imageSmoothingEnabled = true;
    outCtx.imageSmoothingQuality = 'high';
    outCtx.drawImage(rotCanvas, sx, sy, cropW, cropH, 0, 0, outW, outH);

    rotCanvas.width = 0;
    rotCanvas.height = 0;

    const blob = await new Promise<Blob | null>((resolve) => {
      outCanvas.toBlob((b) => resolve(b), 'image/webp', 0.88);
    });
    const fallbackBlob =
      blob ||
      (await new Promise<Blob | null>((resolve) => {
        outCanvas.toBlob((b) => resolve(b), 'image/jpeg', 0.88);
      }));

    outCanvas.width = 0;
    outCanvas.height = 0;

    if (!fallbackBlob) return sourceFile;

    const baseName = sourceFile.name.replace(/\.[^.]+$/, '') || 'photo';
    const ext = fallbackBlob.type === 'image/webp' ? 'webp' : 'jpg';
    return new File([fallbackBlob], `${baseName}_edited.${ext}`, {
      type: fallbackBlob.type,
      lastModified: Date.now(),
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function buildFinalCaption(caption: string, locationTag: string): string {
  const cleanCaption = caption.trim();
  const cleanLocation = locationTag.trim();
  if (!cleanLocation) return cleanCaption.slice(0, 1000);

  const locationLine = `📍 ${cleanLocation}`;
  if (!cleanCaption) {
    return locationLine.slice(0, 1000);
  }
  const suffix = `\n\n${locationLine}`;
  const maxBody = Math.max(0, 1000 - suffix.length);
  return `${cleanCaption.slice(0, maxBody).trimEnd()}${suffix}`;
}
