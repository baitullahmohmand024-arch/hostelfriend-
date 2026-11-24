import React, { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, Upload } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { updateUserProfile } from '../services/userService';
import { formatBytes, uploadMediaFile, validateMediaFile } from '../services/mediaService';
import { formatUserFriendlyError } from '../lib/firestoreError';
import { playSound } from '../utils/soundVfx';

export function CoverUploadCard() {
  const { profile, platformSettings, setProfile } = useAuth();
  const { showToast } = useToast();
  const inputFileRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  if (!profile) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMsg('');
    const file = e.target.files?.[0] || null;
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl('');
    }
    if (!file) {
      setSelectedFile(null);
      return;
    }
    const validation = validateMediaFile(file, platformSettings.maxUploadSizeMB);
    if (!validation.valid || validation.mediaType !== 'image') {
      setErrorMsg(validation.error || 'Please choose a JPEG, PNG, or WebP cover image.');
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!selectedFile) {
      setErrorMsg('Please select a cover photo from your gallery first.');
      return;
    }
    setUploading(true);
    setProgressPercent(5);
    try {
      const coverUrl = await uploadMediaFile(selectedFile, 'covers', profile.uid, (pct) => {
        setProgressPercent(pct);
      });
      const updated = await updateUserProfile(profile.uid, profile.usernameLower, {
        coverUrl,
      });
      setProfile(updated);
      setSelectedFile(null);
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        setPreviewUrl('');
      }
      if (inputFileRef.current) inputFileRef.current.value = '';
      playSound('upload-success');
      showToast({
        type: 'success',
        title: 'Cover photo updated',
        description: 'Your new cover photo is now visible on your profile.',
      });
    } catch (err) {
      const msg = formatUserFriendlyError(err, 'Unable to upload cover photo.');
      setErrorMsg(msg);
      showToast({
        type: 'error',
        title: 'Cover photo upload failed',
        description: msg,
      });
    } finally {
      setUploading(false);
    }
  };

  const activeCover = previewUrl || profile.coverUrl;

  return (
    <form
      onSubmit={handleSubmit}
      className="glass-card rounded-2xl p-6 space-y-4"
    >
      <div className="flex items-center justify-between pb-2 border-b border-hairline">
        <div className="flex items-center gap-2.5">
          <ImageIcon className="w-4 h-4 text-accent-strong" />
          <h2 className="font-display text-base font-semibold text-ink-2">
            Profile Cover Photo
          </h2>
        </div>
        <span className="text-[11px] text-ink-subtle">JPEG, PNG, or WebP · Gallery</span>
      </div>

      <div className="rounded-xl overflow-hidden bg-canvas-alt border border-hairline h-32 sm:h-40 relative">
        {activeCover ? (
          <img
            src={activeCover}
            alt="Profile cover preview"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-surface-hover via-surface to-canvas flex items-center justify-center text-xs text-ink-subtle">
            No custom cover photo selected yet
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <label className="cursor-pointer px-3.5 py-2 rounded-xl border border-hairline-strong bg-canvas-alt text-xs font-medium text-ink-2 hover:border-accent-strong/50 transition-colors inline-flex items-center gap-2">
            <Upload className="w-3.5 h-3.5 text-accent-strong" />
            <span>{selectedFile ? 'Change Cover' : 'Choose from Gallery'}</span>
            <input
              ref={inputFileRef}
              type="file"
              accept="image/jpeg, image/png, image/webp"
              disabled={uploading}
              onChange={handleFileChange}
              className="sr-only"
            />
          </label>

          <button
            type="submit"
            disabled={uploading || !selectedFile}
            className="gold-gradient-btn px-4 py-2 rounded-xl text-xs font-semibold disabled:opacity-50"
          >
            {uploading ? `Uploading ${progressPercent}%` : 'Save Cover'}
          </button>
        </div>

        {selectedFile && (
          <span className="text-xs text-ink-muted truncate max-w-full">
            {selectedFile.name} ({formatBytes(selectedFile.size)})
          </span>
        )}
      </div>

      {uploading && (
        <div className="w-full h-1.5 rounded-full bg-hover-tint overflow-hidden">
          <div
            className="h-full bg-accent-strong transition-all duration-150"
            style={{ width: `${Math.max(5, progressPercent)}%` }}
          />
        </div>
      )}

      {errorMsg && (
        <p role="alert" className="text-xs text-rose-400">
          {errorMsg}
        </p>
      )}
    </form>
  );
}
