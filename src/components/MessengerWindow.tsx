import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Ban,
  Bell,
  BellRing,
  Check,
  CheckCheck,
  ChevronLeft,
  Copy,
  EyeOff,
  MessageCircle,
  Mic,
  Plus,
  Reply,
  RotateCcw,
  Search,
  User,
  UserPlus,
  X,
} from 'lucide-react';
import {
  AccentColor,
  ChatReplyPreview,
  DirectMessage,
  FontStyle,
  MessengerUser,
} from '../types/notes';
import { getAccentClasses, getFontClass } from '../utils/noteHelpers';
import { PWAInstallButton } from './PWAInstallButton';

interface MessengerWindowProps {
  currentUser: MessengerUser;
  contacts: MessengerUser[];
  conversations: Record<string, DirectMessage[]>;
  unreadCounts: Record<string, number>;
  onlineUserIds: string[];
  peerLastSeen?: Record<string, number>;
  chatReceipts?: Record<string, { deliveredAt: number; seenAt: number }>;
  typingFromUsers: Record<string, boolean>;
  wsConnected: boolean;
  firebaseStatus?: 'ready' | 'anonymous-disabled' | 'permission-denied' | 'connecting' | 'local';
  firebaseEmail?: string | null;
  isAnonymousUser?: boolean;
  lookupResult: {
    status: 'idle' | 'searching' | 'found' | 'not_found';
    user?: MessengerUser;
    query?: string;
  };
  notificationsEnabled: boolean;
  pushTokenReady?: boolean;
  accent: AccentColor;
  fontStyle: FontStyle;
  isMobileFrame: boolean;
  onExitToNotes: () => void;
  onUpdateProfile: (displayName: string, handle: string) => void;
  onEmailAuth?: (email: string, password: string, isCreate: boolean) => Promise<void>;
  onGoogleAuth?: () => Promise<void>;
  onSignOutAuth?: () => Promise<void>;
  onLookupUser: (query: string) => void;
  onResetLookup: () => void;
  onAddContact: (user: MessengerUser) => void;
  onRemoveContact?: (userId: string) => void;
  onOpenChat: (peerId: string) => void;
  onCloseChat: () => void;
  onSendMessage: (
    toUserId: string,
    text: string,
    replyTo?: ChatReplyPreview
  ) => void;
  onReactMessage: (dmId: string, messageId: string, emoji: string) => void;
  onDeleteMessage: (dmId: string, messageId: string) => void;
  onTyping: (toUserId: string, isTyping: boolean) => void;
  onToggleNotifications: () => void;
  onTestReminder: () => void;
  onShowToast: (message: string) => void;
}

const REACTION_EMOJIS = ['👍', '❤️', '😂', '🔥'];

function makeDmId(userA: string, userB: string): string {
  return [userA, userB].sort().join('__');
}

function formatMessageTime(ts: number): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ts));
}

function formatDayLabel(ts: number): string {
  const date = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function formatLastSeen(ts?: number, now = Date.now()): string {
  if (!ts) return 'Offline';
  const diffSec = Math.max(0, Math.floor((now - ts) / 1000));
  if (diffSec < 5) return 'Last seen just now';
  if (diffSec < 60) return `Last seen ${diffSec}s ago`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `Last seen ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Last seen ${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `Last seen ${days}d ago`;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
}

export function MessengerWindow({
  currentUser,
  contacts,
  conversations,
  unreadCounts,
  onlineUserIds,
  peerLastSeen = {},
  chatReceipts = {},
  typingFromUsers,
  wsConnected,
  firebaseStatus = 'local',
  firebaseEmail = null,
  isAnonymousUser = true,
  lookupResult,
  notificationsEnabled,
  pushTokenReady = false,
  accent,
  fontStyle,
  isMobileFrame,
  onExitToNotes,
  onUpdateProfile,
  onEmailAuth,
  onGoogleAuth,
  onSignOutAuth,
  onLookupUser,
  onResetLookup,
  onAddContact,
  onOpenChat,
  onCloseChat,
  onSendMessage,
  onReactMessage,
  onDeleteMessage,
  onTyping,
  onToggleNotifications,
  onTestReminder,
  onShowToast,
}: MessengerWindowProps) {
  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(null);
  const [contactSearch, setContactSearch] = useState('');
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [addUserQuery, setAddUserQuery] = useState('');
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileName, setProfileName] = useState(currentUser.displayName);
  const [profileHandle, setProfileHandle] = useState(currentUser.handle);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [showNotifModal, setShowNotifModal] = useState(false);

  // Thread state
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<ChatReplyPreview | null>(null);
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  const [vpBounds, setVpBounds] = useState<{ height: number; offsetTop: number } | null>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const lastTypingPingRef = useRef<number>(0);
  const isTypingSentRef = useRef(false);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);
  const modalOpenedAtRef = useRef<number>(0);

  const openGlassMenu = (msgId: string) => {
    modalOpenedAtRef.current = Date.now();
    setSelectedMsgId(msgId);
  };

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressOriginRef.current = null;
  };

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 5000);
    return () => window.clearInterval(timer);
  }, []);

  // Hide browser outer scrollbar while inside Messenger views
  useEffect(() => {
    document.documentElement.classList.add('no-scrollbar');
    document.body.classList.add('no-scrollbar');
    return () => {
      document.documentElement.classList.remove('no-scrollbar');
      document.body.classList.remove('no-scrollbar');
    };
  }, []);

  const accentStyle = getAccentClasses(accent);
  const fontClass = getFontClass(fontStyle);

  const selectedPeer = useMemo(
    () => contacts.find((c) => c.userId === selectedPeerId) ?? null,
    [contacts, selectedPeerId]
  );

  const activeDmId = selectedPeer
    ? makeDmId(currentUser.userId, selectedPeer.userId)
    : null;

  const activeMessages = useMemo(
    () => (activeDmId ? conversations[activeDmId] ?? [] : []),
    [activeDmId, conversations]
  );

  const scrollMessagesToBottom = (smooth = false) => {
    const container = messagesScrollRef.current;
    if (!container) return;
    if (smooth) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    } else {
      container.scrollTop = container.scrollHeight;
    }
  };

  useEffect(() => {
    if (selectedPeerId) {
      scrollMessagesToBottom(true);
    }
  }, [activeMessages.length, selectedPeerId, typingFromUsers]);

  // Keep mobile chat header & messages steady while moving only the input bar with the soft keyboard
  useEffect(() => {
    if (isMobileFrame || !selectedPeerId) {
      setVpBounds(null);
      setKeyboardOpen(false);
      return;
    }

    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevHtmlHeight = document.documentElement.style.height;
    const prevBodyOverflow = document.body.style.overflow;
    const prevBodyOverscroll = document.body.style.overscrollBehavior;
    const prevBodyPosition = document.body.style.position;
    const prevBodyInset = document.body.style.inset;
    const prevBodyWidth = document.body.style.width;
    const prevBodyHeight = document.body.style.height;

    document.documentElement.style.height = '100%';
    document.documentElement.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.inset = '0';
    document.body.style.width = '100%';
    document.body.style.height = '100%';
    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'none';

    const syncViewport = () => {
      const container = messagesScrollRef.current;
      const wasAtBottom = container
        ? container.scrollHeight - container.scrollTop - container.clientHeight < 80
        : false;

      if (window.scrollY !== 0 || window.scrollX !== 0) {
        window.scrollTo(0, 0);
      }

      const vv = window.visualViewport;
      if (vv) {
        const isKbOpen = vv.height < window.innerHeight - 90;
        setKeyboardOpen(isKbOpen);
        setVpBounds({
          height: Math.round(vv.height),
          offsetTop: Math.max(0, Math.round(vv.offsetTop)),
        });
      } else {
        setVpBounds({
          height: window.innerHeight,
          offsetTop: 0,
        });
      }

      if (wasAtBottom) {
        requestAnimationFrame(() => scrollMessagesToBottom(false));
      }
    };

    const handleWindowScroll = () => {
      if (window.scrollY !== 0 || window.scrollX !== 0) {
        window.scrollTo(0, 0);
      }
    };

    syncViewport();

    const vv = window.visualViewport;
    vv?.addEventListener('resize', syncViewport);
    vv?.addEventListener('scroll', syncViewport);
    window.addEventListener('resize', syncViewport);
    window.addEventListener('scroll', handleWindowScroll, { passive: true });

    return () => {
      vv?.removeEventListener('resize', syncViewport);
      vv?.removeEventListener('scroll', syncViewport);
      window.removeEventListener('resize', syncViewport);
      window.removeEventListener('scroll', handleWindowScroll);
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.documentElement.style.height = prevHtmlHeight;
      document.body.style.overflow = prevBodyOverflow;
      document.body.style.overscrollBehavior = prevBodyOverscroll;
      document.body.style.position = prevBodyPosition;
      document.body.style.inset = prevBodyInset;
      document.body.style.width = prevBodyWidth;
      document.body.style.height = prevBodyHeight;
    };
  }, [isMobileFrame, selectedPeerId]);

  const sortedContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    const filtered = contacts.filter((c) => {
      if (!q) return true;
      return (
        c.displayName.toLowerCase().includes(q) ||
        c.handle.toLowerCase().includes(q)
      );
    });
    return [...filtered].sort((a, b) => {
      const dmA = conversations[makeDmId(currentUser.userId, a.userId)] ?? [];
      const dmB = conversations[makeDmId(currentUser.userId, b.userId)] ?? [];
      const lastA = dmA[dmA.length - 1]?.createdAt ?? 0;
      const lastB = dmB[dmB.length - 1]?.createdAt ?? 0;
      return lastB - lastA;
    });
  }, [contacts, contactSearch, conversations, currentUser.userId]);

  const groupedMessages = useMemo(() => {
    const groups: { day: string; items: DirectMessage[] }[] = [];
    for (const msg of activeMessages) {
      const day = formatDayLabel(msg.createdAt);
      const last = groups[groups.length - 1];
      if (!last || last.day !== day) {
        groups.push({ day, items: [msg] });
      } else {
        last.items.push(msg);
      }
    }
    return groups;
  }, [activeMessages]);

  const handleOpenPeerChat = (peer: MessengerUser) => {
    setSelectedPeerId(peer.userId);
    setSelectedMsgId(null);
    setReplyTo(null);
    onOpenChat(peer.userId);
  };

  const handleBackToInbox = () => {
    if (selectedPeer && isTypingSentRef.current) {
      if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
      isTypingSentRef.current = false;
      lastTypingPingRef.current = 0;
      onTyping(selectedPeer.userId, false);
    }
    setSelectedPeerId(null);
    setSelectedMsgId(null);
    setReplyTo(null);
    onCloseChat();
  };

  const handleDraftChange = (val: string) => {
    setDraft(val);
    if (!selectedPeer) return;
    if (val.trim()) {
      const now = Date.now();
      if (!isTypingSentRef.current || now - lastTypingPingRef.current > 2200) {
        isTypingSentRef.current = true;
        lastTypingPingRef.current = now;
        onTyping(selectedPeer.userId, true);
      }
      if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = window.setTimeout(() => {
        isTypingSentRef.current = false;
        lastTypingPingRef.current = 0;
        onTyping(selectedPeer.userId, false);
      }, 1800);
    } else if (isTypingSentRef.current) {
      isTypingSentRef.current = false;
      lastTypingPingRef.current = 0;
      onTyping(selectedPeer.userId, false);
    }
  };

  const handleSend = () => {
    if (!selectedPeer || !draft.trim()) return;
    onSendMessage(selectedPeer.userId, draft.trim(), replyTo ?? undefined);
    setDraft('');
    setReplyTo(null);
    if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
    isTypingSentRef.current = false;
    lastTypingPingRef.current = 0;
    onTyping(selectedPeer.userId, false);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleVoiceDictate = () => {
    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRec) {
      onShowToast('Voice input not supported in this browser');
      return;
    }
    try {
      const rec = new SpeechRec();
      rec.lang = 'en-US';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      setListening(true);
      rec.onresult = (event) => {
        const transcript = event.results?.[0]?.[0]?.transcript ?? '';
        if (transcript) {
          setDraft((prev) => (prev ? `${prev} ${transcript}` : transcript));
        }
      };
      rec.onerror = () => setListening(false);
      rec.onend = () => setListening(false);
      rec.start();
    } catch {
      setListening(false);
    }
  };

  const handleCopyMyHandle = async () => {
    try {
      await navigator.clipboard.writeText(currentUser.handle);
      onShowToast(`Copied @${currentUser.handle}`);
    } catch {
      onShowToast(`Your ID: @${currentUser.handle}`);
    }
  };

  const handleSaveProfile = () => {
    const cleanName = profileName.trim() || 'User';
    const cleanHandle =
      profileHandle
        .trim()
        .toLowerCase()
        .replace(/^@/, '')
        .replace(/[^a-z0-9_-]/g, '') || currentUser.handle;
    onUpdateProfile(cleanName, cleanHandle);
    setShowProfileModal(false);
    onShowToast('Profile updated');
  };

  // Thread Chat Screen (Messenger-style)
  if (selectedPeer && activeDmId) {
    const isPeerOnline = onlineUserIds.includes(selectedPeer.userId);
    const isPeerTyping = Boolean(typingFromUsers[selectedPeer.userId]);
    const activeReceipt = chatReceipts[activeDmId];
    const lastSeenTs = peerLastSeen[selectedPeer.userId] ?? selectedPeer.lastSeen;

    let lastSeenOutgoingId: string | null = null;
    for (let i = activeMessages.length - 1; i >= 0; i -= 1) {
      const m = activeMessages[i];
      if (m.fromUserId === currentUser.userId) {
        const msgSeen = Boolean(
          m.seenAt || (activeReceipt && activeReceipt.seenAt >= m.createdAt)
        );
        if (msgSeen) {
          lastSeenOutgoingId = m.id;
          break;
        }
      }
    }

    return (
      <div
        style={
          !isMobileFrame
            ? {
                top: vpBounds ? `${vpBounds.offsetTop}px` : '0px',
                height: vpBounds ? `${vpBounds.height}px` : '100dvh',
              }
            : undefined
        }
        className={`${
          isMobileFrame
            ? 'flex-1 min-h-0 h-full'
            : 'fixed inset-x-0 z-40'
        } flex flex-col overflow-hidden bg-[#f2f2f7] dark:bg-black`}
        onClick={() => setSelectedMsgId(null)}
      >
        {/* Messenger Header */}
        <header className="shrink-0 z-30 min-h-[calc(62px+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] px-3 flex items-center justify-between gap-2 bg-white/95 dark:bg-[#111113]/95 backdrop-blur-xl border-b border-slate-200/80 dark:border-white/[0.08] touch-none">
          <div className="flex items-center gap-2 min-w-0 py-2">
            <button
              type="button"
              onClick={handleBackToInbox}
              aria-label="Back to chats"
              className="h-10 w-10 rounded-full flex items-center justify-center text-slate-800 dark:text-white hover:bg-slate-100 dark:hover:bg-white/[0.08] shrink-0"
            >
              <ChevronLeft className="w-5 h-5" strokeWidth={2.2} />
            </button>

            <div className="relative w-9 h-9 rounded-full bg-blue-600 text-white font-bold text-sm flex items-center justify-center shrink-0">
              {selectedPeer.displayName.slice(0, 1).toUpperCase()}
              {isPeerOnline && (
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white dark:border-[#111113]" />
              )}
            </div>

            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-slate-900 dark:text-white truncate leading-tight">
                {selectedPeer.displayName}
              </div>
              <div className="text-[11px] truncate">
                {isPeerTyping ? (
                  <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                    <span>{isPeerOnline ? 'Online · typing' : 'typing'}</span>
                    <span className="inline-flex items-center gap-0.5" aria-hidden="true">
                      <span
                        className="w-1 h-1 rounded-full bg-current animate-bounce"
                        style={{ animationDelay: '0ms' }}
                      />
                      <span
                        className="w-1 h-1 rounded-full bg-current animate-bounce"
                        style={{ animationDelay: '150ms' }}
                      />
                      <span
                        className="w-1 h-1 rounded-full bg-current animate-bounce"
                        style={{ animationDelay: '300ms' }}
                      />
                    </span>
                  </span>
                ) : isPeerOnline ? (
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                    Online · @{selectedPeer.handle}
                  </span>
                ) : (
                  <span className="text-slate-500 dark:text-zinc-400">
                    {formatLastSeen(lastSeenTs, nowTick)} · @{selectedPeer.handle}
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onExitToNotes}
            aria-label="Hide to Notes"
            title="Return to Notes"
            className="h-10 px-3 rounded-full bg-slate-100 dark:bg-[#1C1C1E] border border-slate-200/80 dark:border-white/[0.1] flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-zinc-200 shrink-0"
          >
            <EyeOff className="w-4 h-4" />
            <span>Hide</span>
          </button>
        </header>

        {/* Chat Messages */}
        <main
          ref={messagesScrollRef}
          className={`flex-1 min-h-0 overflow-y-auto overscroll-y-contain no-scrollbar w-full mx-auto px-3.5 pt-3 pb-4 flex flex-col ${
            isMobileFrame ? '' : 'max-w-3xl'
          }`}
        >
          {activeMessages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center pb-12 text-center">
              <div className="w-14 h-14 rounded-full bg-blue-600/15 text-blue-500 flex items-center justify-center font-bold text-xl mb-3">
                {selectedPeer.displayName.slice(0, 1).toUpperCase()}
              </div>
              <p className="text-[16px] font-semibold text-slate-900 dark:text-white">
                {selectedPeer.displayName}
              </p>
              <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">
                @{selectedPeer.handle} · Say hello to start chatting
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {groupedMessages.map((group) => (
                <div key={group.day} className="space-y-2">
                  <div className="text-center py-1">
                    <span className="text-[11px] font-medium text-slate-400 dark:text-zinc-500">
                      {group.day}
                    </span>
                  </div>

                  {group.items.map((msg) => {
                    const isMine = msg.fromUserId === currentUser.userId;
                    const isUnsent = Boolean(msg.unsent);
                    const isSelected = selectedMsgId === msg.id && !isUnsent;
                    const isMsgSeen = Boolean(
                      isMine &&
                        !isUnsent &&
                        (msg.seenAt ||
                          (activeReceipt && activeReceipt.seenAt >= msg.createdAt))
                    );
                    const isMsgDelivered = Boolean(
                      isMine &&
                        !isUnsent &&
                        (isMsgSeen ||
                          msg.deliveredAt ||
                          (activeReceipt && activeReceipt.deliveredAt >= msg.createdAt) ||
                          isPeerOnline)
                    );

                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col select-none [-webkit-touch-callout:none] ${
                          isMine ? 'items-end' : 'items-start'
                        }`}
                        onPointerDown={(e) => {
                          if (isUnsent) return;
                          e.stopPropagation();
                          clearLongPress();
                          longPressOriginRef.current = { x: e.clientX, y: e.clientY };
                          longPressTimerRef.current = window.setTimeout(() => {
                            longPressTimerRef.current = null;
                            openGlassMenu(msg.id);
                            try {
                              navigator.vibrate?.(12);
                            } catch {
                              // Ignore haptic error
                            }
                          }, 380);
                        }}
                        onPointerMove={(e) => {
                          const origin = longPressOriginRef.current;
                          if (!origin) return;
                          if (
                            Math.abs(e.clientX - origin.x) > 8 ||
                            Math.abs(e.clientY - origin.y) > 8
                          ) {
                            clearLongPress();
                          }
                        }}
                        onPointerUp={clearLongPress}
                        onPointerCancel={clearLongPress}
                        onContextMenu={(e) => {
                          if (isUnsent) return;
                          e.preventDefault();
                          e.stopPropagation();
                          clearLongPress();
                          openGlassMenu(msg.id);
                        }}
                      >
                        {isUnsent ? (
                          <div
                            className={`max-w-[80%] sm:max-w-[68%] px-3.5 py-2 rounded-2xl border backdrop-blur-xs ${
                              isMine
                                ? 'bg-slate-200/70 dark:bg-white/[0.06] border-slate-300/60 dark:border-white/[0.08] text-slate-500 dark:text-zinc-400 rounded-br-md'
                                : 'bg-white/70 dark:bg-[#1C1C1E]/70 border-slate-200/80 dark:border-white/[0.08] text-slate-500 dark:text-zinc-400 rounded-bl-md'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 text-[13px] italic">
                              <Ban className="w-3.5 h-3.5 shrink-0 opacity-75" />
                              <span>
                                {isMine ? 'You unsent a message' : 'This message was deleted'}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-center justify-end text-[10px] tabular-nums opacity-70">
                              <span>{formatMessageTime(msg.createdAt)}</span>
                            </div>
                          </div>
                        ) : (
                          <div
                            className={`max-w-[80%] sm:max-w-[68%] px-3.5 py-2.5 rounded-2xl transition-transform duration-150 ${
                              isSelected ? 'scale-[0.98]' : ''
                            } ${
                              isMine
                                ? 'bg-blue-600 text-white rounded-br-md'
                                : 'bg-white dark:bg-[#1C1C1E] border border-slate-200/80 dark:border-white/[0.08] text-slate-900 dark:text-white rounded-bl-md'
                            }`}
                          >
                            {msg.replyTo && (
                              <div
                                className={`mb-1.5 px-2.5 py-1.5 rounded-xl text-xs ${
                                  isMine
                                    ? 'bg-white/15 text-white'
                                    : 'bg-slate-100 dark:bg-white/[0.06] text-slate-700 dark:text-zinc-300'
                                }`}
                              >
                                <div className="font-semibold">{msg.replyTo.senderName}</div>
                                <div className="truncate opacity-90">{msg.replyTo.text}</div>
                              </div>
                            )}

                            <p
                              className={`${fontClass} text-[15px] leading-relaxed whitespace-pre-wrap break-words`}
                            >
                              {msg.text}
                            </p>

                            <div
                              className={`mt-1 flex items-center justify-end gap-1 text-[10px] tabular-nums ${
                                isMine ? 'text-blue-100' : 'text-slate-400 dark:text-zinc-500'
                              }`}
                            >
                              <span>{formatMessageTime(msg.createdAt)}</span>
                              {isMine &&
                                (isMsgSeen ? (
                                  msg.id === lastSeenOutgoingId ? (
                                    <span className="font-semibold text-blue-100">
                                      · Seen
                                    </span>
                                  ) : null
                                ) : isMsgDelivered ? (
                                  <CheckCheck
                                    className="w-3.5 h-3.5 text-sky-200"
                                    aria-label="Delivered"
                                  />
                                ) : (
                                  <Check
                                    className="w-3 h-3 text-blue-100/85"
                                    aria-label="Sent"
                                  />
                                ))}
                            </div>
                          </div>
                        )}

                        {!isUnsent && msg.reactions && msg.reactions.length > 0 && (
                          <div className="flex items-center gap-1 mt-1 px-1">
                            {msg.reactions.map((r) => (
                              <button
                                key={r.emoji}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onReactMessage(activeDmId, msg.id, r.emoji);
                                }}
                                className={`px-2 py-0.5 rounded-full text-xs border flex items-center gap-1 ${
                                  r.userIds.includes(currentUser.userId)
                                    ? 'bg-blue-500/15 border-blue-500/40 text-slate-900 dark:text-white'
                                    : 'bg-white dark:bg-[#1C1C1E] border-slate-200 dark:border-white/[0.1] text-slate-700 dark:text-zinc-300'
                                }`}
                              >
                                <span>{r.emoji}</span>
                                {r.userIds.length > 1 && (
                                  <span className="tabular-nums text-[10px]">
                                    {r.userIds.length}
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {isPeerTyping && (
            <div className="mt-3 flex items-start">
              <div className="px-3.5 py-2.5 rounded-2xl rounded-bl-md bg-white dark:bg-[#1C1C1E] border border-slate-200/80 dark:border-white/[0.08] flex items-center gap-1.5 shadow-xs">
                <span
                  className="w-2 h-2 rounded-full bg-slate-400 dark:bg-zinc-400 animate-bounce"
                  style={{ animationDelay: '0ms' }}
                />
                <span
                  className="w-2 h-2 rounded-full bg-slate-400 dark:bg-zinc-400 animate-bounce"
                  style={{ animationDelay: '160ms' }}
                />
                <span
                  className="w-2 h-2 rounded-full bg-slate-400 dark:bg-zinc-400 animate-bounce"
                  style={{ animationDelay: '320ms' }}
                />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </main>

        {/* Bottom Messenger Input Bar */}
        <div
          className={`shrink-0 z-30 px-3 pt-2 ${
            keyboardOpen || isMobileFrame
              ? 'pb-2.5'
              : 'pb-[max(14px,env(safe-area-inset-bottom))]'
          } bg-[#f2f2f7]/95 dark:bg-black/95 border-t border-slate-200/60 dark:border-white/[0.06]`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={`mx-auto ${isMobileFrame ? 'w-full' : 'max-w-3xl'}`}>
            {replyTo && (
              <div className="mb-2 px-3.5 py-2 rounded-2xl bg-white dark:bg-[#1C1C1E] border border-slate-200 dark:border-white/[0.1] flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-blue-500">
                    Replying to {replyTo.senderName}
                  </div>
                  <div className="text-xs text-slate-600 dark:text-zinc-300 truncate">
                    {replyTo.text}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setReplyTo(null)}
                  aria-label="Cancel reply"
                  className="min-h-[34px] min-w-[34px] flex items-center justify-center text-slate-400"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            <div className="h-12 rounded-full bg-white dark:bg-[#1C1C1E] border border-slate-200/90 dark:border-white/[0.1] shadow-lg flex items-center pl-2 pr-1.5 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const timeStr = new Intl.DateTimeFormat('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                  }).format(new Date());
                  setDraft((prev) => (prev ? `${prev} [${timeStr}]` : `[${timeStr}] `));
                  inputRef.current?.focus();
                }}
                aria-label="Insert time"
                className="w-9 h-9 rounded-full flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-white/[0.06] shrink-0"
              >
                <Plus className="w-[18px] h-[18px]" />
              </button>

              <input
                ref={inputRef}
                type="text"
                value={draft}
                onChange={(e) => handleDraftChange(e.target.value)}
                onFocus={() => {
                  if (!isMobileFrame) {
                    const pinTop = () => {
                      if (window.scrollY !== 0 || window.scrollX !== 0) {
                        window.scrollTo(0, 0);
                      }
                      const vv = window.visualViewport;
                      if (vv) {
                        setKeyboardOpen(vv.height < window.innerHeight - 90);
                        setVpBounds({
                          height: Math.round(vv.height),
                          offsetTop: Math.max(0, Math.round(vv.offsetTop)),
                        });
                      }
                    };
                    pinTop();
                    window.setTimeout(pinTop, 60);
                    window.setTimeout(pinTop, 180);
                    window.setTimeout(pinTop, 320);
                  }
                }}
                onBlur={() => {
                  if (!isMobileFrame) {
                    window.setTimeout(() => {
                      if (window.scrollY !== 0) window.scrollTo(0, 0);
                    }, 80);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Message…"
                aria-label="Message input"
                className={`${fontClass} flex-1 min-w-0 bg-transparent text-[16px] text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:outline-none`}
              />

              {draft.trim() ? (
                <button
                  type="button"
                  onClick={handleSend}
                  aria-label="Send message"
                  className="w-9 h-9 rounded-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center shrink-0 transition-transform active:scale-95"
                >
                  <ArrowUp className="w-[18px] h-[18px]" strokeWidth={2.5} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleVoiceDictate}
                  aria-label="Voice input"
                  className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                    listening
                      ? 'text-blue-500'
                      : 'text-slate-500 dark:text-zinc-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Mic className="w-[18px] h-[18px]" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Long-Press Frosted Glass Action Sheet (Unsend / React / Reply / Copy) */}
        {(() => {
          const selectedMsg = selectedMsgId
            ? activeMessages.find((m) => m.id === selectedMsgId && !m.unsent) ?? null
            : null;
          if (!selectedMsg) return null;
          const selectedIsMine = selectedMsg.fromUserId === currentUser.userId;

          return (
            <div
              className={`${
                isMobileFrame ? 'absolute' : 'fixed'
              } inset-0 z-50 flex flex-col items-center justify-center p-5 bg-black/35 backdrop-blur-md`}
              onClick={() => {
                if (Date.now() - modalOpenedAtRef.current < 450) return;
                setSelectedMsgId(null);
              }}
              role="dialog"
              aria-modal="true"
              aria-label="Message options"
            >
              <div
                className="w-full max-w-[300px] space-y-3"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Frosted Message Preview */}
                <div
                  className={`px-4 py-2.5 rounded-2xl shadow-xl backdrop-blur-xl border ${
                    selectedIsMine
                      ? 'bg-blue-600/90 border-blue-400/40 text-white ml-auto max-w-[85%]'
                      : 'bg-white/85 dark:bg-zinc-900/85 border-white/50 dark:border-white/15 text-slate-900 dark:text-white mr-auto max-w-[85%]'
                  }`}
                >
                  <p className="text-[14px] leading-relaxed whitespace-pre-wrap break-words max-h-32 overflow-y-auto no-scrollbar">
                    {selectedMsg.text}
                  </p>
                </div>

                {/* Frosted Glass Reactions Pill */}
                <div className="px-2 py-1.5 rounded-full backdrop-blur-2xl bg-white/80 dark:bg-zinc-900/80 border border-white/60 dark:border-white/15 shadow-2xl flex items-center justify-between">
                  {REACTION_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => {
                        onReactMessage(activeDmId, selectedMsg.id, emoji);
                        setSelectedMsgId(null);
                      }}
                      className="h-10 w-10 rounded-full hover:bg-black/5 dark:hover:bg-white/10 active:scale-110 transition-transform flex items-center justify-center text-lg"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>

                {/* Frosted Glass Actions List */}
                <div className="rounded-2xl overflow-hidden backdrop-blur-2xl bg-white/80 dark:bg-zinc-900/80 border border-white/60 dark:border-white/15 shadow-2xl divide-y divide-slate-900/10 dark:divide-white/10">
                  <button
                    type="button"
                    onClick={() => {
                      setReplyTo({
                        id: selectedMsg.id,
                        senderName: selectedMsg.senderName,
                        text: selectedMsg.text,
                      });
                      setSelectedMsgId(null);
                      inputRef.current?.focus();
                    }}
                    className="w-full px-4 py-3 flex items-center justify-between text-sm font-medium text-slate-900 dark:text-white hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <span>Reply</span>
                    <Reply className="w-4 h-4 opacity-75" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      try {
                        navigator.clipboard.writeText(selectedMsg.text);
                        onShowToast('Copied');
                      } catch {
                        // Ignore
                      }
                      setSelectedMsgId(null);
                    }}
                    className="w-full px-4 py-3 flex items-center justify-between text-sm font-medium text-slate-900 dark:text-white hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    <span>Copy</span>
                    <Copy className="w-4 h-4 opacity-75" />
                  </button>

                  {selectedIsMine && (
                    <button
                      type="button"
                      onClick={() => {
                        onDeleteMessage(activeDmId, selectedMsg.id);
                        setSelectedMsgId(null);
                      }}
                      className="w-full px-4 py-3 flex items-center justify-between text-sm font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                    >
                      <span>Unsend</span>
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    );
  }

  // Messenger Inbox / Contacts Window
  return (
    <div
      className={`${
        isMobileFrame
          ? 'flex-1 min-h-0 h-full overflow-hidden'
          : 'h-[100dvh] overflow-hidden'
      } flex flex-col bg-[#f2f2f7] dark:bg-black`}
    >
      {/* Messenger Top Bar */}
      <header className="sticky top-0 shrink-0 z-30 min-h-[calc(62px+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] px-4 flex items-center justify-between gap-2 bg-[#f2f2f7]/90 dark:bg-black/90 backdrop-blur-xl">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={onExitToNotes}
            aria-label="Back to Folders"
            className="h-11 w-11 rounded-full bg-white dark:bg-[#1C1C1E] border border-slate-200/80 dark:border-white/[0.1] flex items-center justify-center text-slate-800 dark:text-white shadow-xs shrink-0"
          >
            <ChevronLeft className="w-5 h-5" strokeWidth={2.1} />
          </button>

          <div className="min-w-0">
            <h1 className="text-[20px] font-bold tracking-tight text-slate-900 dark:text-white leading-tight">
              Messages
            </h1>
            <button
              type="button"
              onClick={handleCopyMyHandle}
              className="text-[11px] text-slate-500 dark:text-zinc-400 flex items-center gap-1 truncate"
            >
              <span>@{currentUser.handle}</span>
              <span aria-hidden="true">·</span>
              <span>
                {firebaseStatus === 'ready'
                  ? 'Firebase Live'
                  : firebaseStatus === 'anonymous-disabled'
                  ? 'Enable Auth in Firebase'
                  : firebaseStatus === 'permission-denied'
                  ? 'Check Firestore Rules'
                  : wsConnected
                  ? 'Connected'
                  : 'Local Ready'}
              </span>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowNotifModal(true)}
            aria-label="Notification settings"
            className={`h-11 w-11 rounded-full bg-white dark:bg-[#1C1C1E] border border-slate-200/80 dark:border-white/[0.1] flex items-center justify-center shadow-xs ${
              notificationsEnabled
                ? 'text-blue-500'
                : 'text-slate-700 dark:text-zinc-200'
            }`}
          >
            {notificationsEnabled ? (
              <BellRing className="w-[18px] h-[18px]" />
            ) : (
              <Bell className="w-[18px] h-[18px]" />
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              onResetLookup();
              setAddUserQuery('');
              setShowAddUserModal(true);
            }}
            aria-label="Add user"
            className="h-11 w-11 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-sm transition-transform active:scale-95"
          >
            <UserPlus className="w-[18px] h-[18px]" />
          </button>

          <button
            type="button"
            onClick={() => {
              setProfileName(currentUser.displayName);
              setProfileHandle(currentUser.handle);
              setShowProfileModal(true);
            }}
            aria-label="Edit my profile"
            className="h-11 w-11 rounded-full bg-white dark:bg-[#1C1C1E] border border-slate-200/80 dark:border-white/[0.1] flex items-center justify-center text-slate-700 dark:text-white shadow-xs"
          >
            <User className="w-[18px] h-[18px]" />
          </button>
        </div>
      </header>

      {/* Search & Conversations */}
      <main
        className={`flex-1 min-h-0 overflow-y-auto overscroll-y-contain no-scrollbar w-full mx-auto px-4 pt-2 pb-8 flex flex-col ${
          isMobileFrame ? '' : 'max-w-3xl'
        }`}
      >
        <div className="relative mb-4">
          <Search className="w-4 h-4 text-slate-400 dark:text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={contactSearch}
            onChange={(e) => setContactSearch(e.target.value)}
            placeholder="Search people…"
            aria-label="Search contacts"
            className="w-full h-11 pl-10 pr-4 rounded-full bg-white dark:bg-[#1C1C1E] border border-slate-200/80 dark:border-white/[0.08] text-base sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:outline-none"
          />
        </div>

        {/* Shareable User ID Card */}
        <div className="mb-4 p-3.5 rounded-2xl bg-white dark:bg-[#1C1C1E] border border-slate-200/80 dark:border-white/[0.08] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-slate-500 dark:text-zinc-400">
              Your Messenger ID
            </div>
            <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
              {currentUser.displayName} · @{currentUser.handle}
            </div>
          </div>
          <button
            type="button"
            onClick={handleCopyMyHandle}
            className="min-h-[38px] px-3.5 rounded-full bg-slate-100 dark:bg-zinc-800 text-xs font-medium text-slate-800 dark:text-white flex items-center gap-1.5 shrink-0"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Copy ID</span>
          </button>
        </div>

        {firebaseStatus === 'anonymous-disabled' && (
          <div className="mb-4 p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs text-slate-700 dark:text-zinc-200 space-y-2">
            <div className="font-semibold text-amber-600 dark:text-amber-400">
              Firebase Authentication needed for cross-device chat
            </div>
            <p className="text-slate-600 dark:text-zinc-300">
              Enable <strong>Anonymous</strong> (or <strong>Email/Password</strong>) in Firebase Console → Authentication → Sign-in method, or sign in via the Profile icon above.
            </p>
          </div>
        )}

        {firebaseStatus === 'permission-denied' && (
          <div className="mb-4 p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-xs text-slate-700 dark:text-zinc-200">
            <span className="font-semibold text-rose-500">Firestore Rules blocked access.</span> Publish the Firestore Security Rules in Firebase Console → Firestore Database → Rules.
          </div>
        )}

        {sortedContacts.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-14 text-center">
            <div className="w-14 h-14 rounded-full bg-blue-600/15 text-blue-500 flex items-center justify-center mb-3">
              <MessageCircle className="w-7 h-7" />
            </div>
            <p className="text-[17px] font-semibold text-slate-900 dark:text-white">
              {contactSearch ? 'No matching contacts' : 'No Conversations Yet'}
            </p>
            <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1 max-w-[260px]">
              Add a friend using their Messenger ID (@handle) to send hidden messages.
            </p>
            {!contactSearch && (
              <button
                type="button"
                onClick={() => {
                  onResetLookup();
                  setAddUserQuery('');
                  setShowAddUserModal(true);
                }}
                className="mt-4 min-h-[44px] px-5 rounded-full bg-blue-600 text-white text-sm font-semibold inline-flex items-center gap-2"
              >
                <UserPlus className="w-4 h-4" />
                <span>Add User</span>
              </button>
            )}
          </div>
        ) : (
          <div className="rounded-[22px] bg-white dark:bg-[#1C1C1E] border border-slate-200/70 dark:border-white/[0.06] overflow-hidden divide-y divide-slate-100 dark:divide-white/[0.06]">
            {sortedContacts.map((peer) => {
              const dmId = makeDmId(currentUser.userId, peer.userId);
              const thread = conversations[dmId] ?? [];
              const lastMsg = thread[thread.length - 1];
              const unread = unreadCounts[peer.userId] ?? 0;
              const isOnline = onlineUserIds.includes(peer.userId);
              const isTyping = Boolean(typingFromUsers[peer.userId]);
              const lastSeenTs = peerLastSeen[peer.userId] ?? peer.lastSeen;

              return (
                <div
                  key={peer.userId}
                  className="flex items-center hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => handleOpenPeerChat(peer)}
                    className="flex-1 min-w-0 p-3.5 flex items-center gap-3 text-left"
                  >
                    <div className="relative w-12 h-12 rounded-full bg-blue-600 text-white font-bold text-base flex items-center justify-center shrink-0">
                      {peer.displayName.slice(0, 1).toUpperCase()}
                      {isOnline && (
                        <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white dark:border-[#1C1C1E]" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[15px] font-semibold text-slate-900 dark:text-white truncate">
                          {peer.displayName}
                        </span>
                        {lastMsg ? (
                          <span className="text-[11px] text-slate-400 dark:text-zinc-500 tabular-nums shrink-0">
                            {formatMessageTime(lastMsg.createdAt)}
                          </span>
                        ) : (
                          !isOnline &&
                          lastSeenTs && (
                            <span className="text-[11px] text-slate-400 dark:text-zinc-500 shrink-0">
                              {formatLastSeen(lastSeenTs, nowTick)}
                            </span>
                          )
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <span
                          className={`text-xs truncate ${
                            isTyping
                              ? 'font-medium text-emerald-600 dark:text-emerald-400'
                              : lastMsg?.unsent
                              ? 'italic text-slate-400 dark:text-zinc-500'
                              : unread > 0
                              ? 'font-semibold text-slate-900 dark:text-white'
                              : 'text-slate-500 dark:text-zinc-400'
                          }`}
                        >
                          {isTyping
                            ? 'typing…'
                            : lastMsg
                            ? lastMsg.unsent
                              ? lastMsg.fromUserId === currentUser.userId
                                ? 'You unsent a message'
                                : 'This message was deleted'
                              : `${lastMsg.fromUserId === currentUser.userId ? 'You: ' : ''}${lastMsg.text}`
                            : isOnline
                            ? `Online · @${peer.handle}`
                            : `${formatLastSeen(lastSeenTs, nowTick)} · @${peer.handle}`}
                        </span>
                        {unread > 0 && (
                          <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center tabular-nums shrink-0">
                            {unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Add User Modal */}
      {showAddUserModal && (
        <div
          className={`${
            isMobileFrame ? 'absolute' : 'fixed'
          } inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-4`}
          onClick={() => setShowAddUserModal(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Add user"
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#1C1C1E] border border-slate-200 dark:border-white/[0.1] p-5 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Add User
              </h2>
              <button
                type="button"
                onClick={() => setShowAddUserModal(false)}
                aria-label="Close"
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-full text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <label className="block text-xs text-slate-500 dark:text-zinc-400">
                Enter your friend&apos;s Messenger Handle or ID
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  autoFocus
                  value={addUserQuery}
                  onChange={(e) => setAddUserQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && addUserQuery.trim()) {
                      onLookupUser(addUserQuery.trim());
                    }
                  }}
                  placeholder="e.g. sifat-4821"
                  className="flex-1 h-11 px-3.5 rounded-xl bg-slate-100 dark:bg-black/60 border border-slate-200 dark:border-white/[0.1] text-sm text-slate-900 dark:text-white focus:outline-none"
                />
                <button
                  type="button"
                  disabled={!addUserQuery.trim()}
                  onClick={() => onLookupUser(addUserQuery.trim())}
                  className="h-11 px-4 rounded-xl bg-blue-600 text-white text-sm font-semibold disabled:opacity-40"
                >
                  Find
                </button>
              </div>
            </div>

            {lookupResult.status === 'searching' && (
              <p className="text-xs text-slate-500 dark:text-zinc-400">Searching user…</p>
            )}

            {lookupResult.status === 'not_found' && (
              <div className="p-3 rounded-2xl bg-slate-100 dark:bg-black/50 space-y-2">
                <p className="text-xs text-slate-600 dark:text-zinc-300">
                  User &ldquo;@{lookupResult.query}&rdquo; hasn&apos;t connected yet. Ask them to open Messages once with handle{' '}
                  <span className="font-semibold">@{lookupResult.query}</span>, or add them now so messages deliver as soon as they join:
                </p>
                <button
                  type="button"
                  onClick={() => {
                    const cleanHandle = (lookupResult.query || 'friend')
                      .toLowerCase()
                      .replace(/[^a-z0-9_-]/g, '');
                    const newContact: MessengerUser = {
                      userId: cleanHandle,
                      handle: cleanHandle,
                      displayName: cleanHandle,
                    };
                    onAddContact(newContact);
                    setShowAddUserModal(false);
                    handleOpenPeerChat(newContact);
                  }}
                  className="w-full min-h-[40px] rounded-xl bg-blue-600 text-white text-xs font-semibold"
                >
                  Add @{lookupResult.query} Anyway
                </button>
              </div>
            )}

            {lookupResult.status === 'found' && lookupResult.user && (
              <div className="p-3 rounded-2xl bg-slate-100 dark:bg-black/50 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-10 h-10 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center shrink-0">
                    {lookupResult.user.displayName.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {lookupResult.user.displayName}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-zinc-400 truncate">
                      @{lookupResult.user.handle}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const user = lookupResult.user!;
                    onAddContact(user);
                    setShowAddUserModal(false);
                    handleOpenPeerChat(user);
                  }}
                  className="min-h-[38px] px-3.5 rounded-xl bg-blue-600 text-white text-xs font-semibold shrink-0"
                >
                  Chat
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit Profile Modal */}
      {showProfileModal && (
        <div
          className={`${
            isMobileFrame ? 'absolute' : 'fixed'
          } inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-4`}
          onClick={() => setShowProfileModal(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Edit profile"
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#1C1C1E] border border-slate-200 dark:border-white/[0.1] p-5 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Your Messenger Profile
              </h2>
              <button
                type="button"
                onClick={() => setShowProfileModal(false)}
                aria-label="Close"
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-full text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500 dark:text-zinc-400 mb-1">
                  Display Name
                </label>
                <input
                  type="text"
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl bg-slate-100 dark:bg-black/60 border border-slate-200 dark:border-white/[0.1] text-sm text-slate-900 dark:text-white focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 dark:text-zinc-400 mb-1">
                  Unique Handle (others use this to add you)
                </label>
                <input
                  type="text"
                  value={profileHandle}
                  onChange={(e) => setProfileHandle(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl bg-slate-100 dark:bg-black/60 border border-slate-200 dark:border-white/[0.1] text-sm text-slate-900 dark:text-white focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setShowProfileModal(false)}
                className="min-h-[44px] rounded-xl bg-slate-100 dark:bg-zinc-800 text-sm font-medium text-slate-700 dark:text-zinc-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveProfile}
                className="min-h-[44px] rounded-xl bg-blue-600 text-white text-sm font-semibold"
              >
                Save
              </button>
            </div>

            {onEmailAuth && (
              <div className="pt-3 border-t border-slate-200 dark:border-white/[0.08] space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700 dark:text-zinc-200">
                    {firebaseEmail
                      ? `Synced: ${firebaseEmail}`
                      : isAnonymousUser
                      ? 'Backup / Sync Across Phones (Optional)'
                      : 'Sign In to Sync Chats'}
                  </span>
                  {firebaseEmail && onSignOutAuth && (
                    <button
                      type="button"
                      onClick={() => {
                        setAuthBusy(true);
                        void onSignOutAuth().finally(() => setAuthBusy(false));
                      }}
                      className="text-xs text-rose-500 font-medium"
                    >
                      Sign Out
                    </button>
                  )}
                </div>

                {!firebaseEmail && (
                  <>
                    <input
                      type="email"
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                      placeholder="Email address"
                      className="w-full h-10 px-3 rounded-xl bg-slate-100 dark:bg-black/60 border border-slate-200 dark:border-white/[0.1] text-xs text-slate-900 dark:text-white focus:outline-none"
                    />
                    <input
                      type="password"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      placeholder="Password (min 6 chars)"
                      className="w-full h-10 px-3 rounded-xl bg-slate-100 dark:bg-black/60 border border-slate-200 dark:border-white/[0.1] text-xs text-slate-900 dark:text-white focus:outline-none"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={authBusy || !authEmail.trim() || authPassword.length < 6}
                        onClick={() => {
                          setAuthBusy(true);
                          void onEmailAuth(authEmail, authPassword, false).finally(() =>
                            setAuthBusy(false)
                          );
                        }}
                        className="min-h-[38px] rounded-xl bg-slate-100 dark:bg-zinc-800 text-xs font-semibold text-slate-800 dark:text-white disabled:opacity-40"
                      >
                        Sign In
                      </button>
                      <button
                        type="button"
                        disabled={authBusy || !authEmail.trim() || authPassword.length < 6}
                        onClick={() => {
                          setAuthBusy(true);
                          void onEmailAuth(authEmail, authPassword, true).finally(() =>
                            setAuthBusy(false)
                          );
                        }}
                        className="min-h-[38px] rounded-xl bg-blue-600/15 text-blue-600 dark:text-blue-400 text-xs font-semibold disabled:opacity-40"
                      >
                        {isAnonymousUser ? 'Link / Save ID' : 'Create Account'}
                      </button>
                    </div>
                    {onGoogleAuth && (
                      <button
                        type="button"
                        disabled={authBusy}
                        onClick={() => {
                          setAuthBusy(true);
                          void onGoogleAuth().finally(() => setAuthBusy(false));
                        }}
                        className="w-full min-h-[38px] rounded-xl border border-slate-200 dark:border-white/[0.1] text-xs font-medium text-slate-700 dark:text-zinc-200"
                      >
                        Continue with Google
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Disguised Notification Modal */}
      {showNotifModal && (
        <div
          className={`${
            isMobileFrame ? 'absolute' : 'fixed'
          } inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-4`}
          onClick={() => setShowNotifModal(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Disguised notifications"
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#1C1C1E] border border-slate-200 dark:border-white/[0.1] p-5 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Disguised Notifications
              </h2>
              <button
                type="button"
                onClick={() => setShowNotifModal(false)}
                aria-label="Close"
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-full text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-100 dark:bg-black/60 border border-slate-200 dark:border-white/[0.08]">
              <div className="text-[11px] font-semibold text-slate-500 dark:text-zinc-400">
                NotePad · Reminder
              </div>
              <div className="text-sm font-medium text-slate-900 dark:text-white mt-0.5">
                You have a new note reminder
              </div>
            </div>

            <p className="text-xs text-slate-500 dark:text-zinc-400">
              Incoming messages trigger a discreet alert with no sender name or chat text shown. Install NotePad to your Home Screen for background alerts.
            </p>

            <div className="space-y-2">
              <button
                type="button"
                onClick={onToggleNotifications}
                className={`w-full min-h-[44px] rounded-xl text-sm font-semibold flex items-center justify-center gap-2 ${
                  notificationsEnabled && pushTokenReady
                    ? 'bg-emerald-600 text-white'
                    : notificationsEnabled
                    ? 'bg-amber-500 text-black'
                    : 'bg-blue-600 text-white'
                }`}
              >
                {notificationsEnabled && pushTokenReady ? (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Background Push Active</span>
                  </>
                ) : notificationsEnabled ? (
                  <>
                    <BellRing className="w-4 h-4" />
                    <span>Retry Background Push Setup</span>
                  </>
                ) : (
                  <>
                    <BellRing className="w-4 h-4" />
                    <span>Enable Push Notifications</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  onTestReminder();
                  setShowNotifModal(false);
                }}
                className="w-full min-h-[44px] rounded-xl bg-slate-100 dark:bg-zinc-800 text-sm font-medium text-slate-800 dark:text-white"
              >
                Test &ldquo;You have a new note reminder&rdquo;
              </button>

              <PWAInstallButton isMobileFrame={isMobileFrame} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
