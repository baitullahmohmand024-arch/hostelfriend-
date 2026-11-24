import { useEffect, useRef, useState } from 'react';
import { Check, Crop, RotateCw, RotateCcw, X, ZoomIn } from 'lucide-react';
import { AspectRatioType } from '../types';
import { DEFAULT_CROP_CONFIG, ImageCropConfig } from '../utils/postComposerHelpers';

interface MediaCropModalProps {
  open: boolean;
  file: File | null;
  initialConfig: ImageCropConfig;
  onClose: () => void;
  onApply: (config: ImageCropConfig) => void;
}

const CROP_RATIOS: ReadonlyArray<{
  id: AspectRatioType | 'original';
  label: string;
  aspectCss: string;
}> = [
  { id: 'original', label: 'Original', aspectCss: 'aspect-[4/3]' },
  { id: 'square', label: '1:1', aspectCss: 'aspect-square' },
  { id: 'landscape', label: '4:3', aspectCss: 'aspect-[4/3]' },
  { id: 'portrait', label: '3:4', aspectCss: 'aspect-[3/4]' },
  { id: 'vertical', label: '9:16', aspectCss: 'aspect-[9/16]' },
];

export function MediaCropModal({
  open,
  file,
  initialConfig,
  onClose,
  onApply,
}: MediaCropModalProps) {
  const [config, setConfig] = useState<ImageCropConfig>(initialConfig);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number }>({ w: 4, h: 3 });
  const dragStartRef = useRef<{ clientX: number; clientY: number; panX: number; panY: number } | null>(null);

  useEffect(() => {
    setConfig(initialConfig);
  }, [initialConfig, open]);

  useEffect(() => {
    if (!open || !file) {
      setPreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [open, file]);

  if (!open || !file) return null;

  const currentAspectCss = (() => {
    if (config.aspectRatio === 'original') {
      const swapped = config.rotation === 90 || config.rotation === 270;
      const w = swapped ? naturalSize.h : naturalSize.w;
      const h = swapped ? naturalSize.w : naturalSize.h;
      return w >= h ? 'aspect-[4/3]' : 'aspect-[3/4]';
    }
    return CROP_RATIOS.find((r) => r.id === config.aspectRatio)?.aspectCss || 'aspect-[4/3]';
  })();

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      panX: config.panX,
      panY: config.panY,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.clientX;
    const dy = e.clientY - dragStartRef.current.clientY;
    const nextPanX = Math.min(100, Math.max(0, Math.round(dragStartRef.current.panX - dx * 0.35)));
    const nextPanY = Math.min(100, Math.max(0, Math.round(dragStartRef.current.panY - dy * 0.35)));
    setConfig((prev) => ({ ...prev, panX: nextPanX, panY: nextPanY }));
  };

  const handlePointerUp = () => {
    dragStartRef.current = null;
  };

  const handleRotate = () => {
    setConfig((prev) => ({
      ...prev,
      rotation: (((prev.rotation + 90) % 360) as 0 | 90 | 180 | 270),
    }));
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Crop and position photo"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl glass-modal hf-modal-enter overflow-hidden flex flex-col max-h-[92vh]"
      >
        <div className="px-5 py-4 border-b border-hairline flex items-center justify-between bg-surface-2 shrink-0">
          <div className="flex items-center gap-2">
            <Crop className="w-4 h-4 text-accent" />
            <h2 className="font-display text-base font-bold text-ink">Crop & Frame Photo</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close crop editor"
            className="min-w-[40px] min-h-[40px] rounded-full inline-flex items-center justify-center text-ink-muted hover:text-ink hover:bg-hover-tint transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Interactive Crop Viewport */}
          <div className="flex justify-center bg-canvas-alt rounded-2xl border border-hairline p-4">
            <div
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className={`${currentAspectCss} w-full max-w-[290px] max-h-[300px] rounded-xl overflow-hidden bg-black relative cursor-grab active:cursor-grabbing select-none touch-none border border-accent/40`}
            >
              {previewUrl && (
                <img
                  src={previewUrl}
                  alt="Crop preview"
                  draggable={false}
                  onLoad={(e) =>
                    setNaturalSize({
                      w: e.currentTarget.naturalWidth || 4,
                      h: e.currentTarget.naturalHeight || 3,
                    })
                  }
                  style={{
                    objectPosition: `${config.panX}% ${config.panY}%`,
                    transform: `rotate(${config.rotation}deg) scale(${config.zoom})`,
                  }}
                  className="w-full h-full object-cover transition-transform duration-75"
                />
              )}
              <div className="pointer-events-none absolute inset-0 border border-white/25 grid grid-cols-3 grid-rows-3">
                {Array.from({ length: 9 }).map((_, idx) => (
                  <div key={idx} className="border border-white/10" />
                ))}
              </div>
            </div>
          </div>

          <p className="text-[11px] text-center text-ink-muted">
            Drag inside the frame or use sliders below to adjust positioning
          </p>

          {/* Aspect Ratio Buttons */}
          <div className="space-y-1.5">
            <span className="text-xs font-medium text-ink-muted">Frame Aspect</span>
            <div className="flex flex-wrap gap-1.5">
              {CROP_RATIOS.map((ratio) => (
                <button
                  key={ratio.id}
                  type="button"
                  onClick={() => setConfig((prev) => ({ ...prev, aspectRatio: ratio.id }))}
                  className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    config.aspectRatio === ratio.id
                      ? 'bg-accent text-accent-fg'
                      : 'bg-surface-2 border border-hairline text-ink-muted hover:text-ink'
                  }`}
                >
                  {ratio.label}
                </button>
              ))}
            </div>
          </div>

          {/* Zoom + Position Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block space-y-1 text-xs text-ink-muted">
              <span className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1">
                  <ZoomIn className="w-3.5 h-3.5 text-accent" />
                  Zoom
                </span>
                <span className="font-mono tabular-nums text-ink">{config.zoom.toFixed(1)}x</span>
              </span>
              <input
                type="range"
                min={1}
                max={2}
                step={0.1}
                value={config.zoom}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, zoom: parseFloat(e.target.value) }))
                }
                className="w-full accent-[var(--hf-accent)]"
              />
            </label>

            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={handleRotate}
                className="flex-1 min-h-[40px] px-3 rounded-xl bg-surface-2 border border-hairline hover:border-accent/40 text-xs font-semibold text-ink inline-flex items-center justify-center gap-1.5"
              >
                <RotateCw className="w-3.5 h-3.5 text-accent" />
                <span>Rotate 90°</span>
              </button>
              <button
                type="button"
                onClick={() => setConfig(DEFAULT_CROP_CONFIG)}
                className="min-h-[40px] px-3 rounded-xl bg-surface-2 border border-hairline hover:border-accent/40 text-xs font-medium text-ink-muted hover:text-ink inline-flex items-center justify-center gap-1"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1 text-xs text-ink-muted">
              <span className="flex justify-between">
                <span>Horizontal</span>
                <span className="font-mono tabular-nums">{config.panX}%</span>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={config.panX}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, panX: parseInt(e.target.value, 10) }))
                }
                className="w-full accent-[var(--hf-accent)]"
              />
            </label>
            <label className="block space-y-1 text-xs text-ink-muted">
              <span className="flex justify-between">
                <span>Vertical</span>
                <span className="font-mono tabular-nums">{config.panY}%</span>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={config.panY}
                onChange={(e) =>
                  setConfig((prev) => ({ ...prev, panY: parseInt(e.target.value, 10) }))
                }
                className="w-full accent-[var(--hf-accent)]"
              />
            </label>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-hairline bg-surface-2 flex items-center justify-end gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[42px] px-4 rounded-xl border border-hairline text-xs font-semibold text-ink-muted hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onApply(config)}
            className="min-h-[42px] px-5 rounded-xl gold-gradient-btn text-xs font-semibold inline-flex items-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Apply Crop</span>
          </button>
        </div>
      </div>
    </div>
  );
}
