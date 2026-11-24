import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { updateProfile } from 'firebase/auth';
import {
  Ban,
  Bookmark,
  Calendar,
  Camera,
  CheckCircle2,
  Copy,
  Edit3,
  Film,
  Flag,
  Grid,
  Image as ImageIcon,
  ImageOff,
  Info,
  Loader2,
  MapPin,
  MessageSquare,
  MoreHorizontal,
  Play,
  RefreshCw,
  Settings,
  Share2,
  ShieldAlert,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { FriendRequest, Post, ReactionType, UserProfile } from '../types';
import {
  deletePost,
  fetchPostById,
  fetchPostsByAuthor,
  fetchPostsPage,
  getUserPostReactions,
  getUserSavedPostIds,
  reactToPost,
  toggleSavePost,
} from '../services/postService';
import { isLegacyPollPost } from '../services/pollService';
import { computeNextReactionState } from '../utils/reactions';
import {
  followUser,
  getUserProfile,
  isFollowingUser,
  unfollowUser,
  updateUserPrivateSettings,
  updateUserProfile,
} from '../services/userService';
import {
  cancelOrRemoveFriendRequest,
  getFriendRequestBetween,
  respondToFriendRequest,
  sendFriendRequest,
} from '../services/notificationService';
import { uploadMediaFile, validateMediaFile } from '../services/mediaService';
import { Avatar } from '../components/Avatar';
import { EditProfileModal } from '../components/EditProfileModal';
import { PostCard } from '../components/PostCard';
import { ProfilePageSkeleton } from '../components/Skeletons';
import { ReportModal } from '../components/ReportModal';
import { formatCount, formatRelativeTime } from '../utils/formatters';
import { formatUserFriendlyError } from '../lib/firestoreError';
import { useModalBackHandler } from '../lib/backNavigation';
import { shareNativeContent } from '../lib/nativeBridge';
import { getPublicAppUrl, isNativePlatform } from '../lib/nativePlatform';
import { playSound } from '../utils/soundVfx';
import defaultCoverImg from '../assets/images/default_cover_obsidian_1794541690832.jpg';

interface ProfilePageProps {
  targetUserId: string;
  onOpenProfile: (userId: string) => void;
  onMessageUser: (targetUser: UserProfile) => void;
  onSearchHashtag: (tag: string) => void;
  onRequireAuth: () => void;
  onNavigateSettings?: () => void;
  onOpenPost?: (postId: string) => void;
}

type ProfileTab = 'posts' | 'photos' | 'videos' | 'saved' | 'about';

const DEFAULT_COVER = defaultCoverImg;

interface MediaTileProps {
  post: Post;
  type: 'photo' | 'video';
  onOpen: (post: Post) => void;
}

function MediaTile({ post, type, onOpen }: MediaTileProps) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const src = type === 'photo' ? post.mediaUrl : post.thumbnailUrl || '';

  return (
    <button
      type="button"
      onClick={() => onOpen(post)}
      aria-label={post.caption ? `Open ${type}: ${post.caption.slice(0, 60)}` : `Open ${type} post`}
      className="group relative aspect-square w-full overflow-hidden rounded-xl bg-canvas-alt border border-hairline hover:border-accent/45 transition-colors text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {type === 'photo' ? (
        src && !thumbFailed ? (
          <img
            src={src}
            alt={post.caption || 'Member photo'}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setThumbFailed(true)}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-ink-subtle">
            <ImageOff className="w-5 h-5" />
            <span className="text-[11px]">Unavailable</span>
          </div>
        )
      ) : src && !thumbFailed ? (
        <img
          src={src}
          alt={post.caption || 'Video thumbnail'}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setThumbFailed(true)}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
      ) : post.mediaUrl && !thumbFailed ? (
        <video
          src={post.mediaUrl}
          muted
          playsInline
          preload="metadata"
          onError={() => setThumbFailed(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-ink-subtle">
          <Film className="w-5 h-5" />
          <span className="text-[11px]">Video</span>
        </div>
      )}

      {type === 'video' && (
        <div className="absolute top-2.5 right-2.5 w-8 h-8 rounded-full bg-black/75 border border-white/20 flex items-center justify-center text-white backdrop-blur-sm">
          <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 p-2.5 bg-gradient-to-t from-black/85 via-black/40 to-transparent opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity flex items-center justify-between text-[11px] font-mono text-white tabular-nums">
        <span>{formatCount(post.likesCount)} reactions</span>
        <span>{formatCount(post.commentsCount)} comments</span>
      </div>
    </button>
  );
}

export function ProfilePage({
  targetUserId,
  onOpenProfile,
  onMessageUser,
  onSearchHashtag,
  onRequireAuth,
  onNavigateSettings,
  onOpenPost,
}: ProfilePageProps) {
  const {
    firebaseUser,
    profile: currentUser,
    privateSettings,
    isAdmin,
    platformSettings,
    setProfile: setAuthProfile,
    setPrivateSettings,
  } = useAuth();
  const { showToast } = useToast();

  const currentUid = currentUser?.uid ?? null;
  const isOwnProfile = currentUid === targetUserId;
  const isVerifiedBadge = Boolean(isOwnProfile && firebaseUser?.emailVerified);

  const [member, setMember] = useState<UserProfile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [savedPosts, setSavedPosts] = useState<Post[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedLoaded, setSavedLoaded] = useState(false);

  const [activeTab, setActiveTab] = useState<ProfileTab>('posts');
  const [following, setFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [friendRequest, setFriendRequest] = useState<FriendRequest | null>(null);
  const [friendBusy, setFriendBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [userReactions, setUserReactions] = useState<Map<string, ReactionType>>(
    () => new Map()
  );
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const [directUploadTarget, setDirectUploadTarget] = useState<'avatars' | 'covers' | null>(null);
  const [directUploadProgress, setDirectUploadProgress] = useState(0);
  const [localAvatarPreview, setLocalAvatarPreview] = useState('');
  const [localCoverPreview, setLocalCoverPreview] = useState('');
  const [coverStage, setCoverStage] = useState<'member' | 'default' | 'gradient'>('member');

  const [editOpen, setEditOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [fallbackPreviewPost, setFallbackPreviewPost] = useState<Post | null>(null);

  const moreMenuRef = useRef<HTMLDivElement>(null);
  const loadSeqRef = useRef(0);

  const isBlocked = Boolean(privateSettings?.blockedUserIds.includes(targetUserId));

  // Keep own profile header synced with AuthContext updates
  useEffect(() => {
    if (isOwnProfile && currentUser) {
      setMember(currentUser);
    }
  }, [isOwnProfile, currentUser]);

  // Reset per-profile UI state when navigating between profiles
  useEffect(() => {
    setActiveTab('posts');
    setSavedPosts([]);
    setSavedLoaded(false);
    setMoreMenuOpen(false);
    setEditOpen(false);
    setReportOpen(false);
    setFallbackPreviewPost(null);
  }, [targetUserId]);

  // Reset cover fallback stage whenever member coverUrl changes
  useEffect(() => {
    setCoverStage(member?.coverUrl ? 'member' : 'default');
  }, [member?.coverUrl, targetUserId]);

  // Revoke object URLs on unmount/change
  useEffect(() => {
    return () => {
      if (localAvatarPreview) URL.revokeObjectURL(localAvatarPreview);
    };
  }, [localAvatarPreview]);

  useEffect(() => {
    return () => {
      if (localCoverPreview) URL.revokeObjectURL(localCoverPreview);
    };
  }, [localCoverPreview]);

  // Close More Options menu on outside click or Escape
  useEffect(() => {
    if (!moreMenuOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [moreMenuOpen]);

  useModalBackHandler(moreMenuOpen, () => setMoreMenuOpen(false));
  useModalBackHandler(Boolean(fallbackPreviewPost), () => setFallbackPreviewPost(null));

  // Close guest fallback lightbox on Escape
  useEffect(() => {
    if (!fallbackPreviewPost) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFallbackPreviewPost(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fallbackPreviewPost]);

  const loadProfileData = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    setLoading(true);
    setLoadError(null);

    try {
      const [loadedMember, authorPosts] = await Promise.all([
        getUserProfile(targetUserId),
        fetchPostsByAuthor(targetUserId),
      ]);

      if (loadSeqRef.current !== seq) return;
      setMember(loadedMember);
      setPosts(authorPosts);

      if (currentUid) {
        const [reactions, saves, isFol, fReq] = await Promise.all([
          getUserPostReactions(currentUid),
          getUserSavedPostIds(currentUid),
          currentUid !== targetUserId
            ? isFollowingUser(currentUid, targetUserId)
            : Promise.resolve(false),
          currentUid !== targetUserId
            ? getFriendRequestBetween(currentUid, targetUserId)
            : Promise.resolve(null),
        ]);

        if (loadSeqRef.current !== seq) return;
        setUserReactions(reactions);
        setSavedIds(saves);
        setFollowing(isFol);
        setFriendRequest(fReq);
      } else {
        setUserReactions(new Map());
        setSavedIds(new Set());
        setFollowing(false);
        setFriendRequest(null);
      }
    } catch (err) {
      if (loadSeqRef.current !== seq) return;
      setLoadError(formatUserFriendlyError(err, 'Could not load this member profile.'));
    } finally {
      if (loadSeqRef.current === seq) {
        setLoading(false);
      }
    }
  }, [targetUserId, currentUid]);

  useEffect(() => {
    void loadProfileData();
  }, [loadProfileData]);

  // Lazy-load saved posts only when owner selects the Saved Posts tab
  useEffect(() => {
    if (!isOwnProfile || activeTab !== 'saved' || savedLoaded) return;

    let cancelled = false;
    const ids = Array.from(savedIds);
    if (ids.length === 0) {
      setSavedPosts([]);
      setSavedLoaded(true);
      return;
    }

    const loadSaved = async () => {
      setSavedLoading(true);
      try {
        const recent = await fetchPostsPage(null, 50);
        if (cancelled) return;
        const byId = new Map<string, Post>();
        recent.posts.forEach((p) => {
          if (savedIds.has(p.id)) byId.set(p.id, p);
        });

        const missingIds = ids.filter((id) => !byId.has(id)).slice(0, 20);
        if (missingIds.length > 0) {
          const fetchedMissing = await Promise.all(
            missingIds.map((id) => fetchPostById(id).catch(() => null))
          );
          if (cancelled) return;
          fetchedMissing.forEach((post) => {
            if (post) byId.set(post.id, post);
          });
        }

        const resolved = Array.from(byId.values()).sort(
          (a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0)
        );
        setSavedPosts(resolved);
        setSavedLoaded(true);
      } catch (err) {
        if (!cancelled) {
          showToast({
            type: 'error',
            title: 'Could not load saved posts',
            description: formatUserFriendlyError(err),
          });
        }
      } finally {
        if (!cancelled) setSavedLoading(false);
      }
    };

    void loadSaved();
    return () => {
      cancelled = true;
    };
  }, [isOwnProfile, activeTab, savedLoaded, savedIds, showToast]);

  const photoPosts = useMemo(
    () => posts.filter((p) => p.mediaType === 'image' && Boolean(p.mediaUrl)),
    [posts]
  );

  const videoPosts = useMemo(
    () => posts.filter((p) => p.mediaType === 'video' && Boolean(p.mediaUrl)),
    [posts]
  );

  const joinedLabel = useMemo(() => {
    if (!member?.createdAt) return null;
    try {
      return member.createdAt
        .toDate()
        .toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    } catch {
      return null;
    }
  }, [member?.createdAt]);

  const handleDirectMediaUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    folder: 'avatars' | 'covers'
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !currentUser || !member || directUploadTarget) return;

    const validation = validateMediaFile(file, platformSettings.maxUploadSizeMB);
    if (!validation.valid || validation.mediaType !== 'image') {
      showToast({
        type: 'error',
        title: 'Invalid image',
        description:
          validation.error || 'Please choose a JPEG, PNG, or WebP image from your gallery.',
      });
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    if (folder === 'avatars') {
      if (localAvatarPreview) URL.revokeObjectURL(localAvatarPreview);
      setLocalAvatarPreview(previewUrl);
    } else {
      if (localCoverPreview) URL.revokeObjectURL(localCoverPreview);
      setLocalCoverPreview(previewUrl);
      setCoverStage('member');
    }

    setDirectUploadTarget(folder);
    setDirectUploadProgress(6);

    try {
      const url = await uploadMediaFile(file, folder, currentUser.uid, (pct) => {
        setDirectUploadProgress(pct);
      });
      const updated = await updateUserProfile(
        currentUser.uid,
        member.usernameLower,
        folder === 'avatars' ? { avatarUrl: url } : { coverUrl: url }
      );

      if (
        folder === 'avatars' &&
        firebaseUser &&
        url.startsWith('https://') &&
        url.length <= 1800
      ) {
        await updateProfile(firebaseUser, { photoURL: url }).catch(() => {});
      }

      setMember(updated);
      setAuthProfile(updated);
      playSound('upload-success');
      showToast({
        type: 'success',
        title: folder === 'avatars' ? 'Profile picture updated' : 'Cover photo updated',
      });
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Upload failed',
        description: formatUserFriendlyError(err),
      });
    } finally {
      if (folder === 'avatars') {
        URL.revokeObjectURL(previewUrl);
        setLocalAvatarPreview('');
      } else {
        URL.revokeObjectURL(previewUrl);
        setLocalCoverPreview('');
      }
      setDirectUploadTarget(null);
      setDirectUploadProgress(0);
    }
  };

  const handleFollowToggle = async () => {
    if (!currentUser) {
      onRequireAuth();
      return;
    }
    if (!member || followBusy) return;

    setFollowBusy(true);
    const nextFollowing = !following;
    const delta = nextFollowing ? 1 : -1;

    setFollowing(nextFollowing);
    setMember((prev) =>
      prev ? { ...prev, followersCount: Math.max(0, prev.followersCount + delta) } : prev
    );
    setAuthProfile((prev) =>
      prev ? { ...prev, followingCount: Math.max(0, prev.followingCount + delta) } : prev
    );

    try {
      if (nextFollowing) {
        await followUser(currentUser, member.uid);
        playSound('follow');
      } else {
        await unfollowUser(currentUser.uid, member.uid);
        playSound('unlike');
      }
    } catch {
      setFollowing(!nextFollowing);
      setMember((prev) =>
        prev ? { ...prev, followersCount: Math.max(0, prev.followersCount - delta) } : prev
      );
      setAuthProfile((prev) =>
        prev ? { ...prev, followingCount: Math.max(0, prev.followingCount - delta) } : prev
      );
      showToast({ type: 'error', title: 'Could not update follow status' });
    } finally {
      setFollowBusy(false);
    }
  };

  const handleSendFriendRequest = async () => {
    if (!currentUser) {
      onRequireAuth();
      return;
    }
    if (!member || friendBusy) return;
    setFriendBusy(true);
    try {
      const created = await sendFriendRequest(currentUser, member);
      setFriendRequest(created);
      playSound('follow');
      showToast({ type: 'success', title: `Friend request sent to ${member.fullName}` });
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Could not send friend request',
        description: formatUserFriendlyError(err),
      });
    } finally {
      setFriendBusy(false);
    }
  };

  const handleCancelOrUnfriend = async () => {
    if (!friendRequest || friendBusy) return;
    setFriendBusy(true);
    try {
      await cancelOrRemoveFriendRequest(friendRequest.id);
      const prevStatus = friendRequest.status;
      setFriendRequest(null);
      showToast({
        type: 'info',
        title: prevStatus === 'accepted' ? 'Removed from friends' : 'Friend request cancelled',
      });
    } catch {
      showToast({ type: 'error', title: 'Could not update friend status' });
    } finally {
      setFriendBusy(false);
    }
  };

  const handleRespondFriendRequest = async (decision: 'accepted' | 'declined') => {
    if (!currentUser || !friendRequest || friendBusy) return;
    setFriendBusy(true);
    try {
      await respondToFriendRequest(friendRequest, currentUser, decision);
      setFriendRequest((prev) => (prev ? { ...prev, status: decision } : null));
      playSound(decision === 'accepted' ? 'follow' : 'ui-tap');
      showToast({
        type: 'success',
        title: decision === 'accepted' ? 'Friend request accepted' : 'Friend request declined',
      });
    } catch {
      showToast({ type: 'error', title: 'Could not respond to friend request' });
    } finally {
      setFriendBusy(false);
    }
  };

  const handleBlockToggle = async () => {
    if (!currentUser || !privateSettings) return;
    setMoreMenuOpen(false);
    const currentList = privateSettings.blockedUserIds || [];
    const nextList = isBlocked
      ? currentList.filter((id) => id !== targetUserId)
      : [...currentList, targetUserId];
    try {
      const updated = await updateUserPrivateSettings(currentUser.uid, {
        blockedUserIds: nextList,
      });
      setPrivateSettings(updated);
      showToast({
        type: 'success',
        title: isBlocked ? 'Member unblocked' : 'Member blocked',
      });
    } catch {
      showToast({ type: 'error', title: 'Could not update block list' });
    }
  };

  const buildProfileShareUrl = (target: UserProfile): string =>
    typeof window !== 'undefined'
      ? `${getPublicAppUrl()}/?view=profile&uid=${encodeURIComponent(target.uid)}`
      : `@${target.username}`;

  const handleCopyProfileLink = async () => {
    setMoreMenuOpen(false);
    if (!member) return;
    const shareUrl = buildProfileShareUrl(member);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        showToast({ type: 'success', title: `Copied @${member.username} profile link` });
      } else {
        showToast({ type: 'info', title: `@${member.username}`, description: shareUrl });
      }
    } catch {
      showToast({ type: 'info', title: `@${member.username}`, description: shareUrl });
    }
  };

  const handleShareProfile = async () => {
    setMoreMenuOpen(false);
    if (!member) return;
    const shareUrl = buildProfileShareUrl(member);
    try {
      const outcome = await shareNativeContent({
        title: `${member.fullName} (@${member.username}) · Hostel Friend`,
        text: `Connect with ${member.fullName} (@${member.username}) on Hostel Friend`,
        url: shareUrl,
        dialogTitle: `Share @${member.username}'s Profile`,
      });
      if (outcome === 'shared') {
        playSound('ui-tap');
      } else if (outcome === 'unsupported') {
        await handleCopyProfileLink();
      }
    } catch {
      await handleCopyProfileLink();
    }
  };

  const handleSelectReaction = async (post: Post, nextReactionChoice: ReactionType | null) => {
    if (!currentUser) {
      onRequireAuth();
      return;
    }
    const prevReaction = userReactions.get(post.id) || null;
    const prevLikesCount = post.likesCount;
    const prevReactionCounts = post.reactionCounts;
    const optimistic = computeNextReactionState(post, prevReaction, nextReactionChoice);

    setUserReactions((prev) => {
      const next = new Map(prev);
      if (optimistic.nextReaction) next.set(post.id, optimistic.nextReaction);
      else next.delete(post.id);
      return next;
    });
    const applyPatch = (list: Post[]) =>
      list.map((p) =>
        p.id === post.id
          ? {
              ...p,
              likesCount: optimistic.nextLikesCount,
              reactionCounts: optimistic.nextReactionCounts,
            }
          : p
      );
    setPosts(applyPatch);
    setSavedPosts(applyPatch);

    try {
      const committed = await reactToPost(post, currentUser, optimistic.nextReaction);
      setUserReactions((prev) => {
        const next = new Map(prev);
        if (committed.nextReaction) next.set(post.id, committed.nextReaction);
        else next.delete(post.id);
        return next;
      });
      const applyCommitted = (list: Post[]) =>
        list.map((p) =>
          p.id === post.id
            ? {
                ...p,
                likesCount: committed.nextLikesCount,
                reactionCounts: committed.nextReactionCounts,
              }
            : p
        );
      setPosts(applyCommitted);
      setSavedPosts(applyCommitted);
      if (committed.legacyNotice) {
        showToast({
          type: 'info',
          title: 'Reaction saved as Like',
          description: committed.legacyNotice,
        });
      }
    } catch (err) {
      setUserReactions((prev) => {
        const next = new Map(prev);
        if (prevReaction) next.set(post.id, prevReaction);
        else next.delete(post.id);
        return next;
      });
      const rollback = (list: Post[]) =>
        list.map((p) =>
          p.id === post.id
            ? { ...p, likesCount: prevLikesCount, reactionCounts: prevReactionCounts }
            : p
        );
      setPosts(rollback);
      setSavedPosts(rollback);
      showToast({
        type: 'error',
        title: 'Could not update reaction',
        description: formatUserFriendlyError(err, 'Please try again.'),
      });
    }
  };

  const handleToggleSave = async (post: Post) => {
    if (!currentUser) {
      onRequireAuth();
      return;
    }
    const saved = savedIds.has(post.id);
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (saved) next.delete(post.id);
      else next.add(post.id);
      return next;
    });

    if (saved) {
      setSavedPosts((prev) => prev.filter((p) => p.id !== post.id));
    } else if (savedLoaded) {
      setSavedPosts((prev) => (prev.some((p) => p.id === post.id) ? prev : [post, ...prev]));
    }

    try {
      await toggleSavePost(post.id, currentUser.uid, saved);
    } catch {
      setSavedIds((prev) => {
        const next = new Set(prev);
        if (saved) next.add(post.id);
        else next.delete(post.id);
        return next;
      });
      if (saved && savedLoaded) {
        setSavedPosts((prev) => (prev.some((p) => p.id === post.id) ? prev : [post, ...prev]));
      } else if (!saved) {
        setSavedPosts((prev) => prev.filter((p) => p.id !== post.id));
      }
      showToast({ type: 'error', title: 'Could not update bookmark' });
    }
  };

  const handleDeletePost = async (post: Post) => {
    const isOwnerDelete = currentUser?.uid === post.authorId;
    try {
      await deletePost(post, isOwnerDelete);
      setPosts((prev) => prev.filter((p) => p.id !== post.id));
      setSavedPosts((prev) => prev.filter((p) => p.id !== post.id));
      if (isOwnerDelete) {
        setMember((prev) =>
          prev ? { ...prev, postsCount: Math.max(0, prev.postsCount - 1) } : prev
        );
        setAuthProfile((prev) =>
          prev ? { ...prev, postsCount: Math.max(0, prev.postsCount - 1) } : prev
        );
      }
      showToast({ type: 'success', title: 'Post deleted' });
    } catch {
      showToast({ type: 'error', title: 'Could not delete post' });
    }
  };

  const handleOpenMediaTile = (post: Post) => {
    if (onOpenPost) {
      onOpenPost(post.id);
      return;
    }
    setFallbackPreviewPost(post);
  };

  if (loading) {
    return <ProfilePageSkeleton />;
  }

  if (loadError) {
    return (
      <div className="glass-card rounded-2xl p-10 text-center space-y-4">
        <h1 className="font-display text-xl font-bold text-ink">Could not load profile</h1>
        <p className="text-sm text-ink-muted max-w-md mx-auto">{loadError}</p>
        <button
          type="button"
          onClick={() => void loadProfileData()}
          className="gold-gradient-btn min-h-[44px] px-5 py-2.5 rounded-xl text-xs font-bold inline-flex items-center gap-2"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Try Again</span>
        </button>
      </div>
    );
  }

  if (!member) {
    return (
      <div className="glass-card rounded-2xl p-12 text-center">
        <h1 className="font-display text-xl font-bold text-ink">Member not found</h1>
        <p className="mt-2 text-sm text-ink-muted">
          This profile may have been deleted or is unavailable.
        </p>
      </div>
    );
  }

  const displayedCoverSrc = localCoverPreview
    ? localCoverPreview
    : coverStage === 'member' && member.coverUrl
    ? member.coverUrl
    : coverStage === 'default'
    ? DEFAULT_COVER
    : '';

  const displayedAvatarSrc = localAvatarPreview || member.avatarUrl;
  const displayPostsCount = Math.max(member.postsCount, posts.length);

  return (
    <div className="space-y-6">
      {/* Profile Hero Header Card */}
      <section className="glass-card rounded-2xl overflow-hidden">
        {/* Cover Banner */}
        <div className="h-44 sm:h-60 md:h-64 bg-canvas-alt relative overflow-hidden">
          {displayedCoverSrc ? (
            <img
              src={displayedCoverSrc}
              alt={`${member.fullName} cover`}
              referrerPolicy="no-referrer"
              onError={() => {
                if (coverStage === 'member') setCoverStage('default');
                else setCoverStage('gradient');
              }}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-surface-hover via-surface to-canvas" />
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/25 to-black/25 pointer-events-none" />

          {directUploadTarget === 'covers' && (
            <div className="absolute inset-x-4 top-4 z-20 rounded-xl bg-black/80 border border-white/25 px-3.5 py-2.5 backdrop-blur-md">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-amber-300 font-semibold">Uploading cover photo...</span>
                <span className="font-mono text-white tabular-nums">{directUploadProgress}%</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-white/20 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-accent-deep to-accent-soft transition-all duration-150"
                  style={{ width: `${Math.max(6, directUploadProgress)}%` }}
                />
              </div>
            </div>
          )}

          {isOwnProfile && (
            <label
              aria-label={member.coverUrl ? 'Change Cover Photo' : 'Add Cover Photo'}
              className="cursor-pointer absolute bottom-3.5 right-3.5 z-20 min-h-[40px] px-3.5 py-2 rounded-xl bg-black/75 hover:bg-black border border-white/25 hover:border-amber-300 text-xs font-semibold text-white inline-flex items-center gap-2 backdrop-blur-md shadow-lg transition-colors"
            >
              <Camera className="w-3.5 h-3.5 text-amber-300" />
              <span>
                {directUploadTarget === 'covers'
                  ? `Uploading ${directUploadProgress}%`
                  : member.coverUrl
                  ? 'Change Cover Photo'
                  : 'Add Cover Photo'}
              </span>
              <input
                type="file"
                accept="image/jpeg, image/png, image/webp, image/gif"
                disabled={Boolean(directUploadTarget)}
                onChange={(e) => handleDirectMediaUpload(e, 'covers')}
                className="sr-only"
              />
            </label>
          )}
        </div>

        {/* Identity + Actions + Bio + Stats */}
        <div className="px-4 sm:px-7 pb-6 -mt-12 sm:-mt-14 relative z-10">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div className="flex items-end gap-4 min-w-0">
              <div className="relative rounded-full p-1 bg-surface ring-1 ring-accent/35 shrink-0">
                <Avatar
                  src={displayedAvatarSrc}
                  name={member.fullName}
                  size="xl"
                  className="sm:w-28 sm:h-28"
                />

                {directUploadTarget === 'avatars' && (
                  <div className="absolute inset-1 rounded-full bg-black/75 flex flex-col items-center justify-center text-white">
                    <Loader2 className="w-5 h-5 animate-spin text-amber-300" />
                    <span className="mt-1 font-mono text-[10px] font-bold text-white tabular-nums">
                      {directUploadProgress}%
                    </span>
                  </div>
                )}

                {isOwnProfile && (
                  <label
                    aria-label="Change Profile Picture"
                    title="Change Profile Picture"
                    className="cursor-pointer absolute bottom-0.5 right-0.5 w-9 h-9 rounded-full bg-gradient-to-br from-accent-soft to-accent-deep text-accent-fg border-2 border-surface flex items-center justify-center shadow-[0_2px_12px_rgba(245,197,66,0.45)] hover:scale-105 transition-transform"
                  >
                    <Camera className="w-4 h-4" />
                    <input
                      type="file"
                      accept="image/jpeg, image/png, image/webp, image/gif"
                      disabled={Boolean(directUploadTarget)}
                      onChange={(e) => handleDirectMediaUpload(e, 'avatars')}
                      className="sr-only"
                    />
                  </label>
                )}
              </div>

              <div className="pb-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="font-display text-xl sm:text-2xl font-bold text-ink leading-tight truncate">
                    {member.fullName}
                  </h1>
                  {isVerifiedBadge && (
                    <span
                      title="Verified email account"
                      aria-label="Verified email account"
                      className="inline-flex items-center text-accent shrink-0"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                    </span>
                  )}
                </div>
                <p className="text-sm text-ink-muted truncate">@{member.username}</p>
              </div>
            </div>

            {/* Action Cluster */}
            <div className="flex flex-wrap items-center gap-2">
              {isOwnProfile ? (
                <>
                  <button
                    type="button"
                    onClick={() => setEditOpen(true)}
                    className="gold-gradient-btn min-h-[42px] px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-2"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Edit Profile</span>
                  </button>

                  <label className="cursor-pointer min-h-[42px] px-3.5 py-2 rounded-xl text-xs font-semibold border border-hairline-strong bg-surface-2 text-ink hover:border-accent/50 hover:bg-hover-tint inline-flex items-center gap-2 transition-colors">
                    <Camera className="w-3.5 h-3.5 text-accent" />
                    <span>
                      {directUploadTarget === 'avatars'
                        ? `Uploading ${directUploadProgress}%`
                        : 'Change Profile Picture'}
                    </span>
                    <input
                      type="file"
                      accept="image/jpeg, image/png, image/webp, image/gif"
                      disabled={Boolean(directUploadTarget)}
                      onChange={(e) => handleDirectMediaUpload(e, 'avatars')}
                      className="sr-only"
                    />
                  </label>

                  {onNavigateSettings && (
                    <button
                      type="button"
                      onClick={onNavigateSettings}
                      className="min-h-[42px] px-3.5 py-2 rounded-xl text-xs font-semibold border border-hairline-strong bg-surface-2 text-ink hover:border-accent/50 hover:bg-hover-tint inline-flex items-center gap-2 transition-colors"
                    >
                      <Settings className="w-3.5 h-3.5 text-accent" />
                      <span>Account Settings</span>
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => void handleFollowToggle()}
                    disabled={followBusy}
                    className={`min-h-[42px] px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-2 transition-colors disabled:opacity-60 ${
                      following
                        ? 'border border-hairline-strong bg-surface-2 text-ink hover:border-accent/45 hover:bg-hover-tint'
                        : 'gold-gradient-btn'
                    }`}
                  >
                    {followBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : following ? (
                      <UserCheck className="w-3.5 h-3.5 text-accent" />
                    ) : (
                      <UserPlus className="w-3.5 h-3.5" />
                    )}
                    <span>{following ? 'Following' : 'Follow'}</span>
                  </button>

                  {currentUser && !isBlocked && (
                    <>
                      {friendRequest?.status === 'pending' &&
                      friendRequest.recipientId === currentUser.uid ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={friendBusy}
                            onClick={() => void handleRespondFriendRequest('accepted')}
                            className="gold-gradient-btn min-h-[42px] px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                          >
                            <UserCheck className="w-3.5 h-3.5" />
                            <span>Accept Friend</span>
                          </button>
                          <button
                            type="button"
                            disabled={friendBusy}
                            onClick={() => void handleRespondFriendRequest('declined')}
                            className="min-h-[42px] px-3 py-2 rounded-xl text-xs font-medium border border-hairline-strong text-ink-muted hover:text-ink disabled:opacity-50"
                          >
                            Decline
                          </button>
                        </div>
                      ) : friendRequest?.status === 'pending' &&
                        friendRequest.senderId === currentUser.uid ? (
                        <button
                          type="button"
                          disabled={friendBusy}
                          onClick={() => void handleCancelOrUnfriend()}
                          className="min-h-[42px] px-3.5 py-2 rounded-xl text-xs font-medium border border-accent/40 text-accent hover:bg-accent/10 inline-flex items-center gap-1.5 disabled:opacity-50"
                        >
                          <UserCheck className="w-3.5 h-3.5" />
                          <span>Requested</span>
                        </button>
                      ) : friendRequest?.status === 'accepted' ? (
                        <button
                          type="button"
                          disabled={friendBusy}
                          onClick={() => void handleCancelOrUnfriend()}
                          title="Tap to remove friend"
                          className="min-h-[42px] px-3.5 py-2 rounded-xl text-xs font-semibold border border-accent/40 bg-accent/10 text-accent hover:bg-accent/15 inline-flex items-center gap-1.5 disabled:opacity-50"
                        >
                          <Users className="w-3.5 h-3.5" />
                          <span>Friends</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={friendBusy}
                          onClick={() => void handleSendFriendRequest()}
                          className="min-h-[42px] px-3.5 py-2 rounded-xl text-xs font-medium border border-hairline-strong bg-surface-2 text-ink hover:border-accent/45 inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
                        >
                          <UserPlus className="w-3.5 h-3.5 text-accent" />
                          <span>Add Friend</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => onMessageUser(member)}
                        className="min-h-[42px] px-4 py-2 rounded-xl text-xs font-medium border border-hairline-strong bg-surface-2 text-ink hover:border-accent/45 inline-flex items-center gap-2 transition-colors"
                      >
                        <MessageSquare className="w-3.5 h-3.5 text-accent" />
                        <span>Message</span>
                      </button>
                    </>
                  )}

                  {/* More Options Menu */}
                  <div className="relative" ref={moreMenuRef}>
                    <button
                      type="button"
                      onClick={() => setMoreMenuOpen((prev) => !prev)}
                      aria-label="More profile options"
                      aria-expanded={moreMenuOpen}
                      className="min-w-[42px] min-h-[42px] rounded-xl border border-hairline-strong bg-surface-2 text-ink-muted hover:text-ink hover:border-accent/45 inline-flex items-center justify-center transition-colors"
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>

                    {moreMenuOpen && (
                      <div
                        role="menu"
                        className="absolute right-0 mt-2 w-52 rounded-xl glass-popover hf-popover-enter py-1.5 z-30"
                      >
                        {(isNativePlatform() ||
                          (typeof navigator !== 'undefined' &&
                            typeof navigator.share === 'function')) && (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => void handleShareProfile()}
                            className="w-full px-3.5 py-2.5 text-left text-xs font-medium text-ink hover:bg-hover-tint flex items-center gap-2.5 transition-colors"
                          >
                            <Share2 className="w-3.5 h-3.5 text-accent" />
                            <span>Share Profile</span>
                          </button>
                        )}

                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => void handleCopyProfileLink()}
                          className="w-full px-3.5 py-2.5 text-left text-xs font-medium text-ink hover:bg-hover-tint flex items-center gap-2.5 transition-colors"
                        >
                          <Copy className="w-3.5 h-3.5 text-accent" />
                          <span>Copy Profile Link</span>
                        </button>

                        {currentUser && (
                          <>
                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => void handleBlockToggle()}
                              className={`w-full px-3.5 py-2.5 text-left text-xs font-medium hover:bg-hover-tint flex items-center gap-2.5 transition-colors ${
                                isBlocked ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              <Ban className="w-3.5 h-3.5" />
                              <span>{isBlocked ? 'Unblock Member' : 'Block Member'}</span>
                            </button>

                            <button
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                setMoreMenuOpen(false);
                                setReportOpen(true);
                              }}
                              className="w-full px-3.5 py-2.5 text-left text-xs font-medium text-ink hover:bg-hover-tint flex items-center gap-2.5 transition-colors"
                            >
                              <Flag className="w-3.5 h-3.5 text-accent" />
                              <span>Report Member</span>
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {member.isSuspended && (
            <div className="mt-4 flex items-center gap-2 text-xs text-rose-400">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>This account is currently suspended by moderation.</span>
            </div>
          )}

          {member.bio && (
            <p className="mt-4 text-sm text-ink-2/90 leading-relaxed max-w-2xl whitespace-pre-wrap">
              {member.bio}
            </p>
          )}

          {/* Unboxed Metadata Line (Hostel + Joined Date) */}
          {(member.hostel || joinedLabel) && (
            <div className="mt-3.5 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-muted">
              {member.hostel && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-accent shrink-0" />
                  <span>{member.hostel}</span>
                </span>
              )}
              {joinedLabel && (
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-accent shrink-0" />
                  <span>Joined {joinedLabel}</span>
                </span>
              )}
            </div>
          )}

          {/* Real Profile Statistics */}
          <div className="mt-5 pt-4 border-t border-hairline grid grid-cols-3 gap-4 max-w-md">
            <button
              type="button"
              onClick={() => setActiveTab('posts')}
              title={`${displayPostsCount} Posts`}
              className="text-left group focus:outline-none"
            >
              <span className="block font-display text-lg sm:text-xl font-bold text-ink group-hover:text-accent transition-colors tabular-nums">
                {formatCount(displayPostsCount)}
              </span>
              <span className="block text-[11px] uppercase tracking-wider text-ink-muted">
                Posts
              </span>
            </button>

            <div title={`${member.followersCount} Followers`}>
              <span className="block font-display text-lg sm:text-xl font-bold text-ink tabular-nums">
                {formatCount(member.followersCount)}
              </span>
              <span className="block text-[11px] uppercase tracking-wider text-ink-muted">
                Followers
              </span>
            </div>

            <div title={`${member.followingCount} Following`}>
              <span className="block font-display text-lg sm:text-xl font-bold text-ink tabular-nums">
                {formatCount(member.followingCount)}
              </span>
              <span className="block text-[11px] uppercase tracking-wider text-ink-muted">
                Following
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Profile Content Tabs */}
      <nav
        aria-label="Profile sections"
        role="tablist"
        className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar border-b border-hairline pb-3"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'posts'}
          onClick={() => setActiveTab('posts')}
          className={`min-h-[42px] px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap inline-flex items-center gap-2 transition-colors ${
            activeTab === 'posts'
              ? 'bg-accent text-accent-fg'
              : 'text-ink-muted hover:text-ink hover:bg-hover-tint'
          }`}
        >
          <Grid className="w-3.5 h-3.5" />
          <span>Posts</span>
          <span className="font-mono text-[11px] opacity-80 tabular-nums">{posts.length}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'photos'}
          onClick={() => setActiveTab('photos')}
          className={`min-h-[42px] px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap inline-flex items-center gap-2 transition-colors ${
            activeTab === 'photos'
              ? 'bg-accent text-accent-fg'
              : 'text-ink-muted hover:text-ink hover:bg-hover-tint'
          }`}
        >
          <ImageIcon className="w-3.5 h-3.5" />
          <span>Photos</span>
          <span className="font-mono text-[11px] opacity-80 tabular-nums">{photoPosts.length}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'videos'}
          onClick={() => setActiveTab('videos')}
          className={`min-h-[42px] px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap inline-flex items-center gap-2 transition-colors ${
            activeTab === 'videos'
              ? 'bg-accent text-accent-fg'
              : 'text-ink-muted hover:text-ink hover:bg-hover-tint'
          }`}
        >
          <Film className="w-3.5 h-3.5" />
          <span>Videos</span>
          <span className="font-mono text-[11px] opacity-80 tabular-nums">{videoPosts.length}</span>
        </button>

        {isOwnProfile && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'saved'}
            onClick={() => setActiveTab('saved')}
            className={`min-h-[42px] px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap inline-flex items-center gap-2 transition-colors ${
              activeTab === 'saved'
                ? 'bg-accent text-accent-fg'
                : 'text-ink-muted hover:text-ink hover:bg-hover-tint'
            }`}
          >
            <Bookmark className="w-3.5 h-3.5" />
            <span>Saved Posts</span>
            <span className="font-mono text-[11px] opacity-80 tabular-nums">{savedIds.size}</span>
          </button>
        )}

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'about'}
          onClick={() => setActiveTab('about')}
          className={`min-h-[42px] px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap inline-flex items-center gap-2 transition-colors ${
            activeTab === 'about'
              ? 'bg-accent text-accent-fg'
              : 'text-ink-muted hover:text-ink hover:bg-hover-tint'
          }`}
        >
          <Info className="w-3.5 h-3.5" />
          <span>About</span>
        </button>
      </nav>

      {/* Active Tab Body */}
      {isBlocked && activeTab !== 'about' ? (
        <div className="glass-card rounded-2xl p-10 text-center space-y-3">
          <Ban className="w-6 h-6 text-rose-400 mx-auto" />
          <p className="text-sm text-ink-muted">
            You have blocked @{member.username}. Unblock them to view their posts and media.
          </p>
        </div>
      ) : activeTab === 'posts' ? (
        posts.filter((p) => !isLegacyPollPost(p)).length === 0 ? (
          <div className="glass-card rounded-2xl p-10 text-center">
            <Grid className="w-7 h-7 text-accent/75 mx-auto mb-3" />
            <p className="font-display text-base font-semibold text-ink">No posts yet</p>
            <p className="mt-1 text-xs text-ink-muted">
              {isOwnProfile
                ? 'Share a photo, video, or hostel update with your campus friends.'
                : `Posts shared by @${member.username} will appear here.`}
            </p>
          </div>
        ) : (
          <div className="max-w-2xl space-y-6">
            {posts
              .filter((p) => !isLegacyPollPost(p))
              .map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  currentUser={currentUser}
                  isAdmin={isAdmin}
                  userReaction={userReactions.get(post.id) || null}
                  isSaved={savedIds.has(post.id)}
                  onSelectReaction={handleSelectReaction}
                  onToggleSave={handleToggleSave}
                  onDeletePost={handleDeletePost}
                  onOpenProfile={onOpenProfile}
                  onSearchHashtag={onSearchHashtag}
                  onRequireAuth={onRequireAuth}
                  variant="feed"
                />
              ))}
          </div>
        )
      ) : activeTab === 'photos' ? (
        photoPosts.length === 0 ? (
          <div className="glass-card rounded-2xl p-10 text-center">
            <ImageIcon className="w-7 h-7 text-accent/75 mx-auto mb-3" />
            <p className="font-display text-base font-semibold text-ink">No photos yet</p>
            <p className="mt-1 text-xs text-ink-muted">
              Photographs posted by @{member.username} will show in this gallery.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3.5">
            {photoPosts.map((post) => (
              <MediaTile key={post.id} post={post} type="photo" onOpen={handleOpenMediaTile} />
            ))}
          </div>
        )
      ) : activeTab === 'videos' ? (
        videoPosts.length === 0 ? (
          <div className="glass-card rounded-2xl p-10 text-center">
            <Film className="w-7 h-7 text-accent/75 mx-auto mb-3" />
            <p className="font-display text-base font-semibold text-ink">No videos yet</p>
            <p className="mt-1 text-xs text-ink-muted">
              Videos shared by @{member.username} will appear here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3.5">
            {videoPosts.map((post) => (
              <MediaTile key={post.id} post={post} type="video" onOpen={handleOpenMediaTile} />
            ))}
          </div>
        )
      ) : activeTab === 'saved' && isOwnProfile ? (
        savedLoading ? (
          <div className="glass-card rounded-2xl p-10 text-center">
            <Loader2 className="w-6 h-6 text-accent animate-spin mx-auto mb-2.5" />
            <p className="text-xs text-ink-muted">Loading your saved posts...</p>
          </div>
        ) : savedPosts.length === 0 ? (
          <div className="glass-card rounded-2xl p-10 text-center">
            <Bookmark className="w-7 h-7 text-accent/75 mx-auto mb-3" />
            <p className="font-display text-base font-semibold text-ink">No saved posts yet</p>
            <p className="mt-1 text-xs text-ink-muted">
              Bookmark posts from the feed to keep them handy here.
            </p>
          </div>
        ) : (
          <div className="max-w-2xl space-y-6">
            {savedPosts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                currentUser={currentUser}
                isAdmin={isAdmin}
                userReaction={userReactions.get(post.id) || null}
                isSaved={savedIds.has(post.id)}
                onSelectReaction={handleSelectReaction}
                onToggleSave={handleToggleSave}
                onDeletePost={handleDeletePost}
                onOpenProfile={onOpenProfile}
                onSearchHashtag={onSearchHashtag}
                onRequireAuth={onRequireAuth}
                variant="feed"
              />
            ))}
          </div>
        )
      ) : (
        /* About Tab — strictly backed by real Firestore profile fields */
        <section className="glass-card rounded-2xl p-5 sm:p-6 max-w-2xl space-y-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-base font-bold text-ink">About @{member.username}</h2>
            {isOwnProfile && (
              <button
                type="button"
                onClick={() => setEditOpen(true)}
                className="text-xs font-semibold text-accent hover:underline inline-flex items-center gap-1"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Edit Details</span>
              </button>
            )}
          </div>

          <dl className="divide-y divide-hairline text-sm">
            <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <dt className="text-xs uppercase tracking-wider text-ink-subtle">Full Name</dt>
              <dd className="text-ink font-medium flex items-center gap-1.5">
                <span>{member.fullName}</span>
                {isVerifiedBadge && <CheckCircle2 className="w-3.5 h-3.5 text-accent" />}
              </dd>
            </div>

            <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <dt className="text-xs uppercase tracking-wider text-ink-subtle">Username</dt>
              <dd className="font-mono text-xs text-accent">@{member.username}</dd>
            </div>

            {member.hostel && (
              <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <dt className="text-xs uppercase tracking-wider text-ink-subtle">
                  Hostel / Institution
                </dt>
                <dd className="text-ink">{member.hostel}</dd>
              </div>
            )}

            {member.bio && (
              <div className="py-3 space-y-1">
                <dt className="text-xs uppercase tracking-wider text-ink-subtle">Bio</dt>
                <dd className="text-ink-2/90 leading-relaxed whitespace-pre-wrap">{member.bio}</dd>
              </div>
            )}

            {joinedLabel && (
              <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <dt className="text-xs uppercase tracking-wider text-ink-subtle">Joined</dt>
                <dd className="text-ink">{joinedLabel}</dd>
              </div>
            )}

            <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <dt className="text-xs uppercase tracking-wider text-ink-subtle">Activity</dt>
              <dd className="font-mono text-xs text-ink-muted tabular-nums">
                {displayPostsCount} posts · {member.followersCount} followers · {member.followingCount}{' '}
                following
              </dd>
            </div>

            {isOwnProfile && firebaseUser && (
              <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                <dt className="text-xs uppercase tracking-wider text-ink-subtle">
                  Email Verification
                </dt>
                <dd className="text-xs font-medium text-ink">
                  {firebaseUser.emailVerified ? 'Verified' : 'Unverified'}
                </dd>
              </div>
            )}
          </dl>

          {isOwnProfile && onNavigateSettings && (
            <div className="pt-2 border-t border-hairline flex items-center justify-between gap-3">
              <p className="text-xs text-ink-muted">
                Manage privacy, push notifications, and blocked members in Account Settings.
              </p>
              <button
                type="button"
                onClick={onNavigateSettings}
                className="shrink-0 min-h-[38px] px-3.5 py-2 rounded-xl text-xs font-semibold border border-hairline-strong text-ink hover:border-accent/45 inline-flex items-center gap-1.5"
              >
                <Settings className="w-3.5 h-3.5 text-accent" />
                <span>Settings</span>
              </button>
            </div>
          )}
        </section>
      )}

      {/* Edit Profile Modal (Owner Only) */}
      {isOwnProfile && (
        <EditProfileModal
          open={editOpen}
          member={member}
          onClose={() => setEditOpen(false)}
          onUpdated={(updated) => setMember(updated)}
        />
      )}

      {/* Report Member Modal */}
      {currentUser && !isOwnProfile && (
        <ReportModal
          open={reportOpen}
          reporterId={currentUser.uid}
          targetType="user"
          targetId={member.uid}
          targetAuthorId={member.uid}
          targetLabel={`@${member.username}`}
          onClose={() => setReportOpen(false)}
        />
      )}

      {/* Lightweight Media Lightbox Fallback (e.g., Guest mode without PostDetailModal) */}
      {fallbackPreviewPost && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setFallbackPreviewPost(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl rounded-2xl glass-modal hf-modal-enter overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-hairline flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink truncate">
                  {fallbackPreviewPost.authorName}
                </p>
                <p className="text-[11px] text-ink-muted">
                  {formatRelativeTime(fallbackPreviewPost.createdAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFallbackPreviewPost(null)}
                aria-label="Close media preview"
                className="min-w-[38px] min-h-[38px] rounded-full flex items-center justify-center text-ink-muted hover:text-ink hover:bg-hover-tint"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-black flex items-center justify-center max-h-[70vh]">
              {fallbackPreviewPost.mediaType === 'video' ? (
                <video
                  src={fallbackPreviewPost.mediaUrl}
                  controls
                  playsInline
                  autoPlay
                  className="max-h-[70vh] w-full object-contain"
                />
              ) : (
                <img
                  src={fallbackPreviewPost.mediaUrl}
                  alt={fallbackPreviewPost.caption || 'Member post'}
                  referrerPolicy="no-referrer"
                  className="max-h-[70vh] w-full object-contain"
                />
              )}
            </div>

            {fallbackPreviewPost.caption && (
              <div className="px-4 py-3 border-t border-hairline">
                <p className="text-sm text-ink-2/90 leading-relaxed">
                  {fallbackPreviewPost.caption}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
