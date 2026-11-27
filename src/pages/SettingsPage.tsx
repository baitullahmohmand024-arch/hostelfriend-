import React, { useEffect, useState } from 'react';
import {
  EmailAuthProvider,
  deleteUser,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth';
import { Bell, BellRing, Lock, LogOut, ShieldAlert, Trash2, User, Volume2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { NotificationPreferences, UserProfile } from '../types';
import {
  deleteOwnAccountRecords,
  getUserProfile,
  updateUserPrivateSettings,
  updateUserProfile,
} from '../services/userService';
import { updateNotificationPreferences } from '../services/notificationService';
import {
  getBrowserNotificationPermission,
  getNotificationPermissionState,
  getPushSupportState,
  PushSupportState,
  unregisterCurrentFcmToken,
} from '../services/fcmService';
import { Avatar } from '../components/Avatar';
import { AvatarUploadCard } from '../components/AvatarUploadCard';
import { CoverUploadCard } from '../components/CoverUploadCard';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { PWAInstallButton } from '../components/PWAInstallButton';
import { ThemeCustomizationCard } from '../components/ThemeCustomizationCard';
import { sanitizeUsername } from '../utils/formatters';
import { formatUserFriendlyError } from '../lib/firestoreError';
import {
  extractAuthErrorDetails,
  formatGoogleAuthError,
  isGenuineGoogleCancelError,
} from '../lib/googleAuthError';
import { isAndroidNative, isNativePlatform } from '../lib/nativePlatform';
import {
  isSoundVfxEnabled,
  playSound,
  setSoundVfxEnabled,
  subscribeSoundPreference,
} from '../utils/soundVfx';

interface SettingsPageProps {
  onLoggedOut: () => void;
}

export function SettingsPage({ onLoggedOut }: SettingsPageProps) {
  const {
    firebaseUser,
    profile,
    privateSettings,
    notificationPreferences,
    setProfile,
    setPrivateSettings,
    setNotificationPreferences,
    enablePushNotifications,
    linkGoogleAccount,
    logout,
  } = useAuth();
  const { showToast } = useToast();

  // Account edit fields
  const [fullName, setFullName] = useState(profile?.fullName || '');
  const [username, setUsername] = useState(profile?.username || '');
  const [hostel, setHostel] = useState(profile?.hostel || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [savingAccount, setSavingAccount] = useState(false);

  // Password change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  // Blocked profiles lookup
  const [blockedUsers, setBlockedUsers] = useState<UserProfile[]>([]);

  // Delete account modal
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [linkingGoogle, setLinkingGoogle] = useState(false);

  const [soundEnabled, setSoundEnabled] = useState(() => isSoundVfxEnabled());
  const [pushSupport, setPushSupport] = useState<PushSupportState>('supported');
  const [pushBusy, setPushBusy] = useState(false);
  const [browserPerm, setBrowserPerm] = useState<NotificationPermission | 'unsupported'>(() =>
    getBrowserNotificationPermission()
  );

  useEffect(() => {
    void getPushSupportState().then(setPushSupport);
    void getNotificationPermissionState().then(setBrowserPerm);
    const unsubSound = subscribeSoundPreference(setSoundEnabled);
    return () => {
      unsubSound();
    };
  }, []);

  useEffect(() => {
    if (profile) {
      setFullName(profile.fullName);
      setUsername(profile.username);
      setHostel(profile.hostel);
      setBio(profile.bio);
    }
  }, [profile]);

  useEffect(() => {
    const ids = privateSettings?.blockedUserIds || [];
    if (ids.length === 0) {
      setBlockedUsers([]);
      return;
    }
    Promise.all(ids.map((uid) => getUserProfile(uid)))
      .then((list) => setBlockedUsers(list.filter((u): u is UserProfile => Boolean(u))))
      .catch(() => {});
  }, [privateSettings?.blockedUserIds]);

  const hasPasswordProvider = Boolean(
    firebaseUser?.providerData.some((p) => p.providerId === 'password')
  );
  const hasGoogleProvider = Boolean(
    firebaseUser?.providerData.some((p) => p.providerId === 'google.com')
  );

  const handleLinkGoogle = async () => {
    setLinkingGoogle(true);
    try {
      await linkGoogleAccount();
      showToast({ type: 'success', title: 'Google account connected' });
    } catch (err) {
      if (!isGenuineGoogleCancelError(err)) {
        console.error('[HostelFriend][GoogleAuth] Link Google error:', extractAuthErrorDetails(err));
        showToast({
          type: 'error',
          title: 'Could not connect Google account',
          description: formatGoogleAuthError(err),
        });
      }
    } finally {
      setLinkingGoogle(false);
    }
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSavingAccount(true);
    try {
      const updated = await updateUserProfile(profile.uid, profile.usernameLower, {
        fullName,
        username: sanitizeUsername(username),
        hostel,
        bio,
      });
      setProfile(updated);
      showToast({ type: 'success', title: 'Account details updated' });
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Could not update account',
        description: formatUserFriendlyError(err),
      });
    } finally {
      setSavingAccount(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !firebaseUser.email) return;
    if (newPassword.length < 6) {
      showToast({ type: 'error', title: 'New password must be at least 6 characters' });
      return;
    }
    setChangingPassword(true);
    try {
      if (currentPassword) {
        const cred = EmailAuthProvider.credential(firebaseUser.email, currentPassword);
        await reauthenticateWithCredential(firebaseUser, cred);
      }
      await updatePassword(firebaseUser, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      showToast({ type: 'success', title: 'Password updated successfully' });
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Could not update password',
        description: formatUserFriendlyError(
          err,
          'Please verify your current password and try again.'
        ),
      });
    } finally {
      setChangingPassword(false);
    }
  };

  const handlePrivacyChange = async (mode: 'public' | 'followers') => {
    if (!profile || !privateSettings) return;
    try {
      const updated = await updateUserPrivateSettings(profile.uid, { privacyMode: mode });
      setPrivateSettings(updated);
      showToast({ type: 'success', title: 'Privacy preference saved' });
    } catch {
      showToast({ type: 'error', title: 'Could not update privacy setting' });
    }
  };

  const handleTogglePreference = async (
    field: keyof Omit<NotificationPreferences, 'uid' | 'updatedAt' | 'pushEnabled'>,
    nextVal: boolean
  ) => {
    if (!profile) return;
    try {
      const updated = await updateNotificationPreferences(profile.uid, { [field]: nextVal });
      setNotificationPreferences(updated);
    } catch {
      showToast({ type: 'error', title: 'Could not update notification preference' });
    }
  };

  const handleTogglePushNotifications = async (nextEnabled: boolean) => {
    if (!profile || pushBusy) return;
    setPushBusy(true);
    try {
      if (nextEnabled) {
        const res = await enablePushNotifications();
        void getNotificationPermissionState().then(setBrowserPerm);
        void getPushSupportState().then(setPushSupport);
        if (!res.ok) {
          showToast({
            type: 'info',
            title: 'Push notifications',
            description: res.reason,
          });
          return;
        }
        const updated = await updateNotificationPreferences(profile.uid, { pushEnabled: true });
        setNotificationPreferences(updated);
        showToast({ type: 'success', title: 'Push notifications enabled' });
      } else {
        await unregisterCurrentFcmToken(profile.uid);
        const updated = await updateNotificationPreferences(profile.uid, { pushEnabled: false });
        setNotificationPreferences(updated);
        void getNotificationPermissionState().then(setBrowserPerm);
        showToast({ type: 'info', title: 'Push notifications disabled on this device' });
      }
    } catch {
      showToast({ type: 'error', title: 'Could not update push setting' });
    } finally {
      setPushBusy(false);
    }
  };

  const handleUnblock = async (targetUid: string) => {
    if (!profile || !privateSettings) return;
    const nextIds = privateSettings.blockedUserIds.filter((id) => id !== targetUid);
    try {
      const updated = await updateUserPrivateSettings(profile.uid, { blockedUserIds: nextIds });
      setPrivateSettings(updated);
      showToast({ type: 'success', title: 'User unblocked' });
    } catch {
      showToast({ type: 'error', title: 'Could not unblock user' });
    }
  };

  const handleLogout = async () => {
    await logout();
    onLoggedOut();
  };

  const handleDeleteAccount = async () => {
    if (!firebaseUser || !profile) return;
    setDeletingAccount(true);
    try {
      await deleteOwnAccountRecords(profile.uid, profile.usernameLower);
      await deleteUser(firebaseUser);
      showToast({ type: 'info', title: 'Account permanently deleted' });
      onLoggedOut();
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Re-authentication required',
        description: formatUserFriendlyError(
          err,
          'Please log out and sign back in right before deleting your account.'
        ),
      });
    } finally {
      setDeletingAccount(false);
      setConfirmDeleteOpen(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink-2">Settings</h1>
        <p className="text-xs text-ink-muted mt-0.5">
          Customize your theme, manage your account, security, privacy, notifications, and blocked members
        </p>
      </div>

      {/* Theme Customization */}
      <ThemeCustomizationCard />

      {/* Upload Your Avatar & Cover Photo */}
      <AvatarUploadCard />
      <CoverUploadCard />

      {/* Edit Account */}
      <form
        onSubmit={handleSaveAccount}
        className="glass-card rounded-2xl p-6 space-y-4"
      >
        <div className="flex items-center gap-2.5 pb-2 border-b border-hairline">
          <User className="w-4 h-4 text-accent-strong" />
          <h2 className="font-display text-base font-semibold text-ink-2">Account Details</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block text-xs font-medium text-ink-muted">
            Full Name
            <input
              type="text"
              required
              maxLength={64}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1.5 w-full rounded-xl bg-canvas-alt border border-hairline px-3.5 py-2.5 text-sm text-ink-2 focus:outline-none focus:border-accent-strong"
            />
          </label>
          <label className="block text-xs font-medium text-ink-muted">
            Username
            <input
              type="text"
              required
              minLength={3}
              maxLength={24}
              value={username}
              onChange={(e) => setUsername(sanitizeUsername(e.target.value))}
              className="mt-1.5 w-full rounded-xl bg-canvas-alt border border-hairline px-3.5 py-2.5 text-sm text-ink-2 focus:outline-none focus:border-accent-strong"
            />
          </label>
        </div>

        <label className="block text-xs font-medium text-ink-muted">
          Hostel or Institution
          <input
            type="text"
            maxLength={80}
            value={hostel}
            onChange={(e) => setHostel(e.target.value)}
            className="mt-1.5 w-full rounded-xl bg-canvas-alt border border-hairline px-3.5 py-2.5 text-sm text-ink-2 focus:outline-none focus:border-accent-strong"
          />
        </label>

        <label className="block text-xs font-medium text-ink-muted">
          Bio
          <textarea
            rows={2}
            maxLength={240}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            className="mt-1.5 w-full rounded-xl bg-canvas-alt border border-hairline px-3.5 py-2.5 text-sm text-ink-2 focus:outline-none focus:border-accent-strong resize-none"
          />
        </label>

        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-ink-subtle">
            Account contact: {privateSettings?.email || firebaseUser?.email || 'Verified Member'}
          </span>
          <button
            type="submit"
            disabled={savingAccount}
            className="gold-gradient-btn px-5 py-2 rounded-xl text-xs font-semibold disabled:opacity-50"
          >
            {savingAccount ? 'Saving...' : 'Save Account'}
          </button>
        </div>
      </form>

      {/* Change Password */}
      <form
        onSubmit={handleChangePassword}
        className="glass-card rounded-2xl p-6 space-y-4"
      >
        <div className="flex items-center gap-2.5 pb-2 border-b border-hairline">
          <Lock className="w-4 h-4 text-accent-strong" />
          <h2 className="font-display text-base font-semibold text-ink-2">
            Password & Security
          </h2>
        </div>

        <div className="rounded-xl bg-canvas-alt border border-hairline p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-ink-2">Google Account Connection</p>
            <p className="text-xs text-ink-muted mt-0.5">
              {hasGoogleProvider
                ? `Connected to ${firebaseUser?.email || 'your Google account'} for one-tap sign-in.`
                : 'Connect your Google account for effortless one-tap sign-in.'}
            </p>
          </div>
          {hasGoogleProvider ? (
            <span className="text-xs font-medium text-accent-strong shrink-0">Connected</span>
          ) : (
            <button
              type="button"
              disabled={linkingGoogle}
              onClick={handleLinkGoogle}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold border border-accent-strong/40 text-ink-2 hover:border-accent-strong hover:bg-hover-tint disabled:opacity-50 shrink-0"
            >
              {linkingGoogle ? 'Connecting...' : 'Connect Google Account'}
            </button>
          )}
        </div>

        {!hasPasswordProvider ? (
          <p className="text-xs text-ink-muted leading-relaxed">
            You sign in using Google Authentication. Your password is managed securely through your
            Google Account.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block text-xs font-medium text-ink-muted">
              Current Password
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="mt-1.5 w-full rounded-xl bg-canvas-alt border border-hairline px-3.5 py-2.5 text-sm text-ink-2 focus:outline-none focus:border-accent-strong"
              />
            </label>
            <label className="block text-xs font-medium text-ink-muted">
              New Password
              <input
                type="password"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="mt-1.5 w-full rounded-xl bg-canvas-alt border border-hairline px-3.5 py-2.5 text-sm text-ink-2 focus:outline-none focus:border-accent-strong"
              />
            </label>
          </div>
        )}

        {hasPasswordProvider && (
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={changingPassword}
              className="px-5 py-2 rounded-xl text-xs font-semibold border border-hairline-strong text-ink-2 hover:border-accent-strong/40 disabled:opacity-50"
            >
              {changingPassword ? 'Updating...' : 'Update Password'}
            </button>
          </div>
        )}
      </form>

      {/* Privacy & Notification Preferences */}
      <div className="glass-card rounded-2xl p-6 space-y-5">
        <div className="flex items-center gap-2.5 pb-2 border-b border-hairline">
          <Bell className="w-4 h-4 text-accent-strong" />
          <h2 className="font-display text-base font-semibold text-ink-2">
            Privacy & Notifications
          </h2>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-ink-2">Profile Discovery Mode</p>
            <p className="text-xs text-ink-muted">
              Choose who can interact directly with your account
            </p>
          </div>
          <div className="inline-flex p-1 bg-canvas-alt rounded-xl border border-hairline self-start">
            <button
              type="button"
              onClick={() => handlePrivacyChange('public')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                privateSettings?.privacyMode !== 'followers'
                  ? 'bg-accent-strong text-accent-fg'
                  : 'text-ink-muted'
              }`}
            >
              Public Campus
            </button>
            <button
              type="button"
              onClick={() => handlePrivacyChange('followers')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                privateSettings?.privacyMode === 'followers'
                  ? 'bg-accent-strong text-accent-fg'
                  : 'text-ink-muted'
              }`}
            >
              Followers Only
            </button>
          </div>
        </div>

        <div className="space-y-3 pt-2 border-t border-hairline">
          <div className="rounded-xl bg-canvas-alt border border-accent/20 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <BellRing className="w-4 h-4 text-accent-strong shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-ink-2">
                  {isAndroidNative()
                    ? 'Push Notifications (Android App)'
                    : 'Push Notifications (Web & Android PWA)'}
                </p>
                <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">
                  {pushSupport === 'ios-needs-install'
                    ? 'On iPhone/iPad Safari, add Hostel Friend to your Home Screen first (iOS 16.4+) to enable push alerts.'
                    : pushSupport === 'missing-vapid'
                    ? 'In-app alerts are active. Set VITE_FIREBASE_VAPID_KEY in Vercel & redeploy to activate background Web Push.'
                    : pushSupport === 'unsupported-browser'
                    ? 'Your current browser or embedded preview frame blocks PushManager.'
                    : browserPerm === 'denied'
                    ? isAndroidNative()
                      ? 'Notifications are off in Android App Info -> Notifications. Re-enable them in Android system settings.'
                      : 'Notifications are blocked in your browser site settings. Re-enable them in browser permissions.'
                    : notificationPreferences?.pushEnabled && browserPerm === 'granted'
                    ? 'Active on this device. You will receive push alerts for enabled categories.'
                    : 'Receive real-time alerts even when the app is minimized or closed.'}
                </p>
              </div>
            </div>
            <label className="inline-flex items-center gap-2 shrink-0 cursor-pointer self-end sm:self-center">
              <span className="text-xs text-ink-muted">
                {pushBusy
                  ? 'Updating...'
                  : notificationPreferences?.pushEnabled &&
                    browserPerm === 'granted' &&
                    pushSupport === 'supported'
                  ? 'Enabled'
                  : 'Off'}
              </span>
              <input
                type="checkbox"
                disabled={pushBusy}
                checked={Boolean(
                  notificationPreferences?.pushEnabled &&
                    browserPerm === 'granted' &&
                    pushSupport === 'supported'
                )}
                onChange={(e) => void handleTogglePushNotifications(e.target.checked)}
                className="w-4 h-4 accent-accent-strong cursor-pointer"
              />
            </label>
          </div>

          {(
            [
              { key: 'messages', label: 'Direct messages' },
              { key: 'likes', label: 'Likes on your posts' },
              { key: 'comments', label: 'Comments on your posts' },
              { key: 'commentReplies', label: 'Replies to your comments' },
              { key: 'follows', label: 'New followers' },
              { key: 'friendRequests', label: 'Friend requests & acceptances' },
              { key: 'mentions', label: '@Mentions in posts and comments' },
              { key: 'announcements', label: 'Important Hostel Friend announcements' },
            ] as const
          ).map((item) => {
            const checked = notificationPreferences ? notificationPreferences[item.key] : true;
            return (
              <label
                key={item.key}
                className="flex items-center justify-between gap-4 cursor-pointer py-1"
              >
                <span className="text-sm text-ink-2">{item.label}</span>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => void handleTogglePreference(item.key, e.target.checked)}
                  className="w-4 h-4 accent-accent-strong"
                />
              </label>
            );
          })}

          <div className="pt-3 border-t border-hairline flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <Volume2 className="w-4 h-4 text-accent-strong shrink-0" />
              <div>
                <p className="text-sm text-ink-2">Sound Effects (VFX)</p>
                <p className="text-xs text-ink-muted">
                  Subtle chimes for notifications, messages, uploads, likes, and comments
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => {
                  if (!soundEnabled) setSoundVfxEnabled(true);
                  playSound('notification');
                }}
                className="px-2.5 py-1 rounded-lg text-xs font-medium border border-hairline text-ink-muted hover:text-ink-2 hover:border-accent-strong/40 transition-colors"
              >
                Test
              </button>
              <input
                type="checkbox"
                aria-label="Enable Sound Effects (VFX)"
                checked={soundEnabled}
                onChange={(e) => setSoundVfxEnabled(e.target.checked)}
                className="w-4 h-4 accent-accent-strong cursor-pointer"
              />
            </div>
          </div>

          {!isNativePlatform() && (
            <div className="pt-3 border-t border-hairline flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm text-ink-2">Mobile & Desktop App</p>
                <p className="text-xs text-ink-muted">
                  Install Hostel Friend on your home screen for fast app launch
                </p>
              </div>
              <PWAInstallButton variant="card" />
            </div>
          )}
        </div>
      </div>

      {/* Blocked Users */}
      <div className="glass-card rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-2.5 pb-2 border-b border-hairline">
          <ShieldAlert className="w-4 h-4 text-accent-strong" />
          <h2 className="font-display text-base font-semibold text-ink-2">Blocked Members</h2>
        </div>

        {blockedUsers.length === 0 ? (
          <p className="text-xs text-ink-subtle">You have not blocked any members.</p>
        ) : (
          <div className="space-y-3">
            {blockedUsers.map((u) => (
              <div key={u.uid} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Avatar src={u.avatarUrl} name={u.fullName} size="sm" />
                  <div>
                    <p className="text-sm font-medium text-ink-2">{u.fullName}</p>
                    <p className="text-xs text-ink-muted">@{u.username}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleUnblock(u.uid)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-hairline text-ink-2 hover:border-accent-strong/40"
                >
                  Unblock
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Session & Account Deletion */}
      <div className="glass-card rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <button
          type="button"
          onClick={handleLogout}
          className="px-4 py-2.5 rounded-xl text-xs font-semibold border border-hairline-strong text-ink-2 hover:bg-hover-tint inline-flex items-center justify-center gap-2"
        >
          <LogOut className="w-4 h-4" />
          <span>Log Out</span>
        </button>

        <button
          type="button"
          onClick={() => setConfirmDeleteOpen(true)}
          className="px-4 py-2.5 rounded-xl text-xs font-semibold bg-rose-500/10 border border-rose-500/30 text-rose-400 hover:bg-rose-500/20 inline-flex items-center justify-center gap-2"
        >
          <Trash2 className="w-4 h-4" />
          <span>Delete Account</span>
        </button>
      </div>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Permanently delete your account?"
        description="Your profile, username reservation, and private settings will be permanently erased. This cannot be undone."
        confirmLabel="Delete My Account"
        destructive
        loading={deletingAccount}
        onConfirm={handleDeleteAccount}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </div>
  );
}
