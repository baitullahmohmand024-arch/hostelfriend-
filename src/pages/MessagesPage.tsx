import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, CheckCheck, MessageSquare, Search, Send } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { ChatMessage, Conversation, UserProfile } from '../types';
import {
  getOrCreateConversation,
  markConversationRead,
  sendMessage,
  setConversationTyping,
  subscribeConversations,
  subscribeMessages,
} from '../services/socialService';
import { fetchDiscoverMembers } from '../services/userService';
import { Avatar } from '../components/Avatar';
import { formatRelativeTime } from '../utils/formatters';
import { playSound } from '../utils/soundVfx';

interface MessagesPageProps {
  initialTargetUser?: UserProfile | null;
  initialConversationId?: string | null;
  onClearInitialTarget?: () => void;
  onClearInitialConversation?: () => void;
  onOpenProfile: (userId: string) => void;
}

export function MessagesPage({
  initialTargetUser,
  initialConversationId,
  onClearInitialTarget,
  onClearInitialConversation,
  onOpenProfile,
}: MessagesPageProps) {
  const { profile, privateSettings } = useAuth();
  const { showToast } = useToast();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [allMembers, setAllMembers] = useState<UserProfile[]>([]);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef<number | null>(null);
  const markingReadIdsRef = useRef<Set<string>>(new Set());
  const latestMessagesRef = useRef<ChatMessage[]>([]);

const TYPING_TTL_MS = 8000;
const TYPING_IDLE_MS = 3500;
const TYPING_HEARTBEAT_MS = 3000;

function isOtherTypingInConv(conv: Conversation, myUid: string | undefined, nowMs: number): boolean {
  if (!myUid) return false;
  const isA = conv.participantAId === myUid;
  const otherUid = isA ? conv.participantBId : conv.participantAId;
  const otherTypingTs = isA ? conv.typingBAt : conv.typingAAt;
  if (!otherTypingTs) return false;
  const typingMs = otherTypingTs.toMillis();
  if (nowMs - typingMs > TYPING_TTL_MS) return false;
  if (
    conv.lastMessageSenderId === otherUid &&
    conv.lastMessageAt &&
    conv.lastMessageAt.toMillis() > typingMs
  ) {
    return false;
  }
  return true;
}

  const [nowMs, setNowMs] = useState(() => Date.now());
  const typingActiveRef = useRef(false);
  const lastTypingSentAtRef = useRef(0);
  const typingIdleTimerRef = useRef<number | null>(null);

  const selectedConvId = selectedConv?.id || null;
  const activeConversation = useMemo(
    () =>
      selectedConvId
        ? conversations.find((c) => c.id === selectedConvId) || selectedConv
        : null,
    [conversations, selectedConv, selectedConvId]
  );
  const activeConversationRef = useRef<Conversation | null>(activeConversation);
  activeConversationRef.current = activeConversation;

  const blockedSet = useMemo(
    () => new Set(privateSettings?.blockedUserIds || []),
    [privateSettings]
  );

  const clearMyTyping = useCallback(
    (targetConv?: Conversation | null) => {
      if (typingIdleTimerRef.current !== null) {
        window.clearTimeout(typingIdleTimerRef.current);
        typingIdleTimerRef.current = null;
      }
      const conv = targetConv ?? activeConversationRef.current;
      if (typingActiveRef.current && conv && profile) {
        typingActiveRef.current = false;
        lastTypingSentAtRef.current = 0;
        void setConversationTyping(conv, profile.uid, false);
      } else {
        typingActiveRef.current = false;
      }
    },
    [profile]
  );

  // Load conversations list in real time
  useEffect(() => {
    if (!profile) return;
    setLoadingConvs(true);
    const unsub = subscribeConversations(profile.uid, (list) => {
      setConversations(list);
      setLoadingConvs(false);
    });
    fetchDiscoverMembers(40)
      .then((m) => setAllMembers(m.filter((u) => u.uid !== profile.uid)))
      .catch(() => {});
    return () => unsub();
  }, [profile]);

  // Open target user conversation if navigated from a Profile
  useEffect(() => {
    if (!profile || !initialTargetUser) return;
    if (blockedSet.has(initialTargetUser.uid)) {
      showToast({ type: 'error', title: 'Cannot message a blocked member' });
      onClearInitialTarget?.();
      return;
    }
    getOrCreateConversation(profile, initialTargetUser)
      .then((conv) => {
        setSelectedConv(conv);
        onClearInitialTarget?.();
      })
      .catch(() => {
        showToast({ type: 'error', title: 'Could not start conversation' });
      });
  }, [profile, initialTargetUser, blockedSet, onClearInitialTarget, showToast]);

  // Open specific conversation when navigated from a NEW_MESSAGE notification
  useEffect(() => {
    if (!initialConversationId || conversations.length === 0) return;
    const match = conversations.find((c) => c.id === initialConversationId);
    if (match) {
      setSelectedConv(match);
      onClearInitialConversation?.();
    }
  }, [initialConversationId, conversations, onClearInitialConversation]);

  const syncReadReceipts = useCallback(
    (msgs: ChatMessage[]) => {
      const conv = activeConversationRef.current;
      if (!profile || !conv) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

      const pendingUnread = msgs.filter(
        (m) =>
          m.recipientId === profile.uid && !m.isRead && !markingReadIdsRef.current.has(m.id)
      );
      const isA = conv.participantAId === profile.uid;
      const unreadCount = isA ? conv.unreadByA : conv.unreadByB;

      if (pendingUnread.length === 0 && unreadCount <= 0) return;

      pendingUnread.forEach((m) => markingReadIdsRef.current.add(m.id));
      markConversationRead(conv, profile.uid, pendingUnread).catch(() => {
        pendingUnread.forEach((m) => markingReadIdsRef.current.delete(m.id));
      });
    },
    [profile]
  );

  // Subscribe to messages for selected conversation
  useEffect(() => {
    markingReadIdsRef.current.clear();
    latestMessagesRef.current = [];
    if (!profile || !selectedConvId) {
      setMessages([]);
      prevMsgCountRef.current = null;
      return;
    }
    prevMsgCountRef.current = null;
    if (activeConversationRef.current) {
      syncReadReceipts([]);
    }
    const unsub = subscribeMessages(selectedConvId, profile.uid, (msgs) => {
      latestMessagesRef.current = msgs;
      setMessages(msgs);
      if (
        prevMsgCountRef.current !== null &&
        msgs.length > prevMsgCountRef.current &&
        msgs[msgs.length - 1]?.senderId !== profile.uid
      ) {
        playSound('message');
      }
      prevMsgCountRef.current = msgs.length;
      syncReadReceipts(msgs);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
    });

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        syncReadReceipts(latestMessagesRef.current);
      } else {
        clearMyTyping();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    return () => {
      unsub();
      clearMyTyping();
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
    };
  }, [profile, selectedConvId, syncReadReceipts, clearMyTyping]);

  // Keep conversation unread counter cleared when new messages arrive in the active thread
  useEffect(() => {
    if (!activeConversation) return;
    syncReadReceipts(latestMessagesRef.current);
  }, [
    activeConversation,
    activeConversation?.unreadByA,
    activeConversation?.unreadByB,
    syncReadReceipts,
  ]);

  // Lightweight expiry ticker while any conversation has a recent typing timestamp
  const hasAnyActiveTyping = useMemo(() => {
    if (!profile) return false;
    return conversations.some((conv) => isOtherTypingInConv(conv, profile.uid, nowMs));
  }, [conversations, profile, nowMs]);

  useEffect(() => {
    if (!hasAnyActiveTyping) return;
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, [hasAnyActiveTyping]);

  useEffect(() => {
    setNowMs(Date.now());
  }, [conversations]);

  const getOtherParticipant = (conv: Conversation) => {
    if (!profile) {
      return {
        uid: conv.participantBId,
        name: conv.participantBName,
        username: conv.participantBUsername,
        avatar: conv.participantBAvatar,
        unread: 0,
      };
    }
    const isA = conv.participantAId === profile.uid;
    return {
      uid: isA ? conv.participantBId : conv.participantAId,
      name: isA ? conv.participantBName : conv.participantAName,
      username: isA ? conv.participantBUsername : conv.participantAUsername,
      avatar: isA ? conv.participantBAvatar : conv.participantAAvatar,
      unread: isA ? conv.unreadByA : conv.unreadByB,
    };
  };

  const handleStartChatWithMember = async (member: UserProfile) => {
    if (!profile) return;
    try {
      const conv = await getOrCreateConversation(profile, member);
      setSelectedConv(conv);
      setMemberSearch('');
    } catch {
      showToast({ type: 'error', title: 'Could not open conversation' });
    }
  };

  const handleMessageInputChange = (nextValue: string) => {
    setMessageText(nextValue);
    const conv = activeConversationRef.current;
    if (!profile || !conv) return;

    if (!nextValue.trim()) {
      clearMyTyping(conv);
      return;
    }

    const now = Date.now();
    if (!typingActiveRef.current || now - lastTypingSentAtRef.current >= TYPING_HEARTBEAT_MS) {
      typingActiveRef.current = true;
      lastTypingSentAtRef.current = now;
      void setConversationTyping(conv, profile.uid, true);
    }

    if (typingIdleTimerRef.current !== null) {
      window.clearTimeout(typingIdleTimerRef.current);
    }
    typingIdleTimerRef.current = window.setTimeout(() => {
      clearMyTyping(conv);
    }, TYPING_IDLE_MS);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !selectedConv || !messageText.trim() || sending) return;
    const other = getOtherParticipant(selectedConv);
    if (blockedSet.has(other.uid)) {
      showToast({ type: 'error', title: 'Unblock this member before sending messages' });
      return;
    }
    clearMyTyping(selectedConv);
    setSending(true);
    const outgoing = messageText;
    setMessageText('');
    try {
      await sendMessage(selectedConv, profile.uid, outgoing, profile);
      playSound('message-sent');
    } catch {
      setMessageText(outgoing);
      showToast({ type: 'error', title: 'Failed to send message' });
    } finally {
      setSending(false);
    }
  };

  const matchingMembers = memberSearch.trim()
    ? allMembers
        .filter((m) => !blockedSet.has(m.uid))
        .filter(
          (m) =>
            m.usernameLower.includes(memberSearch.trim().toLowerCase().replace(/^@/, '')) ||
            m.fullName.toLowerCase().includes(memberSearch.trim().toLowerCase())
        )
        .slice(0, 5)
    : [];

  const activeOther = activeConversation ? getOtherParticipant(activeConversation) : null;
  const isActiveOtherTyping = activeConversation
    ? isOtherTypingInConv(activeConversation, profile?.uid, nowMs)
    : false;

  useEffect(() => {
    if (isActiveOtherTyping) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
    }
  }, [isActiveOtherTyping]);

  const { lastMyMessageId, lastSeenMessageId } = useMemo(() => {
    let lastMine = '';
    let lastSeen = '';
    for (const msg of messages) {
      if (msg.senderId === profile?.uid) {
        lastMine = msg.id;
        if (msg.isRead) {
          lastSeen = msg.id;
        }
      }
    }
    return { lastMyMessageId: lastMine, lastSeenMessageId: lastSeen };
  }, [messages, profile?.uid]);

  return (
    <div className="glass-card rounded-2xl overflow-hidden h-[calc(100vh-11rem)] md:h-[calc(100vh-5rem)] grid grid-cols-1 md:grid-cols-12">
      {/* Left Conversation List */}
      <div
        className={`md:col-span-4 border-r border-hairline flex flex-col min-h-0 ${
          selectedConv ? 'hidden md:flex' : 'flex'
        }`}
      >
        <div className="p-4 border-b border-hairline space-y-3">
          <h1 className="font-display text-lg font-bold text-ink-2">Messages</h1>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-ink-subtle absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              placeholder="Start chat with @member..."
              className="w-full rounded-xl bg-canvas-alt border border-hairline pl-9 pr-3 py-2 text-xs text-ink-2 placeholder:text-ink-subtle focus:outline-none focus:border-accent-strong"
            />
          </div>

          {matchingMembers.length > 0 && (
            <div className="rounded-xl glass-popover hf-popover-enter divide-y divide-hairline overflow-hidden">
              {matchingMembers.map((m) => (
                <button
                  key={m.uid}
                  type="button"
                  onClick={() => handleStartChatWithMember(m)}
                  className="w-full px-3 py-2.5 text-left flex items-center gap-2.5 hover:bg-hover-tint"
                >
                  <Avatar src={m.avatarUrl} name={m.fullName} size="xs" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-ink-2 truncate">{m.fullName}</p>
                    <p className="text-[11px] text-ink-muted truncate">@{m.username}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-white/[0.05]">
          {loadingConvs ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 rounded-xl bg-hover-tint animate-pulse" />
              ))}
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-8 text-center">
              <MessageSquare className="w-7 h-7 text-accent-strong mx-auto" />
              <p className="mt-3 text-xs font-medium text-ink-2">No conversations yet</p>
              <p className="mt-1 text-[11px] text-ink-subtle">
                Search for a hostel member above or tap Message on their profile.
              </p>
            </div>
          ) : (
            conversations.map((conv) => {
              const other = getOtherParticipant(conv);
              const isSelected = selectedConv?.id === conv.id;
              const isTyping = isOtherTypingInConv(conv, profile?.uid, nowMs);
              return (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => setSelectedConv(conv)}
                  className={`w-full px-4 py-3.5 text-left flex items-center gap-3 hf-press ${
                    isSelected ? 'bg-accent-strong/12' : 'hover:bg-hover-tint'
                  }`}
                >
                  <Avatar src={other.avatar} name={other.name} size="md" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-ink-2 truncate">{other.name}</p>
                      <span className="text-[11px] text-ink-subtle shrink-0">
                        {formatRelativeTime(conv.lastMessageAt)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      {isTyping ? (
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="inline-flex items-center gap-0.5 shrink-0" aria-hidden="true">
                            <span className="w-1 h-1 rounded-full bg-accent animate-bounce [animation-delay:0ms]" />
                            <span className="w-1 h-1 rounded-full bg-accent animate-bounce [animation-delay:150ms]" />
                            <span className="w-1 h-1 rounded-full bg-accent animate-bounce [animation-delay:300ms]" />
                          </span>
                          <p className="text-xs font-medium text-accent truncate">typing...</p>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 min-w-0">
                          {conv.lastMessageText && profile && conv.lastMessageSenderId === profile.uid && (
                            (conv.participantAId === profile.uid ? conv.unreadByB : conv.unreadByA) === 0 ? (
                              <CheckCheck
                                className="w-3.5 h-3.5 text-accent-strong shrink-0"
                                aria-label="Seen"
                              />
                            ) : (
                              <Check
                                className="w-3.5 h-3.5 text-ink-subtle shrink-0"
                                aria-label="Sent"
                              />
                            )
                          )}
                          <p className="text-xs text-ink-muted truncate">
                            {conv.lastMessageText || `@${other.username}`}
                          </p>
                        </div>
                      )}
                      {other.unread > 0 && (
                        <span className="font-mono text-[11px] font-semibold text-accent-strong shrink-0">
                          {other.unread}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right Chat Thread */}
      <div
        className={`md:col-span-8 flex flex-col min-h-0 ${
          selectedConv ? 'flex' : 'hidden md:flex'
        }`}
      >
        {selectedConv && activeOther ? (
          <>
            <div className="px-5 py-3.5 border-b border-hairline flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => setSelectedConv(null)}
                  aria-label="Back to conversations"
                  className="md:hidden p-1.5 rounded-lg text-ink-muted hover:text-ink-2"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => onOpenProfile(activeOther.uid)}
                  className="flex items-center gap-3 text-left group min-w-0"
                >
                  <Avatar src={activeOther.avatar} name={activeOther.name} size="sm" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-2 group-hover:text-accent-strong truncate">
                      {activeOther.name}
                    </p>
                    {isActiveOtherTyping ? (
                      <p className="text-xs font-medium text-accent flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-0.5" aria-hidden="true">
                          <span className="w-1 h-1 rounded-full bg-accent animate-bounce [animation-delay:0ms]" />
                          <span className="w-1 h-1 rounded-full bg-accent animate-bounce [animation-delay:150ms]" />
                          <span className="w-1 h-1 rounded-full bg-accent animate-bounce [animation-delay:300ms]" />
                        </span>
                        <span>typing...</span>
                      </p>
                    ) : (
                      <p className="text-xs text-ink-muted truncate">@{activeOther.username}</p>
                    )}
                  </div>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-canvas-alt/40">
              {messages.length === 0 ? (
                <p className="text-xs text-ink-subtle text-center py-10">
                  Say hello to @{activeOther.username}. Messages are private between you two.
                </p>
              ) : (
                messages.map((msg) => {
                  const mine = msg.senderId === profile?.uid;
                  const isLatestSeen = msg.id === lastSeenMessageId;
                  const isLatestMine = msg.id === lastMyMessageId;
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}
                    >
                      <div
                        className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed break-words ${
                          mine
                            ? 'bg-accent-strong text-accent-fg font-medium'
                            : 'bg-surface-2 border border-hairline text-ink-2'
                        }`}
                      >
                        {msg.text}
                      </div>
                      <div className="mt-1 px-1 flex items-center gap-1.5 text-[10px] text-ink-subtle">
                        <span>
                          {msg.createdAt ? formatRelativeTime(msg.createdAt) : 'Sending...'}
                        </span>
                        {mine && msg.createdAt && (
                          msg.isRead ? (
                            <span
                              className="inline-flex items-center gap-1 text-accent-strong"
                              title={
                                msg.readAt
                                  ? `Seen ${formatRelativeTime(msg.readAt)}`
                                  : 'Seen'
                              }
                            >
                              <CheckCheck className="w-3.5 h-3.5" aria-label="Seen" />
                              {isLatestSeen && (
                                <span className="font-medium">
                                  {msg.readAt ? `Seen · ${formatRelativeTime(msg.readAt)}` : 'Seen'}
                                </span>
                              )}
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 text-ink-subtle"
                              title="Sent"
                            >
                              <Check className="w-3.5 h-3.5" aria-label="Sent" />
                              {isLatestMine && <span>Sent</span>}
                            </span>
                          )
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              {isActiveOtherTyping && (
                <div className="flex items-start" role="status" aria-live="polite">
                  <div className="rounded-2xl px-4 py-3 bg-surface-2 border border-accent/25 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1" aria-hidden="true">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce [animation-delay:0ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce [animation-delay:300ms]" />
                    </span>
                    <span className="sr-only">{activeOther.name} is typing</span>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            <form
              onSubmit={handleSend}
              className="p-4 border-t border-hairline flex items-center gap-2.5 bg-surface-2"
            >
              <input
                type="text"
                maxLength={1000}
                value={messageText}
                onChange={(e) => handleMessageInputChange(e.target.value)}
                onBlur={() => clearMyTyping()}
                placeholder={`Message @${activeOther.username}...`}
                className="flex-1 rounded-xl bg-canvas-alt border border-hairline px-4 py-2.5 text-sm text-ink-2 placeholder:text-ink-subtle focus:outline-none focus:border-accent-strong"
              />
              <button
                type="submit"
                disabled={sending || !messageText.trim()}
                aria-label="Send message"
                className="gold-gradient-btn px-4 py-2.5 rounded-xl flex items-center justify-center disabled:opacity-40"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <MessageSquare className="w-10 h-10 text-accent-strong" />
            <h2 className="mt-4 font-display text-lg font-semibold text-ink-2">
              Private Hostel Messaging
            </h2>
            <p className="mt-1.5 text-xs text-ink-muted max-w-sm">
              Select a conversation from the left or search for a member to start a direct chat.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
