import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Image as ImageIcon,
  Mail,
  RefreshCw,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { checkUsernameAvailable } from '../services/userService';
import { uploadMediaFile, validateMediaFile } from '../services/mediaService';
import { sanitizeUsername } from '../utils/formatters';
import { formatUserFriendlyError } from '../lib/firestoreError';

interface AuthPageProps {
  initialMode?: 'login' | 'signup' | 'forgot';
  onBackToLanding: () => void;
  onAuthenticated: () => void;
}

export function AuthPage({
  initialMode = 'login',
  onBackToLanding,
  onAuthenticated,
}: AuthPageProps) {
  const {
    firebaseUser,
    profile,
    needsVerification,
    needsOnboarding,
    pendingDraft,
    platformSettings,
    signInWithGoogle,
    signUpWithEmail,
    loginWithEmail,
    sendResetEmail,
    resendVerificationEmail,
    refreshVerificationStatus,
    completeOnboarding,
    logout,
  } = useAuth();
  const { showToast } = useToast();

  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState(
    pendingDraft?.fullName || firebaseUser?.displayName || ''
  );
  const [username, setUsername] = useState(pendingDraft?.username || '');
  const [hostel, setHostel] = useState(pendingDraft?.hostel || '');
  const [avatarUrl, setAvatarUrl] = useState(
    pendingDraft?.avatarUrl || firebaseUser?.photoURL || ''
  );
  const [coverUrl, setCoverUrl] = useState(pendingDraft?.coverUrl || '');
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);

  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    setErrorMsg('');
    setSuccessMsg('');
  }, [needsVerification, needsOnboarding]);

  useEffect(() => {
    if (profile) {
      onAuthenticated();
    }
  }, [profile, onAuthenticated]);

  const prefilledUidRef = React.useRef<string | null>(null);
  useEffect(() => {
    if (!firebaseUser) {
      prefilledUidRef.current = null;
      return;
    }
    if (prefilledUidRef.current === firebaseUser.uid) return;
    prefilledUidRef.current = firebaseUser.uid;
    if (firebaseUser.displayName) {
      setFullName((prev) => prev || firebaseUser.displayName || '');
    }
    if (firebaseUser.photoURL) {
      setAvatarUrl((prev) => prev || firebaseUser.photoURL || '');
    }
    // Auto-suggest an available username for newly connected Google accounts
    if (!pendingDraft?.username && !username) {
      const rawBase =
        firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'hostel_member';
      let base = sanitizeUsername(rawBase.replace(/\s+/g, '_'));
      if (base.length < 3) base = `${base}_hv`.slice(0, 24);
      let cancelled = false;
      (async () => {
        const candidates = [
          base,
          `${base.slice(0, 20)}_${Math.floor(10 + Math.random() * 89)}`,
          `${base.slice(0, 19)}_${Math.floor(100 + Math.random() * 899)}`,
        ];
        for (const candidate of candidates) {
          if (cancelled) return;
          try {
            const ok = await checkUsernameAvailable(candidate);
            if (ok && !cancelled) {
              setUsername((prev) => prev || candidate);
              return;
            }
          } catch {
            // Stop probing additional candidates if Firestore rules/network fail
            break;
          }
        }
        if (!cancelled) {
          setUsername((prev) => prev || base);
        }
      })();
      return () => {
        cancelled = true;
      };
    }
  }, [firebaseUser, pendingDraft?.username, username]);

  // Live username availability check
  useEffect(() => {
    const clean = sanitizeUsername(username);
    if (clean.length < 3) {
      setUsernameStatus('idle');
      return;
    }
    let active = true;
    setUsernameStatus('checking');
    const timer = setTimeout(async () => {
      try {
        const available = await checkUsernameAvailable(clean);
        if (active) setUsernameStatus(available ? 'available' : 'taken');
      } catch {
        if (active) setUsernameStatus('idle');
      }
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [username]);

  const mapAuthError = (err: unknown): string => {
    const code = (err as { code?: string })?.code || '';
    if (code === 'auth/operation-not-allowed') {
      return 'Email/Password sign-in is not yet enabled in Firebase Console -> Authentication -> Sign-in method. You can sign in immediately with Google below, or enable Email/Password in your Firebase Console.';
    }
    if (code === 'auth/email-already-in-use') {
      return 'An account with this email already exists. Please sign in instead.';
    }
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
      return 'Invalid email or password. Double-check your credentials or reset your password.';
    }
    if (code === 'auth/weak-password') {
      return 'Password must be at least 6 characters long.';
    }
    if (code === 'auth/popup-blocked') {
      return 'Pop-up was blocked by your browser. Please allow pop-ups and try again.';
    }
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      return 'Google sign-in popup was closed before completion.';
    }
    if (code === 'auth/account-exists-with-different-credential') {
      return 'An account already exists with this email. Sign in with your existing method first, then connect Google in Settings.';
    }
    return formatUserFriendlyError(err, 'Authentication failed. Please try again.');
  };

  const handleGoogleSignIn = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    setLoading(true);
    try {
      await signInWithGoogle();
      showToast({ type: 'success', title: 'Signed in with Google' });
    } catch (err) {
      setErrorMsg(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    if (!email.trim() || !password) {
      setErrorMsg('Please enter both your email and password.');
      return;
    }
    setLoading(true);
    try {
      await loginWithEmail(email, password);
      showToast({ type: 'success', title: 'Welcome back to Hostel Friend' });
    } catch (err) {
      setErrorMsg(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSignUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    const cleanUsername = sanitizeUsername(username);
    if (!fullName.trim()) {
      setErrorMsg('Please enter your full name.');
      return;
    }
    if (cleanUsername.length < 3) {
      setErrorMsg('Username must be at least 3 characters (letters, numbers, underscores).');
      return;
    }
    if (usernameStatus === 'taken') {
      setErrorMsg(`@${cleanUsername} is already taken. Choose another username.`);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters long.');
      return;
    }

    setLoading(true);
    try {
      await signUpWithEmail({
        email,
        password,
        fullName,
        username: cleanUsername,
        hostel,
        avatarUrl,
      });
      setSuccessMsg('Account created! Check your inbox for the verification link to continue.');
    } catch (err) {
      setErrorMsg(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }
    setLoading(true);
    try {
      await sendResetEmail(email);
      setSuccessMsg(
        `Password reset instructions sent to ${email.trim()}. Follow the link in your email to set a new password.`
      );
    } catch (err) {
      setErrorMsg(mapAuthError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleOnboardingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    const cleanUsername = sanitizeUsername(username);
    if (!fullName.trim()) {
      setErrorMsg('Please enter your full name.');
      return;
    }
    if (cleanUsername.length < 3) {
      setErrorMsg('Username must be at least 3 characters (letters, numbers, underscores).');
      return;
    }
    setLoading(true);
    try {
      await completeOnboarding({
        fullName,
        username: cleanUsername,
        hostel,
        avatarUrl,
        coverUrl,
      });
      showToast({ type: 'success', title: 'Profile created', description: 'Welcome to Hostel Friend.' });
      onAuthenticated();
    } catch (err) {
      setErrorMsg(formatUserFriendlyError(err, 'Unable to finish profile setup.'));
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !firebaseUser) return;
    const validation = validateMediaFile(file, platformSettings.maxUploadSizeMB);
    if (!validation.valid || validation.mediaType !== 'image') {
      setErrorMsg(validation.error || 'Please choose an image file from your gallery.');
      return;
    }
    setAvatarUploading(true);
    setErrorMsg('');
    try {
      const url = await uploadMediaFile(file, 'avatars', firebaseUser.uid);
      setAvatarUrl(url);
      showToast({ type: 'success', title: 'Profile picture ready' });
    } catch (err) {
      setErrorMsg(formatUserFriendlyError(err, 'Avatar upload failed.'));
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !firebaseUser) return;
    const validation = validateMediaFile(file, platformSettings.maxUploadSizeMB);
    if (!validation.valid || validation.mediaType !== 'image') {
      setErrorMsg(validation.error || 'Please choose an image file from your gallery.');
      return;
    }
    setCoverUploading(true);
    setErrorMsg('');
    try {
      const url = await uploadMediaFile(file, 'covers', firebaseUser.uid);
      setCoverUrl(url);
      showToast({ type: 'success', title: 'Cover photo ready' });
    } catch (err) {
      setErrorMsg(formatUserFriendlyError(err, 'Cover upload failed.'));
    } finally {
      setCoverUploading(false);
    }
  };

  // Email Verification Gate
  if (needsVerification && firebaseUser) {
    return (
      <div className="min-h-screen bg-canvas-alt flex items-center justify-center p-4">
        <div className="glass-surface w-full max-w-md rounded-2xl p-7 border border-hairline">
          <div className="w-11 h-11 rounded-xl bg-accent-strong/15 border border-accent-strong/30 flex items-center justify-center text-accent-strong">
            <Mail className="w-5 h-5" />
          </div>
          <h1 className="mt-5 font-display text-2xl font-bold text-ink-2">
            Verify your email
          </h1>
          <p className="mt-2 text-sm text-ink-muted leading-relaxed">
            We sent a verification link to{' '}
            <span className="text-ink-2 font-medium">{firebaseUser.email}</span>. Click the
            link in your inbox, then tap Continue below.
          </p>

          {errorMsg && (
            <div role="alert" className="mt-4 rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-300">
              {errorMsg}
            </div>
          )}
          {successMsg && (
            <div className="mt-4 rounded-xl bg-accent-strong/10 border border-accent-strong/30 p-3 text-xs text-accent-soft">
              {successMsg}
            </div>
          )}

          <div className="mt-6 space-y-3">
            <button
              type="button"
              disabled={loading}
              onClick={async () => {
                setLoading(true);
                setErrorMsg('');
                try {
                  const verified = await refreshVerificationStatus();
                  if (!verified) {
                    setErrorMsg('Email is not verified yet. Please click the link in your inbox.');
                  }
                } catch (err) {
                  setErrorMsg(formatUserFriendlyError(err, 'Could not verify status.'));
                } finally {
                  setLoading(false);
                }
              }}
              className="w-full gold-gradient-btn py-2.5 px-4 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span>I’ve Verified — Continue</span>
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={async () => {
                setLoading(true);
                setErrorMsg('');
                try {
                  await resendVerificationEmail();
                  setSuccessMsg('Verification email resent.');
                } catch (err) {
                  setErrorMsg(mapAuthError(err));
                } finally {
                  setLoading(false);
                }
              }}
              className="w-full py-2.5 px-4 rounded-xl text-sm font-medium border border-hairline text-ink-2 hover:bg-hover-tint"
            >
              Resend Verification Email
            </button>

            <button
              type="button"
              onClick={logout}
              className="w-full py-2 text-xs text-ink-muted hover:text-ink-2"
            >
              Use a different account
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Profile Onboarding for newly verified or Google users
  if (needsOnboarding && firebaseUser) {
    return (
      <div className="min-h-screen bg-canvas-alt flex items-center justify-center p-4">
        <form
          onSubmit={handleOnboardingSubmit}
          className="glass-surface w-full max-w-md rounded-2xl p-7 border border-hairline"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <img
                src="/icons/icon-192.png"
                alt="Hostel Friend"
                className="w-7 h-7 rounded-lg object-cover border border-hairline-strong shrink-0"
              />
              <span className="font-display font-bold text-base sm:text-lg text-ink-2 whitespace-nowrap">
                Hostel Friend
              </span>
            </div>
            <div className="flex items-center gap-2.5 shrink-0 whitespace-nowrap">
              <button
                type="button"
                disabled={loading}
                onClick={handleGoogleSignIn}
                className="text-xs text-accent-strong hover:text-accent-soft disabled:opacity-50"
              >
                Switch Google
              </button>
              <button
                type="button"
                onClick={logout}
                className="text-xs text-ink-muted hover:text-ink-2"
              >
                Sign out
              </button>
            </div>
          </div>

          <div className="mt-5 rounded-xl bg-canvas-alt border border-accent-strong/30 p-3 flex items-center gap-3">
            {firebaseUser.photoURL ? (
              <img
                src={firebaseUser.photoURL}
                alt={firebaseUser.displayName || 'Connected account'}
                referrerPolicy="no-referrer"
                className="w-9 h-9 rounded-full object-cover border border-accent-strong/40 shrink-0"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-accent-strong/15 border border-accent-strong/40 flex items-center justify-center text-xs font-bold text-accent-strong shrink-0">
                {(firebaseUser.displayName || firebaseUser.email || 'H').charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-ink-2 truncate">
                {firebaseUser.displayName || 'Account Connected'}
              </p>
              <p className="text-[11px] text-ink-muted truncate">
                {firebaseUser.email || 'Verified Member'}
              </p>
            </div>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-accent-strong shrink-0">
              <CheckCircle2 className="w-3.5 h-3.5" /> Connected
            </span>
          </div>

          <h1 className="mt-5 font-display text-2xl font-bold text-ink-2">
            Start Account Setup
          </h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            Confirm your unique handle and hostel so peers can discover and connect with you.
          </p>

          {errorMsg && (
            <div role="alert" className="mt-4 rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-300">
              {errorMsg}
            </div>
          )}

          <div className="mt-5 space-y-4">
            <label className="block text-xs font-medium text-ink-muted">
              Full Name
              <input
                type="text"
                required
                maxLength={64}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Aarav Mehta"
                className="mt-1.5 w-full rounded-xl bg-canvas-alt border border-hairline px-3.5 py-2.5 text-sm text-ink-2 focus:outline-none focus:border-accent-strong"
              />
            </label>

            <label className="block text-xs font-medium text-ink-muted">
              Username
              <div className="relative mt-1.5">
                <input
                  type="text"
                  required
                  minLength={3}
                  maxLength={24}
                  value={username}
                  onChange={(e) => setUsername(sanitizeUsername(e.target.value))}
                  placeholder="aarav_studio"
                  className="w-full rounded-xl bg-canvas-alt border border-hairline px-3.5 py-2.5 text-sm text-ink-2 focus:outline-none focus:border-accent-strong"
                />
                {usernameStatus === 'available' && (
                  <span className="mt-1 block text-[11px] text-accent-strong">
                    @{sanitizeUsername(username)} is available
                  </span>
                )}
                {usernameStatus === 'taken' && (
                  <span className="mt-1 block text-[11px] text-rose-400">
                    @{sanitizeUsername(username)} is already taken
                  </span>
                )}
              </div>
            </label>

            <label className="block text-xs font-medium text-ink-muted">
              Hostel or Institution (optional)
              <input
                type="text"
                maxLength={80}
                value={hostel}
                onChange={(e) => setHostel(e.target.value)}
                placeholder="North Wing Hall · Block B"
                className="mt-1.5 w-full rounded-xl bg-canvas-alt border border-hairline px-3.5 py-2.5 text-sm text-ink-2 focus:outline-none focus:border-accent-strong"
              />
            </label>

            <div>
              <span className="block text-xs font-medium text-ink-muted mb-1.5">
                Profile Picture (from Gallery · optional)
              </span>
              <div className="flex items-center gap-3">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt="Profile preview"
                    referrerPolicy="no-referrer"
                    className="w-11 h-11 rounded-full object-cover border border-accent-strong/50 shrink-0"
                  />
                ) : (
                  <div className="w-11 h-11 rounded-full bg-canvas-alt border border-hairline-strong flex items-center justify-center text-xs font-bold text-accent-strong shrink-0">
                    {(fullName || 'H').charAt(0).toUpperCase()}
                  </div>
                )}
                <label className="cursor-pointer px-3.5 py-2 rounded-xl border border-hairline text-xs font-medium text-ink-2 hover:border-accent-strong/50 hover:bg-hover-tint flex items-center gap-2 transition-colors">
                  <Upload className="w-3.5 h-3.5 text-accent-strong" />
                  <span>{avatarUploading ? 'Uploading...' : 'Select Profile Picture'}</span>
                  <input
                    type="file"
                    accept="image/jpeg, image/png, image/webp"
                    disabled={avatarUploading}
                    onChange={handleAvatarUpload}
                    className="hidden"
                  />
                </label>
                {avatarUrl && (
                  <span className="text-xs text-accent-strong flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Ready
                  </span>
                )}
              </div>
            </div>

            <div>
              <span className="block text-xs font-medium text-ink-muted mb-1.5">
                Cover Photo (from Gallery · optional)
              </span>
              <div className="space-y-2">
                {coverUrl && (
                  <div className="h-24 w-full rounded-xl overflow-hidden border border-accent-strong/40 bg-canvas-alt">
                    <img
                      src={coverUrl}
                      alt="Cover preview"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <label className="cursor-pointer px-3.5 py-2 rounded-xl border border-hairline text-xs font-medium text-ink-2 hover:border-accent-strong/50 hover:bg-hover-tint flex items-center gap-2 transition-colors">
                    <ImageIcon className="w-3.5 h-3.5 text-accent-strong" />
                    <span>{coverUploading ? 'Uploading...' : 'Select Cover Photo'}</span>
                    <input
                      type="file"
                      accept="image/jpeg, image/png, image/webp"
                      disabled={coverUploading}
                      onChange={handleCoverUpload}
                      className="hidden"
                    />
                  </label>
                  {coverUrl && (
                    <span className="text-xs text-accent-strong flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Ready
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || avatarUploading || coverUploading || usernameStatus === 'taken'}
            className="mt-6 w-full gold-gradient-btn py-2.5 px-4 rounded-xl text-sm font-semibold disabled:opacity-50"
          >
            {loading ? 'Finishing Account Setup...' : 'Complete Account Setup'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas-alt flex flex-col justify-center items-center p-4 py-10">
      <div className="w-full max-w-md">
        <button
          type="button"
          onClick={onBackToLanding}
          className="mb-6 inline-flex items-center gap-2 text-xs font-medium text-ink-muted hover:text-ink-2 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Hostel Friend</span>
        </button>

        <div className="glass-surface rounded-2xl p-7 border border-hairline shadow-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <img
                src="/icons/icon-192.png"
                alt="Hostel Friend"
                className="w-7 h-7 rounded-lg object-cover border border-hairline-strong"
              />
              <span className="font-display font-bold tracking-tight text-lg text-ink-2">
                Hostel Friend
              </span>
            </div>
            <ShieldCheck className="w-4 h-4 text-accent" />
          </div>

          <h1 className="mt-4 font-display text-2xl font-bold text-ink-2">
            {mode === 'login'
              ? 'Welcome back'
              : mode === 'signup'
              ? 'Start Account Setup'
              : 'Reset password'}
          </h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            {mode === 'login'
              ? 'Connect Google or sign in with your Hostel Friend email.'
              : mode === 'signup'
              ? 'Connect your Google account or sign up with email.'
              : 'Enter your account email to receive a password reset link.'}
          </p>

          {/* Segmented Mode Switcher */}
          {mode !== 'forgot' && (
            <div className="mt-5 grid grid-cols-2 gap-1 p-1 bg-canvas-alt rounded-xl border border-hairline">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setErrorMsg('');
                  setSuccessMsg('');
                }}
                className={`py-2 text-xs font-semibold rounded-lg transition-colors ${
                  mode === 'login'
                    ? 'bg-surface-2 text-ink-2 border border-hairline'
                    : 'text-ink-muted hover:text-ink-2'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('signup');
                  setErrorMsg('');
                  setSuccessMsg('');
                }}
                className={`py-2 text-xs font-semibold rounded-lg transition-colors ${
                  mode === 'signup'
                    ? 'bg-surface-2 text-ink-2 border border-hairline'
                    : 'text-ink-muted hover:text-ink-2'
                }`}
              >
                Account Setup
              </button>
            </div>
          )}

          {errorMsg && (
            <div
              role="alert"
              className="mt-4 rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-xs text-rose-300 leading-relaxed"
            >
              {errorMsg}
            </div>
          )}
          {successMsg && (
            <div className="mt-4 rounded-xl bg-accent-strong/10 border border-accent-strong/30 p-3 text-xs text-accent-soft leading-relaxed">
              {successMsg}
            </div>
          )}

          {mode !== 'forgot' && (
            <div className="mt-5 space-y-2.5">
              <button
                type="button"
                disabled={loading}
                onClick={handleGoogleSignIn}
                className="w-full py-3 px-4 rounded-xl text-sm font-semibold border border-accent-strong/50 bg-canvas-alt text-ink-2 hover:border-accent-strong hover:bg-hover-tint transition-colors flex items-center justify-center gap-2.5 disabled:opacity-50"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#EA4335"
                    d="M12 5c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.09 14.97 0 12 0 7.31 0 3.25 2.69 1.28 6.6l3.67 2.84C5.81 6.72 8.65 5 12 5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58l3.7 2.87c2.16-1.99 3.72-4.92 3.72-8.69z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M4.95 14.56A7.01 7.01 0 0 1 4.58 12c0-.89.16-1.75.44-2.56L1.35 6.6A11.96 11.96 0 0 0 0 12c0 1.94.46 3.77 1.28 5.4l3.67-2.84z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.7-2.87c-1.08.72-2.45 1.16-4.23 1.16-3.35 0-6.19-1.72-7.05-4.44L1.28 17.78C3.25 21.69 7.31 24 12 24z"
                  />
                </svg>
                <span>
                  {loading
                    ? 'Connecting Google Account...'
                    : mode === 'signup'
                    ? 'Start Account Setup with Google'
                    : 'Continue with Google'}
                </span>
              </button>

              <div className="pt-2 pb-1 flex items-center gap-3 text-xs text-ink-subtle">
                <div className="flex-1 h-px bg-hover-tint" />
                <span>{mode === 'signup' ? 'or set up with email' : 'or sign in with email'}</span>
                <div className="flex-1 h-px bg-hover-tint" />
              </div>
            </div>
          )}

          {mode === 'login' && (
            <form onSubmit={handleLoginSubmit} className="mt-5 space-y-4">
              <label className="block text-xs font-medium text-ink-muted">
                Email
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@university.edu"
                  className="mt-1.5 w-full rounded-xl bg-canvas-alt border border-hairline px-3.5 py-2.5 text-sm text-ink-2 placeholder:text-ink-subtle focus:outline-none focus:border-accent-strong"
                />
              </label>

              <label className="block text-xs font-medium text-ink-muted">
                Password
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="mt-1.5 w-full rounded-xl bg-canvas-alt border border-hairline px-3.5 py-2.5 text-sm text-ink-2 placeholder:text-ink-subtle focus:outline-none focus:border-accent-strong"
                />
              </label>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setMode('forgot');
                    setErrorMsg('');
                    setSuccessMsg('');
                  }}
                  className="text-xs text-accent-strong hover:text-accent-soft"
                >
                  Forgot password?
                </button>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full gold-gradient-btn py-2.5 px-4 rounded-xl text-sm font-semibold disabled:opacity-50"
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
          )}

          {mode === 'signup' && (
            <form onSubmit={handleSignUpSubmit} className="mt-5 space-y-3.5">
              <label className="block text-xs font-medium text-ink-muted">
                Full Name
                <input
                  type="text"
                  required
                  maxLength={64}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Zara Kapoor"
                  className="mt-1.5 w-full rounded-xl bg-canvas-alt border border-hairline px-3.5 py-2.5 text-sm text-ink-2 placeholder:text-ink-subtle focus:outline-none focus:border-accent-strong"
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
                  placeholder="zara_hostel"
                  className="mt-1.5 w-full rounded-xl bg-canvas-alt border border-hairline px-3.5 py-2.5 text-sm text-ink-2 placeholder:text-ink-subtle focus:outline-none focus:border-accent-strong"
                />
                {usernameStatus === 'available' && (
                  <span className="mt-1 block text-[11px] text-accent-strong">
                    @{sanitizeUsername(username)} is available
                  </span>
                )}
                {usernameStatus === 'taken' && (
                  <span className="mt-1 block text-[11px] text-rose-400">
                    @{sanitizeUsername(username)} is taken
                  </span>
                )}
              </label>

              <label className="block text-xs font-medium text-ink-muted">
                Email
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@university.edu"
                  className="mt-1.5 w-full rounded-xl bg-canvas-alt border border-hairline px-3.5 py-2.5 text-sm text-ink-2 placeholder:text-ink-subtle focus:outline-none focus:border-accent-strong"
                />
              </label>

              <label className="block text-xs font-medium text-ink-muted">
                Password
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  className="mt-1.5 w-full rounded-xl bg-canvas-alt border border-hairline px-3.5 py-2.5 text-sm text-ink-2 placeholder:text-ink-subtle focus:outline-none focus:border-accent-strong"
                />
              </label>

              <label className="block text-xs font-medium text-ink-muted">
                Hostel or Institution (optional)
                <input
                  type="text"
                  maxLength={80}
                  value={hostel}
                  onChange={(e) => setHostel(e.target.value)}
                  placeholder="Cedar Hall · Engineering Campus"
                  className="mt-1.5 w-full rounded-xl bg-canvas-alt border border-hairline px-3.5 py-2.5 text-sm text-ink-2 placeholder:text-ink-subtle focus:outline-none focus:border-accent-strong"
                />
              </label>

              <button
                type="submit"
                disabled={loading || usernameStatus === 'taken'}
                className="w-full gold-gradient-btn py-2.5 px-4 rounded-xl text-sm font-semibold disabled:opacity-50 mt-1"
              >
                {loading ? 'Creating account...' : 'Create Your Account'}
              </button>
            </form>
          )}

          {mode === 'forgot' && (
            <form onSubmit={handleForgotSubmit} className="mt-5 space-y-4">
              <label className="block text-xs font-medium text-ink-muted">
                Account Email
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@university.edu"
                  className="mt-1.5 w-full rounded-xl bg-canvas-alt border border-hairline px-3.5 py-2.5 text-sm text-ink-2 placeholder:text-ink-subtle focus:outline-none focus:border-accent-strong"
                />
              </label>

              <button
                type="submit"
                disabled={loading}
                className="w-full gold-gradient-btn py-2.5 px-4 rounded-xl text-sm font-semibold disabled:opacity-50"
              >
                {loading ? 'Sending reset link...' : 'Send Password Reset Link'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setErrorMsg('');
                  setSuccessMsg('');
                }}
                className="w-full text-xs text-ink-muted hover:text-ink-2"
              >
                Return to Sign In
              </button>
            </form>
          )}

        </div>
      </div>
    </div>
  );
}
