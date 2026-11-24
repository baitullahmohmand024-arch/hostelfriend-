import { useCallback, useEffect, useRef, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { Compass, Film, LogIn, TrendingUp } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider, useToast } from './context/ToastContext';
import { formatUserFriendlyError } from './lib/firestoreError';
import { normalizeNotificationType } from './services/notificationService';
import { getUserProfile } from './services/userService';
import { AppView, NotificationItem, UserProfile } from './types';
import { Layout } from './components/Layout';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PostDetailModal } from './components/PostDetailModal';
import { LandingPage } from './pages/LandingPage';
import { AuthPage } from './pages/AuthPage';
import { FeedPage } from './pages/FeedPage';
import { ExplorePage } from './pages/ExplorePage';
import { TrendsPage } from './pages/TrendsPage';
import { MomentsPage } from './pages/MomentsPage';
import { CreatePostPage } from './pages/CreatePostPage';
import { ProfilePage } from './pages/ProfilePage';
import { NotificationsPage } from './pages/NotificationsPage';
import { MessagesPage } from './pages/MessagesPage';
import { SettingsPage } from './pages/SettingsPage';
import { AdminPage } from './pages/AdminPage';

interface RouteSnapshot {
  view: AppView;
  profileUserId?: string;
  exploreTag?: string;
  exploreQuery?: string;
  initialConversationId?: string | null;
  notificationsInitialTab?: 'all' | 'unread' | 'requests';
}

const VALID_VIEWS: ReadonlySet<AppView> = new Set<AppView>([
  'landing',
  'auth',
  'feed',
  'explore',
  'trends',
  'moments',
  'messages',
  'notifications',
  'create',
  'profile',
  'settings',
  'admin',
]);

const PROTECTED_VIEWS: ReadonlySet<AppView> = new Set<AppView>([
  'feed',
  'create',
  'messages',
  'notifications',
  'settings',
  'admin',
]);

function buildHistoryUrl(snap: RouteSnapshot): string {
  if (snap.view === 'landing') return '/';
  const params = new URLSearchParams();
  params.set('view', snap.view);
  if (snap.view === 'profile' && snap.profileUserId) {
    params.set('uid', snap.profileUserId);
  }
  if (snap.view === 'explore') {
    if (snap.exploreTag) params.set('tag', snap.exploreTag);
    else if (snap.exploreQuery) params.set('q', snap.exploreQuery);
  }
  if (snap.view === 'messages' && snap.initialConversationId) {
    params.set('conversationId', snap.initialConversationId);
  }
  if (
    snap.view === 'notifications' &&
    snap.notificationsInitialTab &&
    snap.notificationsInitialTab !== 'all'
  ) {
    params.set('tab', snap.notificationsInitialTab);
  }
  return `/?${params.toString()}`;
}

function HostelverseRouter() {
  const {
    firebaseUser,
    profile,
    isAdmin,
    authReady,
    connectionOk,
    needsVerification,
    needsOnboarding,
    platformSettings,
    unreadNotifications,
    unreadMessages,
    signInWithGoogle,
    logout,
  } = useAuth();
  const { showToast } = useToast();

  const [view, setView] = useState<AppView>('landing');
  const [authInitialMode, setAuthInitialMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [profileUserId, setProfileUserId] = useState<string>('');
  const [exploreTag, setExploreTag] = useState<string>('');
  const [exploreQuery, setExploreQuery] = useState<string>('');
  const [messageTargetUser, setMessageTargetUser] = useState<UserProfile | null>(null);
  const [initialConversationId, setInitialConversationId] = useState<string | null>(null);
  const [notificationsInitialTab, setNotificationsInitialTab] = useState<
    'all' | 'unread' | 'requests'
  >('all');
  const [detailPostId, setDetailPostId] = useState<string | null>(null);
  const [detailCommentId, setDetailCommentId] = useState<string | undefined>(undefined);
  const [connectingGoogle, setConnectingGoogle] = useState(false);

  const initializedRouteRef = useRef(false);

  const applyRouteSnapshot = useCallback(
    (snap: RouteSnapshot, historyMode: 'push' | 'replace' | 'none' = 'push') => {
      setView(snap.view);
      if (typeof snap.profileUserId === 'string') {
        setProfileUserId(snap.profileUserId);
      }
      if (typeof snap.exploreTag === 'string') {
        setExploreTag(snap.exploreTag);
      }
      if (typeof snap.exploreQuery === 'string') {
        setExploreQuery(snap.exploreQuery);
      }
      if (snap.initialConversationId !== undefined) {
        setInitialConversationId(snap.initialConversationId);
      }
      if (snap.notificationsInitialTab) {
        setNotificationsInitialTab(snap.notificationsInitialTab);
      }

      if (historyMode !== 'none' && typeof window !== 'undefined') {
        const targetUrl = buildHistoryUrl(snap);
        const currentUrl = `${window.location.pathname}${window.location.search}`;
        if (historyMode === 'replace') {
          window.history.replaceState(snap, '', targetUrl);
        } else if (currentUrl !== targetUrl) {
          window.history.pushState(snap, '', targetUrl);
        }
      }
    },
    []
  );

  const parseLocationToSnapshot = useCallback(
    (rawSearch: string): { snapshot: RouteSnapshot; postId?: string; commentId?: string } => {
      const queryStr = rawSearch.includes('?') ? rawSearch.split('?')[1] : rawSearch;
      const params = new URLSearchParams(queryStr);
      const rawView = params.get('view') as AppView | null;
      const postParam = params.get('post') || undefined;
      const commentParam = params.get('commentId') || undefined;
      const conversationParam = params.get('conversationId');
      const uidParam = params.get('uid') || '';
      const tagParam = params.get('tag') || '';
      const qParam = params.get('q') || '';
      const tabParam = params.get('tab');

      if (postParam) {
        return {
          snapshot: { view: 'feed' },
          postId: postParam,
          commentId: commentParam,
        };
      }

      if (rawView && VALID_VIEWS.has(rawView)) {
        if (rawView === 'messages') {
          return {
            snapshot: {
              view: 'messages',
              initialConversationId: conversationParam || null,
            },
          };
        }
        if (rawView === 'profile' && uidParam) {
          return {
            snapshot: {
              view: 'profile',
              profileUserId: uidParam,
            },
          };
        }
        if (rawView === 'notifications') {
          return {
            snapshot: {
              view: 'notifications',
              notificationsInitialTab:
                tabParam === 'requests' ? 'requests' : tabParam === 'unread' ? 'unread' : 'all',
            },
          };
        }
        if (rawView === 'explore') {
          return {
            snapshot: {
              view: 'explore',
              exploreTag: tagParam,
              exploreQuery: qParam,
            },
          };
        }
        return {
          snapshot: { view: rawView },
        };
      }

      return { snapshot: { view: 'landing' } };
    },
    []
  );

  const applyDeepLink = useCallback(
    (rawSearch: string, historyMode: 'push' | 'replace' = 'push') => {
      const { snapshot, postId, commentId } = parseLocationToSnapshot(rawSearch);
      if (postId) {
        setDetailPostId(postId);
        setDetailCommentId(commentId);
        applyRouteSnapshot({ view: 'feed' }, historyMode);
        return;
      }
      applyRouteSnapshot(snapshot, historyMode);
    },
    [parseLocationToSnapshot, applyRouteSnapshot]
  );

  // Sync authenticated state on initial load + apply query deep links cleanly
  useEffect(() => {
    if (!authReady) return;
    if (firebaseUser && (needsVerification || needsOnboarding)) {
      initializedRouteRef.current = true;
      setView('auth');
      return;
    }

    if (!initializedRouteRef.current) {
      initializedRouteRef.current = true;
      const search = window.location.search;
      if (search) {
        const parsed = parseLocationToSnapshot(search);
        if (parsed.postId && firebaseUser && profile) {
          setDetailPostId(parsed.postId);
          setDetailCommentId(parsed.commentId);
          applyRouteSnapshot({ view: 'feed' }, 'replace');
          return;
        }
        const target = parsed.snapshot;
        if (firebaseUser && profile) {
          if (target.view === 'landing' || target.view === 'auth') {
            applyRouteSnapshot({ view: 'feed' }, 'replace');
          } else if (target.view === 'profile' && !target.profileUserId) {
            applyRouteSnapshot({ view: 'profile', profileUserId: profile.uid }, 'replace');
          } else {
            applyRouteSnapshot(target, 'replace');
          }
          return;
        }
        // Logged-out deep link allowance for public routes
        if (
          target.view === 'explore' ||
          target.view === 'trends' ||
          target.view === 'moments' ||
          (target.view === 'profile' && target.profileUserId)
        ) {
          applyRouteSnapshot(target, 'replace');
          return;
        }
      }

      if (firebaseUser && profile) {
        applyRouteSnapshot({ view: 'feed' }, 'replace');
      } else {
        applyRouteSnapshot({ view: 'landing' }, 'replace');
      }
      return;
    }

    // Handle auth transitions (login / logout)
    if (firebaseUser && profile && (view === 'landing' || view === 'auth')) {
      applyRouteSnapshot({ view: 'feed' }, 'replace');
    }
  }, [
    authReady,
    firebaseUser,
    profile,
    needsVerification,
    needsOnboarding,
    view,
    parseLocationToSnapshot,
    applyRouteSnapshot,
  ]);

  // Browser Back & Forward button integration
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPopState = (event: PopStateEvent) => {
      setDetailPostId(null);
      setDetailCommentId(undefined);

      const rawState = event.state as RouteSnapshot | null;
      const candidate: RouteSnapshot =
        rawState && typeof rawState.view === 'string' && VALID_VIEWS.has(rawState.view)
          ? rawState
          : parseLocationToSnapshot(window.location.search).snapshot;

      if (firebaseUser && (needsVerification || needsOnboarding)) {
        setView('auth');
        return;
      }

      if (!profile) {
        if (
          PROTECTED_VIEWS.has(candidate.view) ||
          (candidate.view === 'profile' && !candidate.profileUserId)
        ) {
          applyRouteSnapshot({ view: 'landing' }, 'replace');
          return;
        }
        applyRouteSnapshot(candidate, 'none');
        return;
      }

      if (candidate.view === 'landing' || candidate.view === 'auth') {
        applyRouteSnapshot({ view: 'feed' }, 'replace');
        return;
      }

      if (candidate.view === 'profile' && !candidate.profileUserId) {
        applyRouteSnapshot({ ...candidate, profileUserId: profile.uid }, 'none');
        return;
      }

      applyRouteSnapshot(candidate, 'none');
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [
    firebaseUser,
    profile,
    needsVerification,
    needsOnboarding,
    parseLocationToSnapshot,
    applyRouteSnapshot,
  ]);

  // Listen for push notification click messages sent by the unified service worker or FCM SW
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const onSwMessage = (event: MessageEvent) => {
      const payload = event.data as
        | {
            type?: string;
            actionUrl?: string;
            isFirebaseMessaging?: boolean;
            messageType?: string;
            data?: { actionUrl?: string };
            fcmOptions?: { link?: string };
          }
        | undefined;
      if (!payload) return;

      if (payload.type === 'HOSTEL_FRIEND_NOTIFICATION_CLICK' && payload.actionUrl) {
        applyDeepLink(payload.actionUrl, 'push');
        return;
      }

      if (payload.isFirebaseMessaging && payload.messageType === 'notification-clicked') {
        const link = payload.fcmOptions?.link || payload.data?.actionUrl;
        if (link) {
          applyDeepLink(link, 'push');
        }
      }
    };
    navigator.serviceWorker.addEventListener('message', onSwMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onSwMessage);
  }, [applyDeepLink]);

  const requireAuth = (mode: 'login' | 'signup' = 'login') => {
    setAuthInitialMode(mode);
    applyRouteSnapshot({ view: 'auth' }, 'push');
  };

  const handleLandingGoogleConnect = async () => {
    if (connectingGoogle) return;
    setConnectingGoogle(true);
    try {
      await signInWithGoogle();
      showToast({ type: 'success', title: 'Google account connected' });
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/popup-blocked') {
        requireAuth('signup');
        showToast({
          type: 'info',
          title: 'Allow pop-ups to connect Google',
          description: 'Tap Continue with Google below to finish connecting your account.',
        });
      } else if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        showToast({
          type: 'error',
          title: 'Could not connect Google account',
          description: formatUserFriendlyError(err),
        });
      }
    } finally {
      setConnectingGoogle(false);
    }
  };

  const handleNavigate = (nextView: AppView) => {
    if (PROTECTED_VIEWS.has(nextView) && !profile) {
      requireAuth('login');
      return;
    }
    if (nextView === 'profile') {
      if (!profile) {
        requireAuth('login');
        return;
      }
      applyRouteSnapshot({ view: 'profile', profileUserId: profile.uid }, 'push');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (nextView === 'explore') {
      applyRouteSnapshot({ view: 'explore', exploreTag: '', exploreQuery: '' }, 'push');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    applyRouteSnapshot({ view: nextView }, 'push');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openMemberProfile = (uid: string) => {
    applyRouteSnapshot({ view: 'profile', profileUserId: uid }, 'push');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openHashtagExplore = (tag: string) => {
    const clean = tag.replace(/^#/, '');
    applyRouteSnapshot({ view: 'explore', exploreTag: clean, exploreQuery: '' }, 'push');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleHeaderSearchSubmit = (rawQuery: string) => {
    const trimmed = rawQuery.trim();
    if (trimmed.startsWith('#') && trimmed.length > 1) {
      openHashtagExplore(trimmed.slice(1));
      return;
    }
    applyRouteSnapshot({ view: 'explore', exploreTag: '', exploreQuery: trimmed }, 'push');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openMessageWithUser = (target: UserProfile) => {
    if (!profile) {
      requireAuth('login');
      return;
    }
    setMessageTargetUser(target);
    applyRouteSnapshot({ view: 'messages', initialConversationId: null }, 'push');
  };

  const handleOpenNotificationDestination = async (item: NotificationItem) => {
    const canonical = normalizeNotificationType(item.type);
    const postId = item.relatedPostId || item.postId || '';

    switch (canonical) {
      case 'NEW_MESSAGE': {
        if (item.relatedConversationId) {
          setMessageTargetUser(null);
          applyRouteSnapshot(
            { view: 'messages', initialConversationId: item.relatedConversationId },
            'push'
          );
        } else if (item.actorId) {
          const actorProfile = await getUserProfile(item.actorId).catch(() => null);
          if (actorProfile) {
            openMessageWithUser(actorProfile);
          } else {
            applyRouteSnapshot({ view: 'messages' }, 'push');
          }
        } else {
          applyRouteSnapshot({ view: 'messages' }, 'push');
        }
        break;
      }
      case 'POST_LIKE':
      case 'POST_COMMENT':
      case 'COMMENT_REPLY':
      case 'USER_MENTION': {
        if (postId) {
          setDetailPostId(postId);
          setDetailCommentId(item.relatedCommentId || undefined);
        } else if (item.actorId) {
          openMemberProfile(item.actorId);
        }
        break;
      }
      case 'NEW_FOLLOWER':
      case 'FRIEND_REQUEST_ACCEPTED': {
        if (item.actorId) {
          openMemberProfile(item.actorId);
        }
        break;
      }
      case 'FRIEND_REQUEST': {
        applyRouteSnapshot(
          { view: 'notifications', notificationsInitialTab: 'requests' },
          'push'
        );
        break;
      }
      default:
        break;
    }
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-canvas-alt flex flex-col items-center justify-center gap-4">
        <img
          src="/icons/icon-192.png"
          alt="Hostel Friend"
          className="w-16 h-16 rounded-2xl object-cover border border-hairline-strong shadow-lg"
        />
        <div className="text-center">
          <p className="font-display font-bold text-lg tracking-tight text-ink-2">
            Hostel Friend
          </p>
          <p className="mt-0.5 text-[11px] tracking-[0.16em] uppercase text-accent">
            Connect • Share • Discover
          </p>
        </div>
      </div>
    );
  }

  if (view === 'auth' || (firebaseUser && (needsVerification || needsOnboarding))) {
    return (
      <AuthPage
        initialMode={authInitialMode}
        onBackToLanding={() => applyRouteSnapshot({ view: 'landing' }, 'push')}
        onAuthenticated={() => applyRouteSnapshot({ view: 'feed' }, 'replace')}
      />
    );
  }

  if (view === 'landing' && !profile) {
    return (
      <LandingPage
        onCreateAccount={() => requireAuth('signup')}
        onLogin={() => requireAuth('login')}
        onExploreCommunity={() =>
          applyRouteSnapshot({ view: 'explore', exploreTag: '', exploreQuery: '' }, 'push')
        }
        onConnectGoogle={handleLandingGoogleConnect}
        connectingGoogle={connectingGoogle}
      />
    );
  }

  if (profile?.isSuspended && view !== 'settings') {
    return (
      <div className="min-h-screen bg-canvas-alt flex items-center justify-center p-4">
        <div className="glass-surface max-w-md w-full rounded-2xl p-8 text-center border border-rose-500/30">
          <h1 className="font-display text-xl font-bold text-ink-2">Account Suspended</h1>
          <p className="mt-2 text-sm text-ink-muted leading-relaxed">
            Your Hostel Friend account is currently suspended following a community safety review.
          </p>
          <button
            type="button"
            onClick={async () => {
              await logout();
              applyRouteSnapshot({ view: 'landing' }, 'replace');
            }}
            className="mt-6 px-5 py-2.5 rounded-xl text-xs font-semibold border border-hairline-strong text-ink-2 hover:bg-hover-tint"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  // Guest Explore / Trends / Moments / Profile view (when browsing without signing in)
  if (!profile) {
    return (
      <div className="min-h-screen text-ink overflow-x-clip">
        <header className="sticky top-0 z-30 h-14 sm:h-16 glass-nav border-b border-hairline">
          <div className="max-w-6xl mx-auto px-3.5 sm:px-6 h-full flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => applyRouteSnapshot({ view: 'landing' }, 'push')}
              className="flex items-center gap-2.5 font-display font-bold tracking-tight text-base sm:text-lg text-ink whitespace-nowrap shrink-0"
            >
              <img
                src="/icons/icon-192.png"
                alt="Hostel Friend"
                className="w-8 h-8 rounded-xl object-cover border border-accent/45"
              />
              <span>
                Hostel <span className="text-accent">Friend</span>
              </span>
            </button>

            <nav
              aria-label="Public community navigation"
              className="hidden md:flex items-center gap-6 text-sm font-medium text-ink-muted"
            >
              <button
                type="button"
                aria-current={view === 'explore' ? 'page' : undefined}
                onClick={() => handleNavigate('explore')}
                className={`py-1 whitespace-nowrap transition-colors ${
                  view === 'explore' ? 'text-accent font-semibold' : 'hover:text-ink'
                }`}
              >
                Explore
              </button>
              <button
                type="button"
                aria-current={view === 'trends' ? 'page' : undefined}
                onClick={() => handleNavigate('trends')}
                className={`py-1 whitespace-nowrap transition-colors ${
                  view === 'trends' ? 'text-accent font-semibold' : 'hover:text-ink'
                }`}
              >
                Trends
              </button>
              <button
                type="button"
                aria-current={view === 'moments' ? 'page' : undefined}
                onClick={() => handleNavigate('moments')}
                className={`py-1 whitespace-nowrap transition-colors ${
                  view === 'moments' ? 'text-accent font-semibold' : 'hover:text-ink'
                }`}
              >
                Moments
              </button>
            </nav>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => requireAuth('login')}
                className="hidden sm:inline-flex min-h-[38px] px-3.5 py-2 rounded-xl text-xs font-semibold text-ink border border-hairline-strong hover:border-accent/45 whitespace-nowrap"
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => requireAuth('signup')}
                className="gold-gradient-btn min-h-[38px] px-3.5 sm:px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap shrink-0"
              >
                Join Hostel Friend
              </button>
            </div>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-3.5 sm:px-6 py-6 sm:py-8 pb-[calc(5.25rem+env(safe-area-inset-bottom))] md:pb-12">
          <div key={view} className="hf-page-enter">
            {view === 'moments' ? (
              <MomentsPage
                onOpenProfile={openMemberProfile}
                onNavigateCreate={() => requireAuth('signup')}
                onRequireAuth={() => requireAuth('login')}
              />
            ) : view === 'trends' ? (
              <TrendsPage
                onSearchHashtag={openHashtagExplore}
                onNavigateCreate={() => requireAuth('signup')}
              />
            ) : view === 'profile' && profileUserId ? (
              <ProfilePage
                targetUserId={profileUserId}
                onOpenProfile={openMemberProfile}
                onMessageUser={openMessageWithUser}
                onSearchHashtag={openHashtagExplore}
                onRequireAuth={() => requireAuth('login')}
              />
            ) : (
              <ExplorePage
                initialHashtag={exploreTag}
                initialQuery={exploreQuery}
                onOpenProfile={openMemberProfile}
                onRequireAuth={() => requireAuth('login')}
                onOpenTrends={() => handleNavigate('trends')}
              />
            )}
          </div>
        </main>

        {/* Guest Mobile Bottom Navigation */}
        <nav
          aria-label="Mobile public navigation"
          className="md:hidden fixed bottom-0 left-0 right-0 z-40 glass-nav border-t border-hairline pb-[env(safe-area-inset-bottom)]"
        >
          <div className="grid grid-cols-4 items-center h-[58px] px-1">
            <button
              type="button"
              onClick={() => handleNavigate('explore')}
              aria-current={view === 'explore' ? 'page' : undefined}
              className={`relative min-h-[48px] flex flex-col items-center justify-center gap-0.5 transition-colors active:scale-95 ${
                view === 'explore' ? 'text-accent' : 'text-ink-subtle'
              }`}
            >
              <Compass className="w-5 h-5" />
              <span className="text-[10px] font-semibold">Explore</span>
            </button>
            <button
              type="button"
              onClick={() => handleNavigate('trends')}
              aria-current={view === 'trends' ? 'page' : undefined}
              className={`relative min-h-[48px] flex flex-col items-center justify-center gap-0.5 transition-colors active:scale-95 ${
                view === 'trends' ? 'text-accent' : 'text-ink-subtle'
              }`}
            >
              <TrendingUp className="w-5 h-5" />
              <span className="text-[10px] font-semibold">Trends</span>
            </button>
            <button
              type="button"
              onClick={() => handleNavigate('moments')}
              aria-current={view === 'moments' ? 'page' : undefined}
              className={`relative min-h-[48px] flex flex-col items-center justify-center gap-0.5 transition-colors active:scale-95 ${
                view === 'moments' ? 'text-accent' : 'text-ink-subtle'
              }`}
            >
              <Film className="w-5 h-5" />
              <span className="text-[10px] font-semibold">Moments</span>
            </button>
            <button
              type="button"
              onClick={() => requireAuth('login')}
              className="min-h-[48px] flex flex-col items-center justify-center gap-0.5 text-accent active:scale-95"
            >
              <LogIn className="w-5 h-5" />
              <span className="text-[10px] font-semibold">Sign In</span>
            </button>
          </div>
        </nav>
      </div>
    );
  }

  return (
    <Layout
      activeView={view}
      onNavigate={handleNavigate}
      onSearchSubmit={handleHeaderSearchSubmit}
      profile={profile}
      isAdmin={isAdmin}
      unreadNotifications={unreadNotifications}
      unreadMessages={unreadMessages}
      maintenanceNotice={
        !connectionOk
          ? 'Offline mode detected. Check your network connection.'
          : platformSettings.maintenanceNotice
      }
      onLogout={async () => {
        await logout();
        applyRouteSnapshot({ view: 'landing' }, 'replace');
      }}
    >
      {view === 'feed' && (
        <FeedPage
          onNavigateCreate={() => handleNavigate('create')}
          onNavigateExplore={() => handleNavigate('explore')}
          onOpenProfile={openMemberProfile}
          onSearchHashtag={openHashtagExplore}
          onRequireAuth={() => requireAuth('login')}
        />
      )}

      {view === 'explore' && (
        <ExplorePage
          initialHashtag={exploreTag}
          initialQuery={exploreQuery}
          onOpenProfile={openMemberProfile}
          onRequireAuth={() => requireAuth('login')}
          onOpenTrends={() => handleNavigate('trends')}
        />
      )}

      {view === 'trends' && (
        <TrendsPage
          onSearchHashtag={openHashtagExplore}
          onNavigateCreate={() => handleNavigate('create')}
        />
      )}

      {view === 'moments' && (
        <MomentsPage
          onOpenProfile={openMemberProfile}
          onNavigateCreate={() => handleNavigate('create')}
          onRequireAuth={() => requireAuth('login')}
          onSearchHashtag={openHashtagExplore}
        />
      )}

      {view === 'create' && (
        <CreatePostPage
          onPublished={() => handleNavigate('feed')}
          onCancel={() => handleNavigate('feed')}
        />
      )}

      {view === 'profile' && (
        <ProfilePage
          targetUserId={profileUserId || profile.uid}
          onOpenProfile={openMemberProfile}
          onMessageUser={openMessageWithUser}
          onSearchHashtag={openHashtagExplore}
          onNavigateSettings={() => handleNavigate('settings')}
          onOpenPost={(postId) => {
            setDetailCommentId(undefined);
            setDetailPostId(postId);
          }}
          onRequireAuth={() => requireAuth('login')}
        />
      )}

      {view === 'notifications' && (
        <NotificationsPage
          initialTab={notificationsInitialTab}
          onOpenProfile={openMemberProfile}
          onOpenNotification={(item) => {
            void handleOpenNotificationDestination(item);
          }}
        />
      )}

      {view === 'messages' && (
        <MessagesPage
          initialTargetUser={messageTargetUser}
          initialConversationId={initialConversationId}
          onClearInitialTarget={() => setMessageTargetUser(null)}
          onClearInitialConversation={() => setInitialConversationId(null)}
          onOpenProfile={openMemberProfile}
        />
      )}

      {view === 'settings' && (
        <SettingsPage onLoggedOut={() => applyRouteSnapshot({ view: 'landing' }, 'replace')} />
      )}

      {view === 'admin' && <AdminPage />}

      <PostDetailModal
        postId={detailPostId}
        highlightCommentId={detailCommentId}
        openCommentsByDefault={Boolean(detailCommentId) || Boolean(detailPostId)}
        onClose={() => {
          setDetailPostId(null);
          setDetailCommentId(undefined);
        }}
        onOpenProfile={openMemberProfile}
        onSearchHashtag={openHashtagExplore}
        onRequireAuth={() => requireAuth('login')}
      />
    </Layout>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <HostelverseRouter />
        <OfflineIndicator />
        <Analytics />
      </AuthProvider>
    </ToastProvider>
  );
}
