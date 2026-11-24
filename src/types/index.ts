import { Timestamp } from 'firebase/firestore';

export type AppView =
  | 'landing'
  | 'auth'
  | 'feed'
  | 'explore'
  | 'trends'
  | 'moments'
  | 'messages'
  | 'notifications'
  | 'create'
  | 'profile'
  | 'settings'
  | 'admin';

export type MediaType = 'image' | 'video' | 'text';
export type AspectRatioType = 'square' | 'landscape' | 'portrait' | 'vertical';
export type FeedTab = 'for-you' | 'following' | 'latest';

export interface UserProfile {
  uid: string;
  username: string;
  usernameLower: string;
  fullName: string;
  bio: string;
  hostel: string;
  avatarUrl: string;
  coverUrl: string;
  followersCount: number;
  followingCount: number;
  postsCount: number;
  isSuspended: boolean;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface StoryItem {
  id: string;
  authorId: string;
  authorUsername: string;
  authorName: string;
  authorAvatarUrl: string;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  caption: string;
  visibility: 'public';
  likesCount?: number;
  createdAt: Timestamp | null;
  expiresAt: Timestamp | null;
}

export interface StoryLike {
  id: string;
  storyId: string;
  storyAuthorId: string;
  userId: string;
  userUsername: string;
  userName: string;
  userAvatarUrl: string;
  createdAt: Timestamp | null;
}

export interface Poll {
  id: string;
  authorId: string;
  authorUsername: string;
  authorName: string;
  authorAvatarUrl: string;
  question: string;
  options: string[];
  count0: number;
  count1: number;
  count2: number;
  count3: number;
  count4: number;
  count5: number;
  totalVotes: number;
  visibility: 'public';
  storageMode?: 'polls' | 'legacy-post';
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface PollVote {
  id: string;
  pollId: string;
  userId: string;
  optionIndex: number;
  createdAt: Timestamp | null;
}

export interface UserPrivateSettings {
  uid: string;
  email: string;
  privacyMode: 'public' | 'followers';
  notifyLikes: boolean;
  notifyComments: boolean;
  notifyFollows: boolean;
  notifyMessages: boolean;
  blockedUserIds: string[];
  updatedAt: Timestamp | null;
}

export type ReactionType = 'like' | 'love' | 'haha' | 'wow' | 'sad' | 'care';

export type ReactionCounts = Partial<Record<ReactionType, number>>;

export interface PostReaction {
  id: string;
  postId: string;
  userId: string;
  reactionType: ReactionType;
  userUsername?: string;
  userName?: string;
  userAvatarUrl?: string;
  createdAt: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface Post {
  id: string;
  authorId: string;
  authorUsername: string;
  authorName: string;
  authorAvatarUrl: string;
  mediaUrl: string;
  thumbnailUrl?: string;
  mediaType: MediaType;
  aspectRatio: AspectRatioType;
  caption: string;
  hashtags: string[];
  visibility: 'public';
  likesCount: number;
  reactionCounts?: ReactionCounts;
  commentsCount: number;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface CommentItem {
  id: string;
  postId: string;
  postAuthorId: string;
  authorId: string;
  authorUsername: string;
  authorName: string;
  authorAvatarUrl: string;
  text: string;
  parentCommentId?: string;
  replyToUserId?: string;
  replyToUsername?: string;
  isPublic: boolean;
  createdAt: Timestamp | null;
}

export type NotificationType =
  | 'NEW_MESSAGE'
  | 'POST_LIKE'
  | 'POST_COMMENT'
  | 'COMMENT_REPLY'
  | 'NEW_FOLLOWER'
  | 'FRIEND_REQUEST'
  | 'FRIEND_REQUEST_ACCEPTED'
  | 'USER_MENTION'
  | 'IMPORTANT_APP_ANNOUNCEMENT'
  | 'like'
  | 'comment'
  | 'follow'
  | 'mention'
  | 'system';

export interface NotificationItem {
  id: string;
  recipientId: string;
  actorId: string;
  senderId?: string;
  actorUsername: string;
  actorName: string;
  actorAvatarUrl: string;
  type: NotificationType;
  title?: string;
  body?: string;
  postId: string;
  relatedPostId?: string;
  relatedCommentId?: string;
  relatedConversationId?: string;
  relatedMessageId?: string;
  relatedRequestId?: string;
  actionUrl?: string;
  message: string;
  isRead: boolean;
  createdAt: Timestamp | null;
}

export interface FriendRequest {
  id: string;
  senderId: string;
  senderUsername: string;
  senderName: string;
  senderAvatarUrl: string;
  recipientId: string;
  recipientUsername: string;
  recipientName: string;
  recipientAvatarUrl: string;
  participantIds: string[];
  status: 'pending' | 'accepted' | 'declined';
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface NotificationPreferences {
  uid: string;
  messages: boolean;
  likes: boolean;
  comments: boolean;
  commentReplies: boolean;
  follows: boolean;
  friendRequests: boolean;
  mentions: boolean;
  announcements: boolean;
  pushEnabled: boolean;
  updatedAt: Timestamp | null;
}

export interface FcmTokenRecord {
  id: string;
  uid: string;
  token: string;
  platform: 'web' | 'android-pwa' | 'ios-pwa';
  userAgent: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface Conversation {
  id: string;
  participantIds: string[];
  participantAId: string;
  participantBId: string;
  participantAUsername: string;
  participantAName: string;
  participantAAvatar: string;
  participantBUsername: string;
  participantBName: string;
  participantBAvatar: string;
  lastMessageText: string;
  lastMessageSenderId: string;
  unreadByA: number;
  unreadByB: number;
  typingAAt?: Timestamp | null;
  typingBAt?: Timestamp | null;
  lastMessageAt: Timestamp | null;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  participantIds: string[];
  senderId: string;
  recipientId: string;
  text: string;
  isRead: boolean;
  readAt?: Timestamp | null;
  createdAt: Timestamp | null;
}

export interface ModerationReport {
  id: string;
  reporterId: string;
  targetType: 'post' | 'user' | 'comment';
  targetId: string;
  targetAuthorId: string;
  reason: string;
  details: string;
  status: 'open' | 'resolved' | 'dismissed';
  reviewedBy: string;
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export interface PlatformSettings {
  maxUploadSizeMB: number;
  allowNewRegistrations: boolean;
  maintenanceNotice: string;
  featuredHashtags: string[];
  updatedBy: string;
  updatedAt: Timestamp | null;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  description?: string;
}
