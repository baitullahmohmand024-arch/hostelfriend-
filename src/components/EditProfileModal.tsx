import React, { useEffect, useRef, useState } from 'react';
import { updateProfile } from 'firebase/auth';
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Loader2,
  MapPin,
  User as UserIcon,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { UserProfile } from '../types';
import { checkUsernameAvailable, updateUserProfile } from '../services/userService';
import { uploadMediaFile, validateMediaFile } from '../services/mediaService';
import { Avatar } from './Avatar';
import { sanitizeUsername } from '../utils/formatters';
import { formatUserFriendlyError } from '../lib/firestoreError';
import { useModalBackHandler } from '../lib/backNavigation';
import { playSound } from '../utils/soundVfx';
import defaultCoverImg from '../assets/images/default_cover_obsidian_1794541690832.jpg';

interface EditProfileModalProps {
  open: boolean;
  member: UserProfile;
  onClose: () => void;
  onUpdated: (updated: UserProfile) => void;
}

export function EditProfileModal({
  open,
  member,
  onClose,
  onUpdated,
}: EditProfileModalProps) {
  const { firebaseUser, platformSettings, setProfile: setAuthProfile } = useAuth();
  const { showToast } = useToast();

  const [fullName, setFullName] = useState(member.fullName);
  const [username, setUsername] = useState(member.username);
  const [bio, setBio] = useState(member.bio);
  const [hostel, setHostel] = useState(member.hostel);
  const [avatarUrl, setAvatarUrl] = useState(member.avatarUrl);
  const [coverUrl, setCoverUrl] = useState(member.coverUrl);

  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState('');
  const [coverPreviewUrl, setCoverPreviewUrl] = useState('');
  const [coverImgFailed, setCoverImgFailed] = useState(false);

  const [uploadingTarget, setUploadingTarget] = useState<'avatars' | 'covers' | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const [usernameStatus, setUsernameStatus] = useState<
    'unchanged' | 'checking' | 'available' | 'taken' | 'invalid'
  >('unchanged');

  const checkSeqRef = useRef(0);

  // Sync initial fields whenever modal opens
  useEffect(() => {
    if (!open) return;
    setFullName(member.fullName);
    setUsername(member.username);
    setBio(member.bio);
    setHostel(member.hostel);
    setAvatarUrl(member.avatarUrl);
    setCoverUrl(member.coverUrl);
    setCoverImgFailed(false);
    setFormError('');
    setUsernameStatus('unchanged');
    setUploadingTarget(null);
    setUploadProgress(0);
  }, [open, member]);

  // Clean up object URLs
  useEffect(() => {
    return () => {
      if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
    };
  }, [avatarPreviewUrl]);

  useEffect(() => {
    return () => {
      if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    };
  }, [coverPreviewUrl]);

  useModalBackHandler(open, () => {
    if (!saving && !uploadingTarget) {
      onClose();
    }
  });

  // Close on Escape when not busy
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving && !uploadingTarget) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, saving, uploadingTarget, onClose]);

  // Debounced username availability check when changed
  useEffect(() => {
    if (!open) return;
    const clean = sanitizeUsername(username);
    const lower = clean.toLowerCase();
    if (lower === member.usernameLower) {
      setUsernameStatus('unchanged');
      return;
    }
    if (clean.length < 3 || !/^[a-zA-Z0-9_]+$/.test(clean)) {
      setUsernameStatus('invalid');
      return;
    }
    const seq = ++checkSeqRef.current;
    setUsernameStatus('checking');
    const timer = window.setTimeout(async () => {
      try {
        const available = await checkUsernameAvailable(clean);
        if (checkSeqRef.current !== seq) return;
        setUsernameStatus(available ? 'available' : 'taken');
      } catch {
        if (checkSeqRef.current === seq) {
          setUsernameStatus('unchanged');
        }
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [open, username, member.usernameLower]);

  if (!open) return null;

  const handleMediaPick = async (
    e: React.ChangeEvent<HTMLInputElement>,
    folder: 'avatars' | 'covers'
  ) => {
    setFormError('');
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const validation = validateMediaFile(file, platformSettings.maxUploadSizeMB);
    if (!validation.valid || validation.mediaType !== 'image') {
      setFormError(
        validation.error || 'Please select a valid JPEG, PNG, WebP, or GIF image.'
      );
      return;
    }

    const localPreview = URL.createObjectURL(file);
    if (folder === 'avatars') {
      if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
      setAvatarPreviewUrl(localPreview);
    } else {
      if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
      setCoverPreviewUrl(localPreview);
      setCoverImgFailed(false);
    }

    setUploadingTarget(folder);
    setUploadProgress(6);

    try {
      const uploadedUrl = await uploadMediaFile(file, folder, member.uid, (pct) => {
        setUploadProgress(pct);
      });
      if (folder === 'avatars') {
        setAvatarUrl(uploadedUrl);
        URL.revokeObjectURL(localPreview);
        setAvatarPreviewUrl('');
      } else {
        setCoverUrl(uploadedUrl);
        setCoverImgFailed(false);
        URL.revokeObjectURL(localPreview);
        setCoverPreviewUrl('');
      }
      playSound('upload-success');
      showToast({
        type: 'success',
        title: folder === 'avatars' ? 'Profile photo ready' : 'Cover photo ready',
        description: 'Tap Save Changes to apply it to your profile.',
      });
    } catch (err) {
      if (folder === 'avatars') {
        URL.revokeObjectURL(localPreview);
        setAvatarPreviewUrl('');
      } else {
        URL.revokeObjectURL(localPreview);
        setCoverPreviewUrl('');
      }
      setFormError(formatUserFriendlyError(err, 'Could not upload image. Please try again.'));
    } finally {
      setUploadingTarget(null);
      setUploadProgress(0);
    }
  };

  const trimmedName = fullName.trim();
  const cleanUsername = sanitizeUsername(username);
  const nameValid = trimmedName.length >= 1 && trimmedName.length <= 64;
  const usernameValid = cleanUsername.length >= 3 && /^[a-zA-Z0-9_]+$/.test(cleanUsername);
  const canSubmit =
    !saving &&
    !uploadingTarget &&
    nameValid &&
    usernameValid &&
    usernameStatus !== 'checking' &&
    usernameStatus !== 'taken' &&
    usernameStatus !== 'invalid';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!nameValid) {
      setFormError('Please enter your display name (1 to 64 characters).');
      return;
    }
    if (!usernameValid) {
      setFormError('Username must be 3–24 characters using letters, numbers, or underscores.');
      return;
    }
    if (usernameStatus === 'taken') {
      setFormError(`@${cleanUsername} is already taken. Please pick another username.`);
      return;
    }

    setSaving(true);
    try {
      const updated = await updateUserProfile(member.uid, member.usernameLower, {
        fullName: trimmedName,
        username: cleanUsername,
        bio,
        hostel,
        avatarUrl,
        coverUrl,
      });

      if (firebaseUser) {
        const authUpdates: { displayName?: string; photoURL?: string } = {};
        if (updated.fullName !== firebaseUser.displayName) {
          authUpdates.displayName = updated.fullName;
        }
        if (
          updated.avatarUrl &&
          updated.avatarUrl.startsWith('https://') &&
          updated.avatarUrl.length <= 1800 &&
          updated.avatarUrl !== firebaseUser.photoURL
        ) {
          authUpdates.photoURL = updated.avatarUrl;
        }
        if (Object.keys(authUpdates).length > 0) {
          await updateProfile(firebaseUser, authUpdates).catch(() => {});
        }
      }

      setAuthProfile(updated);
      onUpdated(updated);
      playSound('upload-success');
      showToast({ type: 'success', title: 'Profile saved successfully' });
      onClose();
    } catch (err) {
      setFormError(formatUserFriendlyError(err, 'Could not save profile changes.'));
    } finally {
      setSaving(false);
    }
  };

  const displayCover = coverPreviewUrl || (coverImgFailed ? '' : coverUrl || defaultCoverImg);
  const displayAvatar = avatarPreviewUrl || avatarUrl;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Edit Profile"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full sm:max-w-lg rounded-t-3xl sm:rounded-2xl glass-modal hf-modal-enter overflow-hidden pb-[env(safe-area-inset-bottom)] sm:pb-0 max-h-[92vh] flex flex-col"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-hairline bg-surface-2 flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-display text-base font-bold text-ink">Edit Profile</h2>
            <p className="text-[11px] text-ink-muted">
              Update your Hostel Friend identity and photos
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving || Boolean(uploadingTarget)}
            aria-label="Close edit profile"
            className="min-w-[40px] min-h-[40px] rounded-full flex items-center justify-center text-ink-muted hover:text-ink hover:bg-hover-tint transition-colors disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="overflow-y-auto flex-1">
          {/* Cover & Avatar Live Preview Stage */}
          <div className="relative">
            <div className="h-32 sm:h-36 bg-canvas-alt relative overflow-hidden">
              {displayCover ? (
                <img
                  src={displayCover}
                  alt="Cover preview"
                  referrerPolicy="no-referrer"
                  onError={() => setCoverImgFailed(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-surface-hover via-surface to-canvas" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-surface via-black/25 to-black/30" />

              <label className="cursor-pointer absolute top-3 right-3 min-h-[36px] px-3 py-1.5 rounded-xl bg-black/75 hover:bg-black border border-white/25 text-xs font-semibold text-white inline-flex items-center gap-1.5 backdrop-blur-sm transition-colors">
                <Camera className="w-3.5 h-3.5 text-accent" />
                <span>
                  {uploadingTarget === 'covers'
                    ? `Uploading ${uploadProgress}%`
                    : 'Change Cover'}
                </span>
                <input
                  type="file"
                  accept="image/jpeg, image/png, image/webp, image/gif"
                  disabled={Boolean(uploadingTarget) || saving}
                  onChange={(e) => handleMediaPick(e, 'covers')}
                  className="sr-only"
                />
              </label>
            </div>

            <div className="px-5 -mt-10 pb-2 flex items-end justify-between gap-4 relative z-10">
              <div className="relative rounded-full p-1 bg-surface ring-1 ring-accent/35">
                <Avatar
                  src={displayAvatar}
                  name={trimmedName || member.fullName}
                  size="lg"
                  className="w-20 h-20"
                />
                <label
                  title="Change profile picture"
                  aria-label="Change profile picture"
                  className="cursor-pointer absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-gradient-to-br from-accent-soft to-accent-deep text-accent-fg border-2 border-surface flex items-center justify-center shadow-lg hover:scale-105 transition-transform"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <input
                    type="file"
                    accept="image/jpeg, image/png, image/webp, image/gif"
                    disabled={Boolean(uploadingTarget) || saving}
                    onChange={(e) => handleMediaPick(e, 'avatars')}
                    className="sr-only"
                  />
                </label>
              </div>

              <label className="cursor-pointer min-h-[38px] px-3.5 py-2 rounded-xl border border-hairline-strong bg-surface-2 hover:border-accent/50 text-xs font-medium text-ink inline-flex items-center gap-2 transition-colors">
                <Camera className="w-3.5 h-3.5 text-accent" />
                <span>
                  {uploadingTarget === 'avatars'
                    ? `Uploading ${uploadProgress}%`
                    : 'Change Profile Picture'}
                </span>
                <input
                  type="file"
                  accept="image/jpeg, image/png, image/webp, image/gif"
                  disabled={Boolean(uploadingTarget) || saving}
                  onChange={(e) => handleMediaPick(e, 'avatars')}
                  className="sr-only"
                />
              </label>
            </div>
          </div>

          <div className="p-5 space-y-4">
            {uploadingTarget && (
              <div className="rounded-xl bg-canvas-alt border border-accent/30 p-3 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-accent font-medium">
                    Uploading {uploadingTarget === 'avatars' ? 'profile picture' : 'cover photo'}...
                  </span>
                  <span className="font-mono text-ink tabular-nums">
                    {uploadProgress}%
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-hover-tint overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-accent-deep to-accent-soft transition-all duration-150"
                    style={{ width: `${Math.max(6, uploadProgress)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Full Name */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="edit-full-name" className="text-xs font-medium text-ink-muted">
                  Full Name
                </label>
                <span className="font-mono text-[11px] text-ink-subtle tabular-nums">
                  {fullName.length}/64
                </span>
              </div>
              <input
                id="edit-full-name"
                type="text"
                required
                maxLength={64}
                disabled={saving}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your full name"
                className="w-full min-h-[44px] rounded-xl bg-canvas border border-hairline px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-accent"
              />
            </div>

            {/* Username */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="edit-username" className="text-xs font-medium text-ink-muted">
                  Username
                </label>
                <span className="font-mono text-[11px] text-ink-subtle tabular-nums">
                  {cleanUsername.length}/24
                </span>
              </div>
              <div className="relative">
                <UserIcon className="w-4 h-4 text-ink-subtle absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="edit-username"
                  type="text"
                  required
                  minLength={3}
                  maxLength={24}
                  disabled={saving}
                  value={username}
                  onChange={(e) => setUsername(sanitizeUsername(e.target.value))}
                  placeholder="username"
                  className="w-full min-h-[44px] rounded-xl bg-canvas border border-hairline pl-9 pr-3.5 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-accent"
                />
              </div>
              {usernameStatus === 'checking' && (
                <p className="mt-1 text-[11px] text-ink-muted inline-flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin text-accent" />
                  Checking username availability...
                </p>
              )}
              {usernameStatus === 'available' && (
                <p className="mt-1 text-[11px] text-emerald-400 inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />@{cleanUsername} is available
                </p>
              )}
              {usernameStatus === 'taken' && (
                <p className="mt-1 text-[11px] text-rose-400">
                  @{cleanUsername} is already taken.
                </p>
              )}
              {usernameStatus === 'invalid' && (
                <p className="mt-1 text-[11px] text-amber-400">
                  Must be 3–24 characters (letters, numbers, underscores).
                </p>
              )}
            </div>

            {/* Hostel / College */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="edit-hostel" className="text-xs font-medium text-ink-muted">
                  Hostel or Institution
                </label>
                <span className="font-mono text-[11px] text-ink-subtle tabular-nums">
                  {hostel.length}/80
                </span>
              </div>
              <div className="relative">
                <MapPin className="w-4 h-4 text-ink-subtle absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="edit-hostel"
                  type="text"
                  maxLength={80}
                  disabled={saving}
                  value={hostel}
                  onChange={(e) => setHostel(e.target.value)}
                  placeholder="e.g. Osman Hall · Islamia College Peshawar"
                  className="w-full min-h-[44px] rounded-xl bg-canvas border border-hairline pl-9 pr-3.5 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-accent"
                />
              </div>
            </div>

            {/* Bio */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="edit-bio" className="text-xs font-medium text-ink-muted">
                  Bio / About
                </label>
                <span className="font-mono text-[11px] text-ink-subtle tabular-nums">
                  {bio.length}/240
                </span>
              </div>
              <textarea
                id="edit-bio"
                rows={3}
                maxLength={240}
                disabled={saving}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Tell hostel friends what you're studying or interested in..."
                className="w-full rounded-xl bg-canvas border border-hairline px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-accent resize-none leading-relaxed"
              />
            </div>

            {formError && (
              <div
                role="alert"
                className="rounded-xl bg-rose-500/10 border border-rose-500/30 px-3.5 py-2.5 flex items-start gap-2 text-xs text-rose-300"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                <span>{formError}</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-4 border-t border-hairline bg-surface-2 flex items-center justify-end gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={saving || Boolean(uploadingTarget)}
            className="min-h-[42px] px-4 py-2 rounded-xl text-xs font-medium border border-hairline-strong text-ink hover:bg-hover-tint disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="min-h-[42px] gold-gradient-btn px-5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-2 disabled:opacity-45"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{saving ? 'Saving...' : 'Save Changes'}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
