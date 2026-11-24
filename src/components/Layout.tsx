import React, { useEffect, useRef, useState } from 'react';
import {
  Bell,
  BellRing,
  ChevronDown,
  Compass,
  Film,
  Home,
  LogOut,
  MessageSquare,
  Palette,
  Plus,
  Search,
  Settings,
  Shield,
  TrendingUp,
  User,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { AppView, UserProfile } from '../types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  getBrowserNotificationPermission,
  getPushSupportState,
  PushSupportState,
} from '../services/fcmService';
import { Avatar } from './Avatar';
import { PWAInstallButton } from './PWAInstallButton';
import {
  isSoundVfxEnabled,
  subscribeSoundPreference,
  toggleSoundVfx,
} from '../utils/soundVfx';

interface LayoutProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  onSearchSubmit?: (query: string) => void;
  profile: UserProfile | null;
  isAdmin: boolean;
  unreadNotifications: number;
  unreadMessages: number;
  maintenanceNotice?: string;
  onLogout: () => void;
  children: React.ReactNode;
}

export function Layout({
  activeView,
  onNavigate,
  onSearchSubmit,
  profile,
  isAdmin,
  unreadNotifications,
  unreadMessages,
  maintenanceNotice,
  onLogout,
  children,
}: LayoutProps) {
  const { notificationPreferences, enablePushNotifications } = useAuth();
  const { showToast } = useToast();

  const [soundOn, setSoundOn] = useState(() => isSoundVfxEnabled());
  const [pushSupport, setPushSupport] = useState<PushSupportState>('unsupported-browser');
  const [browserPerm, setBrowserPerm] = useState<NotificationPermission | 'unsupported'>(() =>
    getBrowserNotificationPermission()
  );
  const [enablingPush, setEnablingPush] = useState(false);
  const [pushPromptDismissed, setPushPromptDismissed] = useState(() => {
    try {
      return sessionStorage.getItem('hf_push_prompt_dismissed') === '1';
    } catch {
      return false;
    }
  });

  const [headerSearch, setHeaderSearch] = useState('');
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  const accountMenuRef = useRef<HTMLDivElement>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return subscribeSoundPreference(setSoundOn);
  }, []);

  useEffect(() => {
    setBrowserPerm(getBrowserNotificationPermission());
    void getPushSupportState().then(setPushSupport);
  }, [activeView, notificationPreferences?.pushEnabled]);

  useEffect(() => {
    setAccountMenuOpen(false);
    setMobileSearchOpen(false);
  }, [activeView]);

  useEffect(() => {
    if (!accountMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setAccountMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAccountMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [accountMenuOpen]);

  useEffect(() => {
    if (!mobileSearchOpen) return;
    const timer = window.setTimeout(() => {
      mobileSearchInputRef.current?.focus();
    }, 40);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileSearchOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [mobileSearchOpen]);

  const showPushBanner =
    Boolean(profile) &&
    !pushPromptDismissed &&
    pushSupport === 'supported' &&
    (browserPerm === 'default' ||
      (browserPerm === 'granted' &&
        notificationPreferences !== null &&
        !notificationPreferences.pushEnabled));

  const dismissPushBanner = () => {
    setPushPromptDismissed(true);
    try {
      sessionStorage.setItem('hf_push_prompt_dismissed', '1');
    } catch {
      // Ignore storage errors
    }
  };

  const handleEnablePushFromBanner = async () => {
    if (enablingPush) return;
    setEnablingPush(true);
    try {
      const res = await enablePushNotifications();
      setBrowserPerm(getBrowserNotificationPermission());
      void getPushSupportState().then(setPushSupport);
      if (res.ok) {
        showToast({
          type: 'success',
          title: 'Push notifications enabled',
          description: 'You will receive alerts when Hostel Friend is in the background or closed.',
        });
      } else {
        showToast({
          type: 'info',
          title: 'Push notifications',
          description: res.reason,
        });
      }
    } finally {
      setEnablingPush(false);
    }
  };

  const handleSearchFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = headerSearch.trim();
    if (onSearchSubmit) {
      onSearchSubmit(trimmed);
    } else {
      onNavigate('explore');
    }
    setMobileSearchOpen(false);
  };

  const sidebarNav: {
    id: AppView;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: 'feed', label: 'Home', icon: Home },
    { id: 'explore', label: 'Explore', icon: Compass },
    { id: 'trends', label: 'Trends', icon: TrendingUp },
    { id: 'moments', label: 'Moments', icon: Film },
    { id: 'profile', label: 'Profile', icon: User },
  ];

  if (isAdmin) {
    sidebarNav.push({ id: 'admin', label: 'Admin', icon: Shield });
  }

  const mobileTabs: {
    id: AppView;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: 'feed', label: 'Home', icon: Home },
    { id: 'explore', label: 'Explore', icon: Compass },
    { id: 'create', label: 'Create', icon: Plus },
    { id: 'moments', label: 'Moments', icon: Film },
    { id: 'profile', label: 'Profile', icon: User },
  ];

  return (
    <div className="min-h-screen text-ink flex flex-col overflow-x-clip">
      {/* Unified Sticky Application Header (Mobile + Tablet + Desktop) */}
      <header className="sticky top-0 z-30 h-[54px] md:h-16 glass-nav border-b border-hairline">
        <div className="h-full px-3 sm:px-5 lg:px-6 flex items-center justify-between gap-2.5 sm:gap-4">
          {/* Left: Brand Logo & Name */}
          <button
            type="button"
            onClick={() => onNavigate('feed')}
            className="flex items-center gap-2.5 min-w-0 shrink-0 rounded-xl py-1 pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent active:scale-[0.98] transition-transform"
          >
            <img
              src="/icons/icon-192.png"
              alt="Hostel Friend"
              className="w-8 h-8 md:w-9 md:h-9 rounded-xl object-cover border border-accent/45 shrink-0"
            />
            <span className="font-display font-bold tracking-tight text-[15px] md:text-lg whitespace-nowrap shrink-0">
              <span className="text-ink">Hostel </span>
              <span className="text-accent">Friend</span>
            </span>
          </button>

          {/* Center: Desktop / Tablet Search Bar */}
          <form
            onSubmit={handleSearchFormSubmit}
            role="search"
            aria-label="Search Hostel Friend"
            className="hidden md:flex flex-1 max-w-md mx-2"
          >
            <div className="relative w-full">
              <Search className="w-4 h-4 text-accent absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={headerSearch}
                onChange={(e) => setHeaderSearch(e.target.value)}
                placeholder="Search members, posts, or #hashtags..."
                aria-label="Search members, posts, or hashtags"
                className="w-full h-10 rounded-xl bg-surface border border-hairline pl-10 pr-9 text-xs text-ink placeholder:text-ink-subtle focus:outline-none focus:border-accent/65 focus:bg-surface-2 transition-colors"
              />
              {headerSearch && (
                <button
                  type="button"
                  onClick={() => setHeaderSearch('')}
                  aria-label="Clear search query"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center text-ink-muted hover:text-ink"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </form>

          {/* Right: Search (mobile), Notifications, Messages, Account Menu */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <PWAInstallButton
              variant="compact"
              className="md:hidden mr-0.5 [&>span]:hidden min-[440px]:[&>span]:inline"
            />

            <button
              type="button"
              onClick={() => setMobileSearchOpen((prev) => !prev)}
              aria-label="Search members and posts"
              aria-expanded={mobileSearchOpen}
              className={`md:hidden min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl transition-colors active:scale-95 ${
                mobileSearchOpen || activeView === 'explore'
                  ? 'text-accent bg-accent/12'
                  : 'text-ink-2 hover:text-accent hover:bg-surface-2'
              }`}
            >
              <Search className="w-[19px] h-[19px]" />
            </button>

            <button
              type="button"
              onClick={() => onNavigate('notifications')}
              aria-label={
                unreadNotifications > 0
                  ? `Notifications (${unreadNotifications} unread)`
                  : 'Notifications'
              }
              aria-current={activeView === 'notifications' ? 'page' : undefined}
              title="Notifications"
              className={`relative min-w-[44px] min-h-[44px] md:min-w-[42px] md:min-h-[42px] flex items-center justify-center rounded-xl md:border transition-colors active:scale-95 ${
                activeView === 'notifications'
                  ? 'text-accent bg-accent/12 md:bg-surface md:border-accent/45'
                  : 'text-ink-2 md:bg-surface md:border-hairline hover:text-accent hover:bg-surface-2 md:hover:border-accent/40'
              }`}
            >
              <Bell className="w-[19px] h-[19px]" />
              {unreadNotifications > 0 && (
                <span className="absolute top-1.5 right-1 md:-top-1 md:-right-1 min-w-[17px] h-[17px] px-1 rounded-full bg-[#EF4444] text-white text-[10px] font-bold flex items-center justify-center leading-none tabular-nums shadow-sm">
                  {unreadNotifications > 99 ? '99+' : unreadNotifications}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => onNavigate('messages')}
              aria-label={
                unreadMessages > 0 ? `Messages (${unreadMessages} unread)` : 'Messages'
              }
              aria-current={activeView === 'messages' ? 'page' : undefined}
              title="Messages"
              className={`relative min-w-[44px] min-h-[44px] md:min-w-[42px] md:min-h-[42px] flex items-center justify-center rounded-xl md:border transition-colors active:scale-95 ${
                activeView === 'messages'
                  ? 'text-accent bg-accent/12 md:bg-surface md:border-accent/45'
                  : 'text-ink-2 md:bg-surface md:border-hairline hover:text-accent hover:bg-surface-2 md:hover:border-accent/40'
              }`}
            >
              <MessageSquare className="w-[19px] h-[19px]" />
              {unreadMessages > 0 && (
                <span className="absolute top-1.5 right-1 md:-top-1 md:-right-1 min-w-[17px] h-[17px] px-1 rounded-full bg-accent text-accent-fg text-[10px] font-bold flex items-center justify-center leading-none tabular-nums shadow-sm">
                  {unreadMessages > 99 ? '99+' : unreadMessages}
                </span>
              )}
            </button>

            {/* Account & Settings Menu */}
            <div className="relative" ref={accountMenuRef}>
              <button
                type="button"
                onClick={() => setAccountMenuOpen((prev) => !prev)}
                aria-label="Account and settings menu"
                aria-expanded={accountMenuOpen}
                aria-haspopup="menu"
                className={`min-w-[44px] min-h-[44px] md:min-h-[42px] px-1 sm:px-2 rounded-xl md:border flex items-center justify-center gap-2 transition-colors active:scale-95 ${
                  accountMenuOpen || activeView === 'settings'
                    ? 'bg-surface-2 border-accent/45 text-accent'
                    : 'md:bg-surface border-transparent md:border-hairline text-ink-2 hover:border-accent/40'
                }`}
              >
                {profile ? (
                  <Avatar src={profile.avatarUrl} name={profile.fullName} size="sm" />
                ) : (
                  <Settings className="w-[18px] h-[18px]" />
                )}
                {profile && (
                  <span className="hidden lg:inline max-w-[110px] truncate text-xs font-semibold text-ink">
                    {profile.fullName.split(' ')[0]}
                  </span>
                )}
                <ChevronDown
                  className={`hidden sm:block w-3.5 h-3.5 text-ink-muted transition-transform duration-150 ${
                    accountMenuOpen ? 'rotate-180 text-accent' : ''
                  }`}
                />
              </button>

              {accountMenuOpen && (
                <div
                  role="menu"
                  aria-label="Account menu"
                  className="absolute right-0 mt-2 w-60 rounded-2xl glass-popover hf-popover-enter overflow-hidden z-40"
                >
                  {profile && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        onNavigate('profile');
                      }}
                      className="w-full px-4 py-3 text-left border-b border-hairline hover:bg-hover-tint flex items-center gap-3 transition-colors"
                    >
                      <Avatar src={profile.avatarUrl} name={profile.fullName} size="sm" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-ink truncate">
                          {profile.fullName}
                        </p>
                        <p className="text-[11px] text-ink-muted truncate">@{profile.username}</p>
                      </div>
                    </button>
                  )}

                  <div className="py-1.5">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        onNavigate('trends');
                      }}
                      className={`w-full px-4 py-2.5 text-left text-xs font-medium flex items-center gap-2.5 hover:bg-hover-tint transition-colors md:hidden ${
                        activeView === 'trends' ? 'text-accent' : 'text-ink'
                      }`}
                    >
                      <TrendingUp className="w-4 h-4 text-accent" />
                      <span>Trends</span>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        onNavigate('settings');
                        window.setTimeout(() => {
                          document
                            .getElementById('theme-customization')
                            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }, 60);
                      }}
                      className="w-full px-4 py-2.5 text-left text-xs font-medium text-ink flex items-center gap-2.5 hover:bg-hover-tint transition-colors"
                    >
                      <Palette className="w-4 h-4 text-accent" />
                      <span>Appearance &amp; Themes</span>
                    </button>

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        onNavigate('settings');
                      }}
                      className={`w-full px-4 py-2.5 text-left text-xs font-medium flex items-center gap-2.5 hover:bg-hover-tint transition-colors ${
                        activeView === 'settings' ? 'text-accent' : 'text-ink'
                      }`}
                    >
                      <Settings className="w-4 h-4 text-accent" />
                      <span>Account Settings</span>
                    </button>

                    {isAdmin && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setAccountMenuOpen(false);
                          onNavigate('admin');
                        }}
                        className={`w-full px-4 py-2.5 text-left text-xs font-medium flex items-center gap-2.5 hover:bg-hover-tint transition-colors md:hidden ${
                          activeView === 'admin' ? 'text-accent' : 'text-ink'
                        }`}
                      >
                        <Shield className="w-4 h-4 text-accent" />
                        <span>Admin Console</span>
                      </button>
                    )}

                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => toggleSoundVfx()}
                      className="w-full px-4 py-2.5 text-left text-xs font-medium text-ink flex items-center justify-between gap-2.5 hover:bg-hover-tint transition-colors"
                    >
                      <span className="flex items-center gap-2.5">
                        {soundOn ? (
                          <Volume2 className="w-4 h-4 text-accent" />
                        ) : (
                          <VolumeX className="w-4 h-4 text-ink-muted" />
                        )}
                        <span>Sound Effects</span>
                      </span>
                      <span className="font-mono text-[11px] text-ink-muted">
                        {soundOn ? 'On' : 'Off'}
                      </span>
                    </button>
                  </div>

                  {profile && (
                    <div className="border-t border-hairline py-1.5">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setAccountMenuOpen(false);
                          onLogout();
                        }}
                        className="w-full px-4 py-2.5 text-left text-xs font-medium text-rose-400 hover:bg-hover-tint flex items-center gap-2.5 transition-colors"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>Log Out</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mobile Expandable Search Sheet */}
        {mobileSearchOpen && (
          <div className="md:hidden px-3 py-2.5 glass-popover hf-popover-enter border-x-0 border-t-0">
            <form onSubmit={handleSearchFormSubmit} className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-accent absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={mobileSearchInputRef}
                  type="search"
                  value={headerSearch}
                  onChange={(e) => setHeaderSearch(e.target.value)}
                  placeholder="Search members, posts, #tags..."
                  aria-label="Search members, posts, or hashtags"
                  className="w-full min-h-[42px] rounded-xl bg-surface border border-hairline-strong pl-9 pr-3 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-accent"
                />
              </div>
              <button
                type="submit"
                className="gold-gradient-btn min-h-[42px] px-4 rounded-xl text-xs font-bold shrink-0"
              >
                Search
              </button>
              <button
                type="button"
                onClick={() => setMobileSearchOpen(false)}
                aria-label="Close search"
                className="min-w-[42px] min-h-[42px] rounded-xl border border-hairline text-ink-muted hover:text-ink flex items-center justify-center shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </form>
          </div>
        )}
      </header>

      {/* Desktop & Tablet Left Sidebar */}
      <aside
        aria-label="Desktop navigation"
        className="hidden md:flex md:flex-col md:w-20 lg:w-60 md:fixed md:top-16 md:bottom-0 md:left-0 glass-nav border-r border-hairline z-20"
      >
        <nav className="flex-1 px-3 py-5 space-y-1.5 overflow-y-auto" aria-label="Primary navigation">
          {sidebarNav.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                aria-current={isActive ? 'page' : undefined}
                aria-label={item.label}
                title={item.label}
                className={`relative w-full min-h-[46px] px-3 lg:px-3.5 py-2.5 rounded-xl flex items-center justify-center lg:justify-start gap-3.5 hf-press whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'glass-card text-accent border-accent/35'
                    : 'text-ink-muted hover:text-ink hover:bg-hover-tint border border-transparent'
                }`}
              >
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="hidden lg:block w-[3px] h-5 rounded-full bg-accent -ml-1"
                  />
                )}
                <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'stroke-[2.2]' : ''}`} />
                <span className="hidden lg:inline text-sm font-medium truncate">{item.label}</span>
              </button>
            );
          })}

          <div className="pt-3">
            <button
              type="button"
              onClick={() => onNavigate('create')}
              aria-current={activeView === 'create' ? 'page' : undefined}
              aria-label="Create Post"
              title="Create Post"
              className={`w-full min-h-[46px] px-3 lg:px-4 py-2.5 rounded-xl flex items-center justify-center gap-2.5 text-sm font-bold transition-all duration-150 whitespace-nowrap shrink-0 active:scale-[0.98] ${
                activeView === 'create'
                  ? 'gold-gradient-btn ring-2 ring-accent-soft/60 shadow-[0_6px_22px_rgba(245,197,66,0.3)]'
                  : 'gold-gradient-btn shadow-[0_4px_16px_rgba(245,197,66,0.2)]'
              }`}
            >
              <Plus className="w-5 h-5 stroke-[2.5] shrink-0" />
              <span className="hidden lg:inline">Create Post</span>
            </button>
          </div>
        </nav>

        <div className="p-3 border-t border-hairline">
          <PWAInstallButton variant="sidebar" />
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 md:pl-20 lg:pl-60 pb-[calc(5.25rem+env(safe-area-inset-bottom))] md:pb-12 min-w-0">
        {maintenanceNotice && (
          <div className="bg-surface border-b border-accent/30 px-4 py-2.5 text-center text-xs text-accent">
            {maintenanceNotice}
          </div>
        )}

        <div className="max-w-5xl mx-auto px-3.5 sm:px-6 lg:px-8 py-4 sm:py-6">
          {showPushBanner && (
            <div className="mb-4 rounded-2xl glass-card px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-start sm:items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0">
                  <BellRing className="w-4 h-4 text-accent" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-semibold text-ink">
                    Turn on Android &amp; Web Push notifications
                  </p>
                  <p className="text-[11px] sm:text-xs text-ink-muted">
                    Get instant message, reply, like, and friend request alerts even when Hostel Friend is closed.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                <button
                  type="button"
                  disabled={enablingPush}
                  onClick={handleEnablePushFromBanner}
                  className="gold-gradient-btn px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap disabled:opacity-50"
                >
                  {enablingPush ? 'Enabling...' : 'Enable Alerts'}
                </button>
                <button
                  type="button"
                  onClick={dismissPushBanner}
                  aria-label="Dismiss push notification prompt"
                  className="p-1.5 rounded-lg text-ink-muted hover:text-ink hover:bg-hover-tint"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          <div key={activeView} className="hf-page-enter">
            {children}
          </div>
        </div>
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 glass-nav border-t border-hairline pb-[env(safe-area-inset-bottom)]"
      >
        <div className="grid grid-cols-5 items-center h-[58px] px-1">
          {mobileTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeView === tab.id;

            if (tab.id === 'create') {
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onNavigate('create')}
                  aria-label="Create"
                  aria-current={isActive ? 'page' : undefined}
                  className="flex flex-col items-center justify-center -mt-3 min-h-[48px] focus-visible:outline-none group"
                >
                  <span
                    className={`w-11 h-11 rounded-full bg-gradient-to-br from-accent-soft via-accent to-accent-deep text-accent-fg border-2 border-canvas flex items-center justify-center group-active:scale-95 transition-transform duration-150 shadow-[0_4px_16px_rgba(245,197,66,0.4)] ${
                      isActive ? 'ring-2 ring-accent-soft' : ''
                    }`}
                  >
                    <Plus className="w-5 h-5 stroke-[2.6]" />
                  </span>
                  <span
                    className={`mt-0.5 text-[10px] font-semibold tracking-tight transition-colors ${
                      isActive ? 'text-accent' : 'text-ink-muted'
                    }`}
                  >
                    {tab.label}
                  </span>
                </button>
              );
            }

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onNavigate(tab.id)}
                aria-current={isActive ? 'page' : undefined}
                aria-label={tab.label}
                className={`relative min-h-[48px] flex flex-col items-center justify-center gap-0.5 transition-colors duration-150 active:scale-95 ${
                  isActive ? 'text-accent' : 'text-ink-subtle hover:text-ink'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute top-0 w-7 h-[2.5px] rounded-full bg-accent transition-all duration-200 ${
                    isActive ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-0'
                  }`}
                />

                {tab.id === 'profile' && profile?.avatarUrl ? (
                  <span
                    className={`rounded-full p-[1.5px] transition-transform duration-150 ${
                      isActive ? 'ring-2 ring-accent scale-105' : 'opacity-85'
                    }`}
                  >
                    <Avatar
                      src={profile.avatarUrl}
                      name={profile.fullName}
                      size="sm"
                      className="w-5 h-5 text-[9px]"
                    />
                  </span>
                ) : (
                  <Icon
                    className={`w-[20px] h-[20px] transition-transform duration-150 ${
                      isActive ? 'stroke-[2.3] scale-105' : ''
                    }`}
                  />
                )}

                <span className="text-[10px] font-semibold tracking-tight">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
