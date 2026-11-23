import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  ChevronLeft,
  FilePlus2,
  LayoutGrid,
  List as ListIcon,
  MoreHorizontal,
  Settings,
  StickyNote,
  Trash2,
} from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import { FloatingBottomBar } from './components/FloatingBottomBar';
import { FoldersView } from './components/FoldersView';
import { MessengerWindow } from './components/MessengerWindow';
import { NoteCard } from './components/NoteCard';
import { NoteEditor } from './components/NoteEditor';
import { OfflineIndicator } from './components/OfflineIndicator';
import { SettingsView } from './components/SettingsView';
import { NoteTemplate, TemplatesSheet } from './components/TemplatesSheet';
import {
  auth,
  isFirebaseConfigured,
  testFirestoreConnection,
} from './lib/firebase';
import {
  attachForegroundMessageListener,
  deleteFirebaseDirectMessage,
  ensureFirebaseSignedIn,
  lookupFirebaseUser,
  markFirebaseChatDelivered,
  markFirebaseChatSeen,
  markMessageNotifiedInSw,
  registerFirebasePushNotifications,
  sendFirebaseDirectMessage,
  sendFirebaseTypingStatus,
  signInEmailPassword,
  signInGoogleAccount,
  signOutFirebaseAccount,
  startFirebasePresence,
  subscribeToFirebaseChats,
  subscribeToPeerPresence,
  syncActiveChatToSw,
  syncFirebaseUserProfile,
  syncMutePrefToSw,
  toggleFirebaseMessageReaction,
  warmupPushEndpoint,
} from './services/firebaseMessenger';
import {
  createInitialNotes,
  createSampleNotes,
  DEFAULT_FOLDERS,
  DEFAULT_SETTINGS,
} from './data/defaultNotes';
import {
  AppScreen,
  AppSettings,
  ChatReplyPreview,
  DirectMessage,
  MessengerUser,
  Note,
  NoteFolder,
} from './types/notes';
import {
  generateId,
  getAccentClasses,
  matchesQuery,
  sortNotes,
} from './utils/noteHelpers';

const NOTES_STORAGE_KEY = 'notepad_smart_notes_v2';
const SETTINGS_STORAGE_KEY = 'notepad_smart_settings_v2';
const FOLDERS_STORAGE_KEY = 'notepad_smart_folders_v2';
const MESSENGER_USER_KEY = 'notepad_messenger_user_v1';
const MESSENGER_CONTACTS_KEY = 'notepad_messenger_contacts_v1';
const MESSENGER_CONVS_KEY = 'notepad_messenger_convs_v1';
const NOTIF_PROMPT_DONE_KEY = 'notepad_notif_prompt_done_v1';
const MESSAGES_MUTED_KEY = 'notepad_messages_muted_v1';
const LEGACY_DEMO_USER_ID = 'demo-user';

function loadNotes(): Note[] {
  try {
    const raw = localStorage.getItem(NOTES_STORAGE_KEY);
    if (!raw) return createInitialNotes();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : createInitialNotes();
  } catch {
    return createInitialNotes();
  }
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function loadFolders(): NoteFolder[] {
  try {
    const raw = localStorage.getItem(FOLDERS_STORAGE_KEY);
    if (!raw) return DEFAULT_FOLDERS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_FOLDERS;
  } catch {
    return DEFAULT_FOLDERS;
  }
}

function loadOrCreateMessengerUser(): MessengerUser {
  try {
    const raw = localStorage.getItem(MESSENGER_USER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as MessengerUser;
      if (parsed && parsed.userId && parsed.handle) return parsed;
    }
  } catch {
    // Ignore parse errors
  }
  const suffix = Math.floor(1000 + Math.random() * 9000);
  const handle = `user-${suffix}`;
  const created: MessengerUser = {
    userId: handle,
    handle,
    displayName: `User ${suffix}`,
  };
  try {
    localStorage.setItem(MESSENGER_USER_KEY, JSON.stringify(created));
  } catch {
    // Ignore
  }
  return created;
}

function loadContacts(): MessengerUser[] {
  try {
    const raw = localStorage.getItem(MESSENGER_CONTACTS_KEY);
    const list = raw ? (JSON.parse(raw) as MessengerUser[]) : [];
    return Array.isArray(list)
      ? list.filter(
          (c) =>
            c &&
            c.userId !== LEGACY_DEMO_USER_ID &&
            c.handle !== LEGACY_DEMO_USER_ID
        )
      : [];
  } catch {
    return [];
  }
}

function loadConversations(): Record<string, DirectMessage[]> {
  try {
    const raw = localStorage.getItem(MESSENGER_CONVS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, DirectMessage[]>) : {};
    if (!parsed || typeof parsed !== 'object') return {};
    const cleaned: Record<string, DirectMessage[]> = {};
    for (const [dmId, msgs] of Object.entries(parsed)) {
      if (dmId.split('__').includes(LEGACY_DEMO_USER_ID)) continue;
      if (Array.isArray(msgs)) cleaned[dmId] = msgs;
    }
    return cleaned;
  } catch {
    return {};
  }
}

function makeDmId(userA: string, userB: string): string {
  return [userA, userB].sort().join('__');
}

export default function App() {
  const [notes, setNotes] = useState<Note[]>(loadNotes);
  const [folders, setFolders] = useState<NoteFolder[]>(loadFolders);
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [screen, setScreen] = useState<AppScreen>({ type: 'folders' });
  const [searchQuery, setSearchQuery] = useState('');
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showFolderMenu, setShowFolderMenu] = useState(false);
  const [pendingPermanentDeleteId, setPendingPermanentDeleteId] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    undoNoteId?: string;
  } | null>(null);

  // Messenger state
  const [messengerUser, setMessengerUser] = useState<MessengerUser>(loadOrCreateMessengerUser);
  const [contacts, setContacts] = useState<MessengerUser[]>(loadContacts);
  const [conversations, setConversations] =
    useState<Record<string, DirectMessage[]>>(loadConversations);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [onlineUserIds, setOnlineUserIds] = useState<string[]>([]);
  const [peerLastSeen, setPeerLastSeen] = useState<Record<string, number>>({});
  const [chatReceipts, setChatReceipts] = useState<
    Record<string, { deliveredAt: number; seenAt: number }>
  >({});
  const [typingFromUsers, setTypingFromUsers] = useState<Record<string, boolean>>({});
  const [wsConnected, setWsConnected] = useState(false);
  const [firebaseStatus, setFirebaseStatus] = useState<
    'ready' | 'anonymous-disabled' | 'permission-denied' | 'connecting' | 'local'
  >(() => (isFirebaseConfigured() ? 'connecting' : 'local'));
  const [firebaseEmail, setFirebaseEmail] = useState<string | null>(null);
  const [isAnonymousUser, setIsAnonymousUser] = useState<boolean>(true);
  const [activeChatPeerId, setActiveChatPeerId] = useState<string | null>(null);
  const [lookupResult, setLookupResult] = useState<{
    status: 'idle' | 'searching' | 'found' | 'not_found';
    user?: MessengerUser;
    query?: string;
  }>({ status: 'idle' });
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(() => {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted';
  });
  const [messagesMuted, setMessagesMuted] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MESSAGES_MUTED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [pushTokenReady, setPushTokenReady] = useState<boolean>(false);
  const [showNotifPrompt, setShowNotifPrompt] = useState<boolean>(() => {
    try {
      if (localStorage.getItem(NOTIF_PROMPT_DONE_KEY) === '1') {
        return false;
      }
      if (typeof Notification !== 'undefined' && Notification.permission !== 'default') {
        localStorage.setItem(NOTIF_PROMPT_DONE_KEY, '1');
        return false;
      }
    } catch {
      // Ignore storage errors
    }
    return true;
  });
  const [reminderBannerVisible, setReminderBannerVisible] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const knownFirebaseChatsRef = useRef<Set<string>>(new Set());
  const deliveredMarkRef = useRef<Record<string, number>>({});
  const seenMarkRef = useRef<Record<string, number>>({});
  const fcmTokenSavedRef = useRef<string | null>(null);
  const lastReminderAtRef = useRef<number>(0);
  const notifiedMsgIdsRef = useRef<Set<string>>(new Set());
  const screenRef = useRef<AppScreen>(screen);
  const activeChatPeerRef = useRef<string | null>(activeChatPeerId);
  const notificationsEnabledRef = useRef<boolean>(notificationsEnabled);
  const messagesMutedRef = useRef<boolean>(messagesMuted);
  const pushTokenReadyRef = useRef<boolean>(pushTokenReady);
  const lastFcmSyncAtRef = useRef<number>(0);

  screenRef.current = screen;
  activeChatPeerRef.current = activeChatPeerId;
  notificationsEnabledRef.current = notificationsEnabled;
  messagesMutedRef.current = messagesMuted;
  pushTokenReadyRef.current = pushTokenReady;

  const [isCompactViewport, setIsCompactViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );

  useEffect(() => {
    const handleResize = () => {
      setIsCompactViewport(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const accentStyle = getAccentClasses(settings.accent);
  const isMobileFrame = settings.desktopLayout === 'mobile-frame' && !isCompactViewport;

  // Persist notes, folders, settings
  useEffect(() => {
    try {
      localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(notes));
    } catch {
      // Ignore storage quota errors
    }
  }, [notes]);

  useEffect(() => {
    try {
      localStorage.setItem(FOLDERS_STORAGE_KEY, JSON.stringify(folders));
    } catch {
      // Ignore storage quota errors
    }
  }, [folders]);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Ignore storage quota errors
    }
  }, [settings]);

  useEffect(() => {
    try {
      localStorage.setItem(MESSENGER_USER_KEY, JSON.stringify(messengerUser));
    } catch {
      // Ignore
    }
  }, [messengerUser]);

  useEffect(() => {
    try {
      localStorage.setItem(MESSENGER_CONTACTS_KEY, JSON.stringify(contacts));
    } catch {
      // Ignore
    }
  }, [contacts]);

  useEffect(() => {
    try {
      const compactConvs: Record<string, DirectMessage[]> = {};
      for (const [dmId, msgs] of Object.entries(conversations)) {
        compactConvs[dmId] = msgs.length > 100 ? msgs.slice(-100) : msgs;
      }
      localStorage.setItem(MESSENGER_CONVS_KEY, JSON.stringify(compactConvs));
    } catch {
      // Ignore storage quota errors
    }
  }, [conversations]);

  // Persist conversations

  // Sync theme with <html class="dark">
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const applyTheme = () => {
      const useDark =
        settings.theme === 'dark' || (settings.theme === 'system' && media.matches);
      root.classList.toggle('dark', useDark);
    };

    applyTheme();
    media.addEventListener('change', applyTheme);
    return () => media.removeEventListener('change', applyTheme);
  }, [settings.theme]);

  // Auto-dismiss toast & reminder banner
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!reminderBannerVisible) return;
    const timer = window.setTimeout(() => setReminderBannerVisible(false), 4500);
    return () => window.clearTimeout(timer);
  }, [reminderBannerVisible]);

  const showToast = (message: string, undoNoteId?: string) => {
    setToast({ message, undoNoteId });
  };

  // Persist mute preference and sync to Service Worker cache
  useEffect(() => {
    try {
      localStorage.setItem(MESSAGES_MUTED_KEY, messagesMuted ? '1' : '0');
    } catch {
      // Ignore storage quota errors
    }
    syncMutePrefToSw(messagesMuted);
  }, [messagesMuted]);

  // Keep Service Worker aware of which chat box is currently open on screen
  useEffect(() => {
    const syncState = () => {
      const visible =
        document.visibilityState === 'visible' &&
        screen.type === 'messenger' &&
        Boolean(activeChatPeerId);
      syncActiveChatToSw(visible ? activeChatPeerId : null, visible);
    };
    const handleHide = () => syncActiveChatToSw(null, false);
    syncState();
    document.addEventListener('visibilitychange', syncState);
    window.addEventListener('pageshow', syncState);
    window.addEventListener('pagehide', handleHide);
    return () => {
      document.removeEventListener('visibilitychange', syncState);
      window.removeEventListener('pageshow', syncState);
      window.removeEventListener('pagehide', handleHide);
    };
  }, [screen.type, activeChatPeerId]);

  const playReminderChime = () => {
    if (messagesMutedRef.current || typeof window === 'undefined') return;
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(784, now);
      osc.frequency.setValueAtTime(988, now + 0.09);
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.3);
      window.setTimeout(() => {
        void ctx.close().catch(() => {});
      }, 400);
    } catch {
      // Ignore audio errors when autoplay is restricted
    }
  };

  const triggerDisguisedReminder = (
    fromPeerId?: string,
    forceTest = false,
    messageId?: string,
    shownInSw = false
  ) => {
    const isAppVisible = document.visibilityState === 'visible';

    if (!forceTest) {
      const isViewingSenderChat =
        isAppVisible &&
        screenRef.current.type === 'messenger' &&
        Boolean(activeChatPeerRef.current) &&
        (!fromPeerId || activeChatPeerRef.current === fromPeerId);
      if (isViewingSenderChat) {
        if (messageId) markMessageNotifiedInSw(messageId);
        return;
      }

      // While app is hidden/closing, let Service Worker + FCM Web Push deliver the OS notification.
      // Never mark messageId in SW while hidden, otherwise the SW will drop the incoming Web Push!
      if (!isAppVisible && !shownInSw && pushTokenReadyRef.current) {
        return;
      }

      if (messageId) {
        if (notifiedMsgIdsRef.current.has(messageId)) {
          return;
        }
        notifiedMsgIdsRef.current.add(messageId);
        if (notifiedMsgIdsRef.current.size > 200) {
          const first = notifiedMsgIdsRef.current.values().next().value;
          if (first) notifiedMsgIdsRef.current.delete(first);
        }
        if (isAppVisible) {
          markMessageNotifiedInSw(messageId);
        }
      } else {
        const now = Date.now();
        if (now - lastReminderAtRef.current < 3500) {
          return;
        }
        lastReminderAtRef.current = now;
      }
    }

    setReminderBannerVisible(true);
    if (shownInSw) {
      return;
    }

    if (isAppVisible && !messagesMutedRef.current) {
      playReminderChime();
    }

    if (
      notificationsEnabledRef.current &&
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted'
    ) {
      const isMuted = messagesMutedRef.current;
      const options: NotificationOptions = {
        body: 'You have a new note reminder',
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        tag: messageId ? `notepad-msg-${messageId}` : `notepad-reminder-${Date.now()}`,
        silent: isMuted,
      };
      if (!isAppVisible && 'serviceWorker' in navigator) {
        void navigator.serviceWorker.ready
          .then((reg) => reg.showNotification('NotePad', options))
          .catch(() => {});
        return;
      }
      try {
        new Notification('NotePad', options);
      } catch {
        if ('serviceWorker' in navigator) {
          void navigator.serviceWorker.ready
            .then((reg) => reg.showNotification('NotePad', options))
            .catch(() => {
              // Ignore notification errors in restricted contexts
            });
        }
      }
    }
  };

  // Initialize Firebase Auth, Firestore Realtime Chats, and FCM Push Listener
  useEffect(() => {
    if (!isFirebaseConfigured() || !auth) {
      setFirebaseStatus('local');
      return;
    }

    let cancelled = false;
    let unsubChats: (() => void) | null = null;
    let unsubPresence: (() => void) | null = null;
    let unsubForegroundPush: (() => void) | null = null;

    void testFirestoreConnection();

    void ensureFirebaseSignedIn().then((res) => {
      if (cancelled) return;
      if (!res.user && res.errorCode) {
        if (
          res.errorCode === 'auth/operation-not-allowed' ||
          res.errorCode === 'auth/admin-restricted-operation' ||
          res.errorCode === 'auth/configuration-not-found'
        ) {
          setFirebaseStatus('anonymous-disabled');
        } else {
          setFirebaseStatus('local');
        }
      }
    });

    void attachForegroundMessageListener((meta) => {
      if (!cancelled) {
        triggerDisguisedReminder(
          meta?.fromUserId,
          false,
          meta?.messageId,
          meta?.shownInSw
        );
      }
    }).then((unsub) => {
      if (cancelled) unsub();
      else unsubForegroundPush = unsub;
    });

    const unsubAuth = onAuthStateChanged(auth, async (fbUser) => {
      if (cancelled) return;

      if (unsubChats) {
        unsubChats();
        unsubChats = null;
      }
      if (unsubPresence) {
        unsubPresence();
        unsubPresence = null;
      }

      if (!fbUser) {
        setFirebaseEmail(null);
        setIsAnonymousUser(true);
        return;
      }

      setFirebaseEmail(fbUser.email ?? null);
      setIsAnonymousUser(fbUser.isAnonymous);

      try {
        const currentStored = loadOrCreateMessengerUser();
        const synced = await syncFirebaseUserProfile(
          fbUser.uid,
          currentStored.displayName,
          currentStored.handle
        );
        if (cancelled) return;

        setMessengerUser(synced);
        setFirebaseStatus('ready');
        unsubPresence = startFirebasePresence(fbUser.uid);

        if (
          typeof Notification !== 'undefined' &&
          Notification.permission === 'granted'
        ) {
          void registerFirebasePushNotifications(fbUser.uid).then((r) => {
            if (r.token && !cancelled) {
              fcmTokenSavedRef.current = fbUser.uid;
              setPushTokenReady(true);
            }
          });
        }

        unsubChats = subscribeToFirebaseChats(fbUser.uid, {
          onPeerProfile: (peer) => {
            if (cancelled || peer.userId === fbUser.uid) return;
            setContacts((prev) => {
              const existingIdx = prev.findIndex((c) => c.userId === peer.userId);
              if (existingIdx >= 0) {
                const updated = [...prev];
                updated[existingIdx] = peer;
                return updated;
              }
              return [peer, ...prev];
            });
            if (typeof peer.isOnline === 'boolean') {
              setOnlineUserIds((prev) => {
                const next = new Set(prev);
                if (peer.isOnline) next.add(peer.userId);
                else next.delete(peer.userId);
                return Array.from(next);
              });
            }
            if (typeof peer.lastSeen === 'number') {
              setPeerLastSeen((prev) => ({
                ...prev,
                [peer.userId]: peer.lastSeen!,
              }));
            }
          },
          onMessagesUpdate: (dmId, msgs) => {
            if (cancelled) return;
            setConversations((prev) => {
              const existing = prev[dmId] ?? [];
              const incomingIds = new Set(msgs.map((m) => m.id));
              const cutoff = Date.now() - 15_000;
              const pendingMine = existing.filter(
                (m) =>
                  m.fromUserId === fbUser.uid &&
                  !incomingIds.has(m.id) &&
                  m.createdAt >= cutoff
              );
              const merged =
                pendingMine.length > 0
                  ? [...msgs, ...pendingMine].sort(
                      (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)
                    )
                  : msgs;
              return {
                ...prev,
                [dmId]: merged,
              };
            });

            const incomingMsgs = msgs.filter((m) => m.fromUserId !== fbUser.uid);
            const latestIncoming = incomingMsgs[incomingMsgs.length - 1];
            if (latestIncoming && navigator.onLine) {
              const lastMarked = deliveredMarkRef.current[dmId] ?? 0;
              if (latestIncoming.createdAt > lastMarked) {
                deliveredMarkRef.current[dmId] = latestIncoming.createdAt;
                void markFirebaseChatDelivered(
                  fbUser.uid,
                  dmId,
                  latestIncoming.createdAt
                );
              }
              const isViewingThisThread =
                screenRef.current.type === 'messenger' &&
                activeChatPeerRef.current === latestIncoming.fromUserId &&
                document.visibilityState === 'visible';
              if (isViewingThisThread) {
                const lastSeenMarked = seenMarkRef.current[dmId] ?? 0;
                if (latestIncoming.createdAt > lastSeenMarked) {
                  seenMarkRef.current[dmId] = latestIncoming.createdAt;
                  void markFirebaseChatSeen(
                    fbUser.uid,
                    dmId,
                    latestIncoming.createdAt
                  );
                }
              }
            }
          },
          onNewIncomingMessage: (peerId, msg) => {
            if (cancelled) return;
            const isViewingThisThread =
              screenRef.current.type === 'messenger' &&
              activeChatPeerRef.current === peerId &&
              document.visibilityState === 'visible';

            if (!isViewingThisThread) {
              setUnreadCounts((prev) => ({
                ...prev,
                [peerId]: (prev[peerId] ?? 0) + 1,
              }));
              triggerDisguisedReminder(peerId, false, msg.id);
            } else {
              markMessageNotifiedInSw(msg.id);
            }
          },
          onChatMetaUpdate: (dmId, peerId, meta) => {
            if (cancelled) return;
            setChatReceipts((prev) => ({
              ...prev,
              [dmId]: {
                deliveredAt: Math.max(
                  prev[dmId]?.deliveredAt ?? 0,
                  meta.peerDeliveredAt
                ),
                seenAt: Math.max(prev[dmId]?.seenAt ?? 0, meta.peerSeenAt),
              },
            }));
            setTypingFromUsers((prev) => ({
              ...prev,
              [peerId]: meta.peerTyping,
            }));
          },
          onKnownChatsChange: (chatIds) => {
            knownFirebaseChatsRef.current = chatIds;
          },
          onRecovered: () => {
            if (!cancelled) {
              setFirebaseStatus('ready');
            }
          },
          onError: (err) => {
            const msg = err.message || '';
            if (msg.toLowerCase().includes('permission')) {
              setFirebaseStatus('permission-denied');
            }
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.toLowerCase().includes('permission')) {
          setFirebaseStatus('permission-denied');
        }
      }
    });

    return () => {
      cancelled = true;
      unsubAuth();
      if (unsubChats) unsubChats();
      if (unsubPresence) unsubPresence();
      if (unsubForegroundPush) unsubForegroundPush();
    };
  }, []);

  // Ensure FCM background push token stays registered & auto-heals across SW updates and re-opens
  useEffect(() => {
    if (firebaseStatus !== 'ready' || !auth?.currentUser) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
      return;
    }
    const uid = auth.currentUser.uid;
    if (fcmTokenSavedRef.current === uid) {
      setPushTokenReady(true);
    }

    let cancelled = false;
    const syncFcmToken = (force = false) => {
      if (cancelled || !navigator.onLine) return;
      const now = Date.now();
      if (
        !force &&
        fcmTokenSavedRef.current === uid &&
        now - lastFcmSyncAtRef.current < 120_000
      ) {
        return;
      }
      lastFcmSyncAtRef.current = now;
      void registerFirebasePushNotifications(uid).then((res) => {
        if (!cancelled && res.token) {
          fcmTokenSavedRef.current = uid;
          setPushTokenReady(true);
        }
      });
    };

    const handleVisibleSync = () => {
      if (document.visibilityState === 'visible') {
        syncFcmToken(false);
      }
    };

    const handleSwControllerChange = () => {
      syncFcmToken(true);
    };

    const handleFocusOrShow = () => syncFcmToken(false);
    const handleOnlineSync = () => syncFcmToken(true);

    syncFcmToken(fcmTokenSavedRef.current !== uid);
    const retryTimer = window.setTimeout(() => {
      if (fcmTokenSavedRef.current !== uid) {
        syncFcmToken(true);
      }
    }, 3000);

    window.addEventListener('focus', handleFocusOrShow);
    window.addEventListener('pageshow', handleFocusOrShow);
    window.addEventListener('online', handleOnlineSync);
    document.addEventListener('visibilitychange', handleVisibleSync);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener(
        'controllerchange',
        handleSwControllerChange
      );
    }

    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      window.removeEventListener('focus', handleFocusOrShow);
      window.removeEventListener('pageshow', handleFocusOrShow);
      window.removeEventListener('online', handleOnlineSync);
      document.removeEventListener('visibilitychange', handleVisibleSync);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener(
          'controllerchange',
          handleSwControllerChange
        );
      }
    };
  }, [firebaseStatus, notificationsEnabled]);

  // Auto-recover if a transient permission-denied happened before rules propagated or after sleep
  useEffect(() => {
    if (firebaseStatus !== 'permission-denied' || !auth?.currentUser) return;
    const attemptRecover = () => {
      const fbUser = auth?.currentUser;
      if (!fbUser || !navigator.onLine) return;
      const stored = loadOrCreateMessengerUser();
      void fbUser
        .getIdToken(true)
        .then(() =>
          syncFirebaseUserProfile(fbUser.uid, stored.displayName, stored.handle)
        )
        .then((synced) => {
          setMessengerUser(synced);
          setFirebaseStatus('ready');
        })
        .catch(() => {
          // Keep status until rules are available
        });
    };
    const timer = window.setTimeout(attemptRecover, 2000);
    window.addEventListener('focus', attemptRecover);
    window.addEventListener('online', attemptRecover);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', attemptRecover);
      window.removeEventListener('online', attemptRecover);
    };
  }, [firebaseStatus]);

  // Subscribe to real-time presence + lastSeen for every non-demo contact
  useEffect(() => {
    if (firebaseStatus !== 'ready') return;
    const unsubs: (() => void)[] = [];
    for (const c of contacts) {
      if (!c.userId) continue;
      unsubs.push(
        subscribeToPeerPresence(c.userId, ({ isOnline, lastSeen }) => {
          setOnlineUserIds((prev) => {
            const next = new Set(prev);
            if (isOnline) next.add(c.userId);
            else next.delete(c.userId);
            return Array.from(next);
          });
          if (typeof lastSeen === 'number') {
            setPeerLastSeen((prev) => ({ ...prev, [c.userId]: lastSeen }));
          }
        })
      );
    }
    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [contacts, firebaseStatus]);

  // Mark active chat messages as seen immediately when viewing thread or returning to tab
  useEffect(() => {
    if (screen.type !== 'messenger' || !activeChatPeerId) return;

    const markVisibleSeen = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      const dmId = makeDmId(messengerUser.userId, activeChatPeerId);
      const thread = conversations[dmId] ?? [];
      const incomingMsgs = thread.filter((m) => m.fromUserId !== messengerUser.userId);
      const latestIncoming = incomingMsgs[incomingMsgs.length - 1];

      if (firebaseStatus === 'ready' && auth?.currentUser && latestIncoming) {
        const lastMarked = seenMarkRef.current[dmId] ?? 0;
        if (latestIncoming.createdAt > lastMarked) {
          seenMarkRef.current[dmId] = latestIncoming.createdAt;
          void markFirebaseChatSeen(
            auth.currentUser.uid,
            dmId,
            latestIncoming.createdAt
          );
        }
      }

      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({ type: 'dm:seen', peerId: activeChatPeerId })
        );
      }
    };

    markVisibleSeen();
    document.addEventListener('visibilitychange', markVisibleSeen);
    window.addEventListener('focus', markVisibleSeen);
    return () => {
      document.removeEventListener('visibilitychange', markVisibleSeen);
      window.removeEventListener('focus', markVisibleSeen);
    };
  }, [
    screen.type,
    activeChatPeerId,
    conversations,
    messengerUser.userId,
    firebaseStatus,
  ]);

  // Persistent WebSocket connection for hidden Messenger & disguised notifications
  useEffect(() => {
    let active = true;
    let reconnectTimer: number | null = null;
    let retryDelay = 1000;

    const connect = () => {
      if (!active || !navigator.onLine) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!active) return;
        setWsConnected(true);
        retryDelay = 1000;
        ws.send(
          JSON.stringify({
            type: 'auth:register',
            userId: messengerUser.userId,
            handle: messengerUser.handle,
            displayName: messengerUser.displayName,
          })
        );
      };

      ws.onmessage = (event) => {
        if (!active) return;
        try {
          const data = JSON.parse(event.data as string);

          if (data.type === 'auth:ready') {
            if (data.conversations && typeof data.conversations === 'object') {
              const serverConvs = data.conversations as Record<string, DirectMessage[]>;
              setConversations((prev) => {
                const merged: Record<string, DirectMessage[]> = { ...prev };
                for (const [dmId, msgs] of Object.entries(serverConvs)) {
                  if (!Array.isArray(msgs) || msgs.length === 0) continue;
                  const map = new Map<string, DirectMessage>();
                  for (const m of merged[dmId] ?? []) map.set(m.id, m);
                  for (const m of msgs) map.set(m.id, m);
                  merged[dmId] = Array.from(map.values()).sort(
                    (a, b) => a.createdAt - b.createdAt
                  );
                }
                return merged;
              });
            }
            if (Array.isArray(data.peers)) {
              setContacts((prev) => {
                const map = new Map(prev.map((c) => [c.userId, c]));
                (data.peers as MessengerUser[]).forEach((p) => {
                  if (p.userId !== messengerUser.userId) map.set(p.userId, p);
                });
                return Array.from(map.values());
              });
            }
          } else if (data.type === 'presence:list' && Array.isArray(data.onlineUserIds)) {
            if (firebaseStatus !== 'ready') {
              const list = (data.onlineUserIds as string[]).filter(
                (id) => id !== LEGACY_DEMO_USER_ID
              );
              setOnlineUserIds(list);
              if (data.lastSeenMap && typeof data.lastSeenMap === 'object') {
                setPeerLastSeen((prev) => ({
                  ...prev,
                  ...(data.lastSeenMap as Record<string, number>),
                }));
              }
            }
          } else if (data.type === 'dm:receipt' && data.dmId) {
            const dmId = String(data.dmId);
            const deliveredAt =
              typeof data.deliveredAt === 'number' ? data.deliveredAt : 0;
            const seenAt = typeof data.seenAt === 'number' ? data.seenAt : 0;
            setChatReceipts((prev) => ({
              ...prev,
              [dmId]: {
                deliveredAt: Math.max(prev[dmId]?.deliveredAt ?? 0, deliveredAt),
                seenAt: Math.max(prev[dmId]?.seenAt ?? 0, seenAt),
              },
            }));
            setConversations((prev) => ({
              ...prev,
              [dmId]: (prev[dmId] ?? []).map((m) =>
                m.fromUserId === messengerUser.userId
                  ? {
                      ...m,
                      deliveredAt: m.deliveredAt ?? (deliveredAt || undefined),
                      seenAt: m.seenAt ?? (seenAt || undefined),
                    }
                  : m
              ),
            }));
          } else if (data.type === 'user:found' && data.user) {
            setLookupResult({ status: 'found', user: data.user as MessengerUser });
          } else if (data.type === 'user:not_found') {
            setLookupResult({ status: 'not_found', query: String(data.query || '') });
          } else if (data.type === 'dm:init' && data.dmId && Array.isArray(data.messages)) {
            const serverMsgs = data.messages as DirectMessage[];
            if (serverMsgs.length > 0) {
              setConversations((prev) => {
                const map = new Map<string, DirectMessage>();
                for (const m of prev[data.dmId] ?? []) map.set(m.id, m);
                for (const m of serverMsgs) map.set(m.id, m);
                return {
                  ...prev,
                  [data.dmId]: Array.from(map.values()).sort(
                    (a, b) => a.createdAt - b.createdAt
                  ),
                };
              });
            }
          } else if (data.type === 'dm:message' && data.dmId && data.message) {
            const msg = data.message as DirectMessage;
            setConversations((prev) => {
              const existing = prev[data.dmId] ?? [];
              if (existing.some((m) => m.id === msg.id)) return prev;
              return { ...prev, [data.dmId]: [...existing, msg] };
            });

            if (msg.fromUserId !== messengerUser.userId) {
              if (data.fromUser) {
                const sender = data.fromUser as MessengerUser;
                setContacts((prev) => {
                  if (prev.some((c) => c.userId === sender.userId)) return prev;
                  return [sender, ...prev];
                });
              }

              const isViewingThisThread =
                screenRef.current.type === 'messenger' &&
                activeChatPeerRef.current === msg.fromUserId &&
                document.visibilityState === 'visible';

              if (isViewingThisThread && wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(
                  JSON.stringify({ type: 'dm:seen', peerId: msg.fromUserId })
                );
              } else if (!isViewingThisThread) {
                setUnreadCounts((prev) => ({
                  ...prev,
                  [msg.fromUserId]: (prev[msg.fromUserId] ?? 0) + 1,
                }));
                triggerDisguisedReminder(msg.fromUserId, false, msg.id);
              }
            }
          } else if (data.type === 'dm:updated' && data.dmId && data.message) {
            const updated = data.message as DirectMessage;
            setConversations((prev) => ({
              ...prev,
              [data.dmId]: (prev[data.dmId] ?? []).map((m) =>
                m.id === updated.id ? updated : m
              ),
            }));
          } else if (data.type === 'dm:deleted' && data.dmId && data.messageId) {
            setConversations((prev) => ({
              ...prev,
              [data.dmId]: (prev[data.dmId] ?? []).map((m) =>
                m.id === data.messageId
                  ? {
                      ...m,
                      text: '',
                      unsent: true,
                      unsentAt: Date.now(),
                      replyTo: undefined,
                      reactions: [],
                    }
                  : m
              ),
            }));
          } else if (data.type === 'dm:typing' && data.fromUserId) {
            setTypingFromUsers((prev) => ({
              ...prev,
              [data.fromUserId]: Boolean(data.isTyping),
            }));
          }
        } catch {
          // Ignore malformed WS frames
        }
      };

      ws.onclose = () => {
        if (!active) return;
        setWsConnected(false);
        if (!navigator.onLine) return;
        reconnectTimer = window.setTimeout(() => {
          retryDelay = Math.min(retryDelay * 1.5, 6000);
          connect();
        }, retryDelay);
      };

      ws.onerror = () => ws.close();
    };

    const handleOffline = () => {
      setWsConnected(false);
      wsRef.current?.close();
    };

    const handleOnline = () => {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
        connect();
      }
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    connect();

    return () => {
      active = false;
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [messengerUser.userId, messengerUser.handle, messengerUser.displayName, firebaseStatus]);

  const updateSettings = (patch: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  };

  const activeNote = useMemo(
    () => notes.find((n) => n.id === activeNoteId) ?? null,
    [notes, activeNoteId]
  );

  // Global search results when searching from Folders root
  const globalSearchNotes = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const active = notes.filter((n) => !n.trashed && !n.archived);
    return sortNotes(
      active.filter((n) => matchesQuery(n, searchQuery)),
      settings.sortBy
    );
  }, [notes, searchQuery, settings.sortBy]);

  // Folder notes list
  const folderNotes = useMemo(() => {
    if (screen.type !== 'folder') return [];
    let base: Note[] = [];
    if (screen.folderId === 'all') {
      base = notes.filter((n) => !n.trashed && !n.archived);
    } else if (screen.folderId === 'tasks') {
      base = notes.filter((n) => !n.trashed && !n.archived && n.checklist.length > 0);
    } else if (screen.folderId === 'archive') {
      base = notes.filter((n) => n.archived && !n.trashed);
    } else if (screen.folderId === 'trash') {
      base = notes.filter((n) => n.trashed);
    } else {
      base = notes.filter((n) => !n.trashed && !n.archived && n.folder === screen.folderId);
    }

    const searched = base.filter((n) => matchesQuery(n, searchQuery));
    return sortNotes(searched, settings.sortBy);
  }, [notes, screen, searchQuery, settings.sortBy]);

  const pinnedNotes = useMemo(() => {
    if (screen.type !== 'folder') return [];
    if (screen.folderId === 'archive' || screen.folderId === 'trash') return [];
    return folderNotes.filter((n) => n.pinned);
  }, [folderNotes, screen]);

  const regularNotes = useMemo(() => {
    if (screen.type !== 'folder') return [];
    if (screen.folderId === 'archive' || screen.folderId === 'trash') return folderNotes;
    return folderNotes.filter((n) => !n.pinned);
  }, [folderNotes, screen]);

  const currentFolderTitle = useMemo(() => {
    if (screen.type !== 'folder') return 'Folders';
    if (screen.folderId === 'all') return 'All Notes';
    if (screen.folderId === 'tasks') return 'Smart Checklists';
    if (screen.folderId === 'archive') return 'Archive';
    if (screen.folderId === 'trash') return 'Recently Deleted';
    return folders.find((f) => f.id === screen.folderId)?.label ?? 'Notes';
  }, [screen, folders]);

  const handleCreateFolder = (label: string) => {
    const newFolder: NoteFolder = {
      id: `folder-${generateId().slice(0, 8)}`,
      label,
    };
    setFolders((prev) => [...prev, newFolder]);
    showToast(`Created "${label}"`);
  };

  const handleRenameFolder = (id: string, label: string) => {
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, label } : f)));
  };

  const handleDeleteFolder = (id: string) => {
    setFolders((prev) => prev.filter((f) => f.id !== id));
    setNotes((prev) =>
      prev.map((n) => (n.folder === id ? { ...n, folder: 'notes' } : n))
    );
    showToast('Folder removed — notes moved to Notes');
  };

  const handleCreateNote = (template?: NoteTemplate) => {
    const now = Date.now();
    const targetFolder =
      template?.folder ??
      (screen.type === 'folder' &&
      !['all', 'tasks', 'archive', 'trash'].includes(screen.folderId)
        ? screen.folderId
        : settings.defaultFolder);

    const isTasksContext = screen.type === 'folder' && screen.folderId === 'tasks';

    const newNote: Note = {
      id: generateId(),
      title: template?.title ?? '',
      body: template?.body ?? '',
      checklist: template
        ? template.checklist.map((text) => ({
            id: generateId(),
            text,
            done: false,
          }))
        : isTasksContext
        ? [{ id: generateId(), text: '', done: false }]
        : [],
      folder: targetFolder,
      color: 'default',
      pinned: false,
      archived: false,
      trashed: false,
      createdAt: now,
      updatedAt: now,
    };
    setNotes((prev) => [newNote, ...prev]);
    setActiveNoteId(newNote.id);
  };

  const handleUpdateNote = (updated: Note) => {
    setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
  };

  const handleTogglePin = (id: string) => {
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, pinned: !n.pinned, updatedAt: Date.now() } : n))
    );
  };

  const handleToggleChecklistItem = (noteId: string, itemId: string) => {
    setNotes((prev) =>
      prev.map((n) =>
        n.id === noteId
          ? {
              ...n,
              updatedAt: Date.now(),
              checklist: n.checklist.map((item) =>
                item.id === itemId ? { ...item, done: !item.done } : item
              ),
            }
          : n
      )
    );
  };

  const handleDuplicateNote = (source: Note) => {
    const now = Date.now();
    const copy: Note = {
      ...source,
      id: generateId(),
      title: source.title ? `${source.title} (Copy)` : 'Untitled Copy',
      pinned: false,
      checklist: source.checklist.map((c) => ({ ...c, id: generateId() })),
      createdAt: now,
      updatedAt: now,
    };
    setNotes((prev) => [copy, ...prev]);
    setActiveNoteId(copy.id);
    showToast('Duplicated note');
  };

  const handleTrashNote = (id: string) => {
    setNotes((prev) =>
      prev.map((n) =>
        n.id === id
          ? { ...n, trashed: true, pinned: false, trashedAt: Date.now() }
          : n
      )
    );
    if (activeNoteId === id) {
      setActiveNoteId(null);
    }
    showToast('Moved to Recently Deleted', id);
  };

  const handleRestoreNote = (id: string) => {
    setNotes((prev) =>
      prev.map((n) =>
        n.id === id
          ? { ...n, trashed: false, archived: false, trashedAt: undefined }
          : n
      )
    );
    showToast('Note restored');
  };

  const handlePermanentDelete = (id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    if (activeNoteId === id) {
      setActiveNoteId(null);
    }
    setPendingPermanentDeleteId(null);
    showToast('Deleted permanently');
  };

  const handleRequestPermanentDelete = (id: string) => {
    if (settings.confirmDelete) {
      setPendingPermanentDeleteId(id);
    } else {
      handlePermanentDelete(id);
    }
  };

  const handleExportBackup = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      folders,
      notes,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `notepad-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Backup exported');
  };

  const handleImportBackup = (imported: Note[]) => {
    setNotes((prev) => {
      const existingIds = new Set(prev.map((n) => n.id));
      const merged = [...prev];
      imported.forEach((item) => {
        if (!existingIds.has(item.id)) {
          merged.push(item);
        } else {
          merged.push({ ...item, id: generateId() });
        }
      });
      return merged;
    });
  };

  const handleEmptyTrash = () => {
    setNotes((prev) => prev.filter((n) => !n.trashed));
    showToast('Recently Deleted emptied');
  };

  const handleResetSamples = () => {
    const samples = createSampleNotes().map((n) => ({ ...n, id: generateId() }));
    setNotes((prev) => [...samples, ...prev]);
    showToast('Starter notes added');
  };

  // Messenger handlers
  const handleToggleNotifications = async () => {
    if (typeof Notification === 'undefined') {
      const isIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
      showToast(
        isIOS
          ? 'iPhone-এ নোটিফিকেশন পেতে Share → Add to Home Screen থেকে ওপেন করে Allow করুন'
          : 'Browser notifications are not supported here'
      );
      return;
    }

    try {
      localStorage.setItem(NOTIF_PROMPT_DONE_KEY, '1');
    } catch {
      // Ignore storage error
    }

    if (Notification.permission === 'granted' && notificationsEnabled && pushTokenReady) {
      setNotificationsEnabled(false);
      showToast('Notifications paused');
      return;
    }

    if (firebaseStatus === 'ready' && auth?.currentUser) {
      const uid = auth.currentUser.uid;
      const result = await registerFirebasePushNotifications(uid);
      if (result.token) {
        setNotificationsEnabled(true);
        fcmTokenSavedRef.current = uid;
        setPushTokenReady(true);
        showToast('Background push notifications active');
      } else if (result.reason === 'denied') {
        setNotificationsEnabled(false);
        setPushTokenReady(false);
        showToast('Notification permission denied');
      } else if (Notification.permission === 'granted') {
        setNotificationsEnabled(true);
        setPushTokenReady(false);
        showToast('Foreground alerts on — tap Retry if closed alerts fail');
      } else {
        showToast('Background push unavailable on this browser');
      }
      return;
    }

    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      setNotificationsEnabled(true);
      if (auth?.currentUser) {
        const uid = auth.currentUser.uid;
        void registerFirebasePushNotifications(uid).then((res) => {
          if (res.token) {
            fcmTokenSavedRef.current = uid;
            setPushTokenReady(true);
          }
        });
      }
      showToast('Notifications enabled');
    } else {
      setNotificationsEnabled(false);
      showToast('Notification permission denied');
    }
  };

  const shellContent = (
    <div
      className={`relative flex flex-col bg-[#f2f2f7] dark:bg-black text-slate-900 dark:text-white transition-colors duration-150 ${
        isMobileFrame
          ? `h-[844px] max-h-[94vh] w-full max-w-[412px] ${
              screen.type === 'messenger' ? 'overflow-hidden no-scrollbar' : 'overflow-y-auto'
            } md:rounded-[2.4rem] md:border md:border-slate-300 dark:md:border-white/[0.12] md:shadow-2xl`
          : screen.type === 'messenger'
          ? 'h-[100dvh] overflow-hidden no-scrollbar w-full'
          : 'min-h-[100dvh] w-full'
      }`}
    >
      <OfflineIndicator isMobileFrame={isMobileFrame} />

      {/* Disguised Top Notification Banner ("You have a new note reminder") */}
      {reminderBannerVisible && (
        <div
          role="alert"
          onClick={() => setReminderBannerVisible(false)}
          className={`${
            isMobileFrame ? 'sticky top-2 mx-3' : 'fixed top-3 left-1/2 -translate-x-1/2 w-[92%] max-w-sm'
          } z-50 rounded-2xl bg-white/95 dark:bg-[#1C1C1E]/95 backdrop-blur-xl border border-slate-200 dark:border-white/[0.12] px-4 py-3 shadow-2xl flex items-center gap-3 cursor-pointer`}
        >
          <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-[#E5A91A] flex items-center justify-center shrink-0">
            <Bell className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold text-slate-500 dark:text-zinc-400">
              NotePad · Now
            </div>
            <div className="text-sm font-medium text-slate-900 dark:text-white truncate">
              You have a new note reminder
            </div>
          </div>
        </div>
      )}

      {activeNote ? (
        <NoteEditor
          note={activeNote}
          folders={folders}
          settings={settings}
          isMobileFrame={isMobileFrame}
          onBack={() => setActiveNoteId(null)}
          onChange={handleUpdateNote}
          onDuplicate={handleDuplicateNote}
          onTrash={handleTrashNote}
          onRestore={handleRestoreNote}
          onPermanentDelete={handlePermanentDelete}
          onShowToast={(msg) => showToast(msg)}
        />
      ) : screen.type === 'messenger' ? (
        <MessengerWindow
          currentUser={
            auth?.currentUser &&
            (firebaseStatus === 'ready' || firebaseStatus === 'permission-denied')
              ? { ...messengerUser, userId: auth.currentUser.uid }
              : messengerUser
          }
          contacts={contacts}
          conversations={conversations}
          unreadCounts={unreadCounts}
          onlineUserIds={onlineUserIds}
          peerLastSeen={peerLastSeen}
          chatReceipts={chatReceipts}
          typingFromUsers={typingFromUsers}
          wsConnected={wsConnected}
          firebaseStatus={firebaseStatus}
          firebaseEmail={firebaseEmail}
          isAnonymousUser={isAnonymousUser}
          lookupResult={lookupResult}
          notificationsEnabled={notificationsEnabled}
          messagesMuted={messagesMuted}
          pushTokenReady={pushTokenReady}
          accent={settings.accent}
          fontStyle={settings.fontStyle}
          isMobileFrame={isMobileFrame}
          onExitToNotes={() => {
            setActiveChatPeerId(null);
            setScreen({ type: 'folders' });
          }}
          onUpdateProfile={(displayName, handle) => {
            if (firebaseStatus === 'ready' && auth?.currentUser) {
              void syncFirebaseUserProfile(
                auth.currentUser.uid,
                displayName,
                handle
              )
                .then((synced) => {
                  setMessengerUser(synced);
                  showToast(`Saved @${synced.handle}`);
                })
                .catch(() => {
                  showToast('Could not update profile');
                });
              return;
            }

            const oldUserId = messengerUser.userId;
            if (oldUserId !== handle) {
              setConversations((prev) => {
                const next: Record<string, DirectMessage[]> = {};
                for (const [dmId, msgs] of Object.entries(prev)) {
                  const parts = dmId.split('__');
                  if (!parts.includes(oldUserId)) {
                    next[dmId] = msgs;
                    continue;
                  }
                  const otherId = parts.find((p) => p !== oldUserId) ?? oldUserId;
                  const newDmId = makeDmId(handle, otherId);
                  next[newDmId] = msgs.map((m) => ({
                    ...m,
                    dmId: newDmId,
                    fromUserId: m.fromUserId === oldUserId ? handle : m.fromUserId,
                    toUserId: m.toUserId === oldUserId ? handle : m.toUserId,
                    senderName: m.fromUserId === oldUserId ? displayName : m.senderName,
                  }));
                }
                return next;
              });
            }
            setMessengerUser({
              userId: handle,
              handle,
              displayName,
            });
          }}
          onEmailAuth={async (email, password, isCreate) => {
            try {
              await signInEmailPassword(email, password, isCreate);
              showToast(isCreate ? 'Account saved' : 'Signed in');
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Auth failed';
              showToast(msg.replace(/^Firebase:\s*/i, ''));
            }
          }}
          onGoogleAuth={async () => {
            try {
              await signInGoogleAccount();
              showToast('Signed in with Google');
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Google sign-in failed';
              showToast(msg.replace(/^Firebase:\s*/i, ''));
            }
          }}
          onSignOutAuth={async () => {
            await signOutFirebaseAccount();
            showToast('Signed out');
          }}
          onLookupUser={(query) => {
            setLookupResult({ status: 'searching', query });
            if (firebaseStatus === 'ready') {
              void lookupFirebaseUser(query)
                .then((found) => {
                  if (found) {
                    setLookupResult({ status: 'found', user: found });
                  } else if (wsRef.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({ type: 'user:lookup', query }));
                  } else {
                    setLookupResult({ status: 'not_found', query });
                  }
                })
                .catch(() => {
                  setLookupResult({ status: 'not_found', query });
                });
              return;
            }
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'user:lookup', query }));
            } else {
              setLookupResult({ status: 'not_found', query });
            }
          }}
          onResetLookup={() => setLookupResult({ status: 'idle' })}
          onAddContact={(user) => {
            if (user.userId === messengerUser.userId) {
              showToast('You cannot add your own ID');
              return;
            }
            setContacts((prev) => {
              if (prev.some((c) => c.userId === user.userId)) return prev;
              return [user, ...prev];
            });
            showToast(`Added ${user.displayName}`);
          }}
          onRemoveContact={(userId) => {
            setContacts((prev) => prev.filter((c) => c.userId !== userId));
          }}
          onOpenChat={(peerId) => {
            setActiveChatPeerId(peerId);
            setUnreadCounts((prev) => {
              if (!prev[peerId]) return prev;
              const next = { ...prev };
              delete next[peerId];
              return next;
            });
            if (firebaseStatus === 'ready') {
              void warmupPushEndpoint(peerId);
            }
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'dm:join', peerId }));
            }
          }}
          onCloseChat={() => setActiveChatPeerId(null)}
          onSendMessage={(
            toUserId,
            text,
            replyTo?: ChatReplyPreview,
            imageUrl?: string,
            voiceUrl?: string,
            voiceDuration?: number
          ) => {
            const useFirebase =
              Boolean(auth?.currentUser) &&
              (firebaseStatus === 'ready' || firebaseStatus === 'permission-denied');
            const senderUid =
              useFirebase && auth?.currentUser
                ? auth.currentUser.uid
                : messengerUser.userId;
            const dmId = makeDmId(senderUid, toUserId);
            const messageId = generateId();
            const existingThread = conversations[dmId] ?? [];
            const lastMsgTs =
              existingThread.length > 0
                ? existingThread[existingThread.length - 1].createdAt
                : 0;
            const createdAt = Math.max(Date.now(), lastMsgTs + 1);
            const msg: DirectMessage = {
              id: messageId,
              dmId,
              fromUserId: senderUid,
              toUserId,
              senderName: messengerUser.displayName,
              text,
              ...(imageUrl ? { imageUrl } : {}),
              ...(voiceUrl ? { voiceUrl } : {}),
              ...(typeof voiceDuration === 'number' ? { voiceDuration } : {}),
              createdAt,
              replyTo,
              reactions: [],
            };
            setConversations((prev) => ({
              ...prev,
              [dmId]: [...(prev[dmId] ?? []), msg],
            }));

            if (useFirebase && auth?.currentUser) {
              void sendFirebaseDirectMessage({
                myUid: auth.currentUser.uid,
                myName: messengerUser.displayName,
                peerUid: toUserId,
                text,
                messageId,
                createdAt,
                imageUrl,
                voiceUrl,
                voiceDuration,
                replyTo,
                chatAlreadyExists: knownFirebaseChatsRef.current.has(dmId),
              })
                .then(() => {
                  setFirebaseStatus('ready');
                })
                .catch((err) => {
                  const errMsg = err instanceof Error ? err.message : '';
                  if (errMsg.toLowerCase().includes('permission')) {
                    setFirebaseStatus('permission-denied');
                  }
                  showToast('Failed to send via Firebase');
                });
              return;
            }

            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(
                JSON.stringify({
                  type: 'dm:send',
                  toUserId,
                  message: msg,
                })
              );
            }
          }}
          onReactMessage={(dmId, messageId, emoji) => {
            const currentMsg = (conversations[dmId] ?? []).find(
              (m) => m.id === messageId
            );
            setConversations((prev) => ({
              ...prev,
              [dmId]: (prev[dmId] ?? []).map((m) => {
                if (m.id !== messageId) return m;
                const reactions = m.reactions ? [...m.reactions] : [];
                const idx = reactions.findIndex((r) => r.emoji === emoji);
                if (idx >= 0) {
                  const entry = reactions[idx];
                  if (entry.userIds.includes(messengerUser.userId)) {
                    const nextIds = entry.userIds.filter((id) => id !== messengerUser.userId);
                    if (nextIds.length === 0) reactions.splice(idx, 1);
                    else reactions[idx] = { ...entry, userIds: nextIds };
                  } else {
                    reactions[idx] = {
                      ...entry,
                      userIds: [...entry.userIds, messengerUser.userId],
                    };
                  }
                } else {
                  reactions.push({ emoji, userIds: [messengerUser.userId] });
                }
                return { ...m, reactions };
              }),
            }));

            if (firebaseStatus === 'ready' && auth?.currentUser) {
              void toggleFirebaseMessageReaction(
                auth.currentUser.uid,
                dmId,
                messageId,
                emoji,
                currentMsg?.reactions ?? []
              ).catch(() => {
                // Ignore reaction sync error
              });
              return;
            }

            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(
                JSON.stringify({
                  type: 'dm:react',
                  dmId,
                  messageId,
                  emoji,
                })
              );
            }
          }}
          onDeleteMessage={(dmId, messageId) => {
            const now = Date.now();
            setConversations((prev) => ({
              ...prev,
              [dmId]: (prev[dmId] ?? []).map((m) =>
                m.id === messageId
                  ? {
                      ...m,
                      text: '',
                      imageUrl: undefined,
                      voiceUrl: undefined,
                      voiceDuration: undefined,
                      unsent: true,
                      unsentAt: now,
                      replyTo: undefined,
                      reactions: [],
                    }
                  : m
              ),
            }));

            if (firebaseStatus === 'ready' && auth?.currentUser) {
              void deleteFirebaseDirectMessage(dmId, messageId).catch(() => {
                showToast('Only the sender can unsend this message');
              });
              return;
            }

            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(
                JSON.stringify({
                  type: 'dm:delete',
                  dmId,
                  messageId,
                })
              );
            }
          }}
          onTyping={(toUserId, isTyping) => {
            if (firebaseStatus === 'ready' && auth?.currentUser) {
              void sendFirebaseTypingStatus(
                auth.currentUser.uid,
                toUserId,
                isTyping
              );
            }
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(
                JSON.stringify({
                  type: 'dm:typing',
                  toUserId,
                  isTyping,
                })
              );
            }
          }}
          onToggleNotifications={handleToggleNotifications}
          onToggleMute={() => {
            setMessagesMuted((prev) => {
              const next = !prev;
              showToast(next ? 'Messages muted (no sound)' : 'Message sound enabled');
              return next;
            });
          }}
          onTestReminder={() => triggerDisguisedReminder(undefined, true)}
          onShowToast={(msg) => showToast(msg)}
        />
      ) : screen.type === 'settings' ? (
        <SettingsView
          settings={settings}
          folders={folders}
          notes={notes}
          onBack={() => setScreen({ type: 'folders' })}
          onUpdateSettings={updateSettings}
          onExportBackup={handleExportBackup}
          onImportBackup={handleImportBackup}
          onEmptyTrash={handleEmptyTrash}
          onResetSamples={handleResetSamples}
          onShowToast={(msg) => showToast(msg)}
        />
      ) : screen.type === 'folders' ? (
        <>
          {searchQuery.trim() ? (
            <div className="flex-1 flex flex-col">
              <header className="sticky top-0 z-30 h-[56px] px-4 flex items-center justify-between bg-[#f2f2f7]/90 dark:bg-black/90 backdrop-blur-xl">
                <span className="text-[17px] font-bold text-slate-900 dark:text-white">
                  Search Results
                </span>
                <span className="text-xs text-slate-500 dark:text-zinc-400 tabular-nums">
                  {globalSearchNotes.length}{' '}
                  {globalSearchNotes.length === 1 ? 'note' : 'notes'}
                </span>
              </header>

              <main className="flex-1 px-4 pb-24 space-y-2.5">
                {globalSearchNotes.length === 0 ? (
                  <div className="py-28 flex flex-col items-center justify-center text-center">
                    <StickyNote className="w-11 h-11 text-slate-400 dark:text-zinc-500 mb-3" strokeWidth={1.6} />
                    <p className="text-[17px] font-semibold text-slate-700 dark:text-white">
                      No Matching Notes
                    </p>
                  </div>
                ) : (
                  <div
                    className={
                      settings.viewMode === 'list'
                        ? 'grid grid-cols-1 gap-2.5'
                        : isMobileFrame
                        ? 'grid grid-cols-2 gap-2.5'
                        : 'grid grid-cols-2 md:grid-cols-3 gap-3'
                    }
                  >
                    {globalSearchNotes.map((note) => (
                      <NoteCard
                        key={note.id}
                        note={note}
                        folders={folders}
                        viewMode={settings.viewMode}
                        fontStyle={settings.fontStyle}
                        accent={settings.accent}
                        showPreviews={settings.showPreviews}
                        showStats={settings.showStats}
                        moveCheckedToBottom={settings.moveCheckedToBottom}
                        onOpen={(n) => setActiveNoteId(n.id)}
                        onTogglePin={handleTogglePin}
                        onToggleChecklistItem={handleToggleChecklistItem}
                      />
                    ))}
                  </div>
                )}
              </main>
            </div>
          ) : (
            <FoldersView
              folders={folders}
              notes={notes}
              accent={settings.accent}
              isMobileFrame={isMobileFrame}
              onOpenFolder={(folderId) => {
                setSearchQuery('');
                setScreen({ type: 'folder', folderId });
              }}
              onOpenMessenger={() => {
                setSearchQuery('');
                setScreen({ type: 'messenger' });
              }}
              onOpenSettings={() => setScreen({ type: 'settings' })}
              onCreateFolder={handleCreateFolder}
              onRenameFolder={handleRenameFolder}
              onDeleteFolder={handleDeleteFolder}
            />
          )}

          <FloatingBottomBar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onCompose={() => handleCreateNote()}
            onVoiceError={(msg) => showToast(msg)}
            accent={settings.accent}
            isMobileFrame={isMobileFrame}
          />
        </>
      ) : (
        /* Normal Notes Folder View (IMG_6760 / IMG_6759) */
        <div
          className="flex-1 flex flex-col"
          onClick={() => setShowFolderMenu(false)}
        >
          <header className="sticky top-0 z-30 min-h-[calc(60px+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] px-4 flex items-center justify-between gap-2 bg-[#f2f2f7]/90 dark:bg-black/90 backdrop-blur-xl">
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setShowFolderMenu(false);
                setScreen({ type: 'folders' });
              }}
              aria-label="Back to Folders"
              className="h-11 w-11 rounded-full bg-white dark:bg-[#1C1C1E] border border-slate-200/80 dark:border-white/[0.1] flex items-center justify-center text-slate-800 dark:text-white shadow-xs transition-transform active:scale-95"
            >
              <ChevronLeft className="w-5 h-5" strokeWidth={2.1} />
            </button>

            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => setShowFolderMenu((v) => !v)}
                aria-label="Folder options"
                className="h-11 w-11 rounded-full bg-white dark:bg-[#1C1C1E] border border-slate-200/80 dark:border-white/[0.1] flex items-center justify-center text-slate-800 dark:text-white shadow-xs transition-transform active:scale-95"
              >
                <MoreHorizontal className="w-[19px] h-[19px]" strokeWidth={2} />
              </button>

              {showFolderMenu && (
                <div className="absolute right-0 top-13 w-48 rounded-2xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-[#1C1C1E] shadow-2xl py-1.5 z-40">
                  <button
                    type="button"
                    onClick={() => {
                      updateSettings({
                        viewMode: settings.viewMode === 'list' ? 'grid' : 'list',
                      });
                      setShowFolderMenu(false);
                    }}
                    className="w-full px-3.5 min-h-[44px] flex items-center gap-2.5 text-sm text-slate-700 dark:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                  >
                    {settings.viewMode === 'list' ? (
                      <>
                        <LayoutGrid className="w-4 h-4 text-slate-500 dark:text-zinc-400" />
                        <span>View as Gallery</span>
                      </>
                    ) : (
                      <>
                        <ListIcon className="w-4 h-4 text-slate-500 dark:text-zinc-400" />
                        <span>View as List</span>
                      </>
                    )}
                  </button>

                  {screen.folderId !== 'trash' && screen.folderId !== 'archive' && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowFolderMenu(false);
                        setShowTemplates(true);
                      }}
                      className="w-full px-3.5 min-h-[44px] flex items-center gap-2.5 text-sm text-slate-700 dark:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                    >
                      <FilePlus2 className="w-4 h-4 text-slate-500 dark:text-zinc-400" />
                      <span>Use Template</span>
                    </button>
                  )}

                  {screen.folderId === 'trash' && folderNotes.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        handleEmptyTrash();
                        setShowFolderMenu(false);
                      }}
                      className="w-full px-3.5 min-h-[44px] flex items-center gap-2.5 text-sm text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>Empty Trash</span>
                    </button>
                  )}

                  <div className="my-1 border-t border-slate-100 dark:border-white/[0.07]" />
                  <button
                    type="button"
                    onClick={() => {
                      setShowFolderMenu(false);
                      setScreen({ type: 'settings' });
                    }}
                    className="w-full px-3.5 min-h-[44px] flex items-center gap-2.5 text-sm text-slate-700 dark:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                  >
                    <Settings className="w-4 h-4 text-slate-500 dark:text-zinc-400" />
                    <span>Settings</span>
                  </button>
                </div>
              )}
            </div>
          </header>

          <main
            className={`flex-1 flex flex-col w-full mx-auto px-4 pt-1 pb-24 ${
              isMobileFrame ? '' : 'max-w-5xl'
            }`}
          >
            <div className="mb-4">
              <h1 className="text-[32px] font-bold tracking-tight text-slate-900 dark:text-white leading-tight">
                {currentFolderTitle}
              </h1>
              {folderNotes.length > 0 && (
                <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5 tabular-nums">
                  {folderNotes.length} {folderNotes.length === 1 ? 'note' : 'notes'}
                </p>
              )}
            </div>

            {folderNotes.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center pb-16 text-center">
                <StickyNote
                  className="w-12 h-12 text-slate-400 dark:text-zinc-500 mb-3"
                  strokeWidth={1.75}
                />
                <p className="text-[18px] font-semibold text-slate-800 dark:text-white">
                  {searchQuery ? 'No Matching Notes' : 'No Notes'}
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                {pinnedNotes.length > 0 && (
                  <section className="space-y-2">
                    <h2 className="px-1 text-xs font-semibold text-slate-500 dark:text-zinc-400">
                      Pinned
                    </h2>
                    <div
                      className={
                        settings.viewMode === 'list'
                          ? 'grid grid-cols-1 gap-2.5'
                          : isMobileFrame
                          ? 'grid grid-cols-2 gap-2.5'
                          : 'grid grid-cols-2 md:grid-cols-3 gap-3'
                      }
                    >
                      {pinnedNotes.map((note) => (
                        <NoteCard
                          key={note.id}
                          note={note}
                          folders={folders}
                          viewMode={settings.viewMode}
                          fontStyle={settings.fontStyle}
                          accent={settings.accent}
                          showPreviews={settings.showPreviews}
                          showStats={settings.showStats}
                          moveCheckedToBottom={settings.moveCheckedToBottom}
                          onOpen={(n) => setActiveNoteId(n.id)}
                          onTogglePin={handleTogglePin}
                          onToggleChecklistItem={handleToggleChecklistItem}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {regularNotes.length > 0 && (
                  <section className="space-y-2">
                    {pinnedNotes.length > 0 && (
                      <h2 className="px-1 text-xs font-semibold text-slate-500 dark:text-zinc-400">
                        Notes
                      </h2>
                    )}
                    <div
                      className={
                        settings.viewMode === 'list'
                          ? 'grid grid-cols-1 gap-2.5'
                          : isMobileFrame
                          ? 'grid grid-cols-2 gap-2.5'
                          : 'grid grid-cols-2 md:grid-cols-3 gap-3'
                      }
                    >
                      {regularNotes.map((note) => (
                        <NoteCard
                          key={note.id}
                          note={note}
                          folders={folders}
                          viewMode={settings.viewMode}
                          fontStyle={settings.fontStyle}
                          accent={settings.accent}
                          showPreviews={settings.showPreviews}
                          showStats={settings.showStats}
                          moveCheckedToBottom={settings.moveCheckedToBottom}
                          onOpen={(n) => setActiveNoteId(n.id)}
                          onTogglePin={handleTogglePin}
                          onToggleChecklistItem={handleToggleChecklistItem}
                          onRestore={
                            screen.folderId === 'archive' || screen.folderId === 'trash'
                              ? handleRestoreNote
                              : undefined
                          }
                          onPermanentDelete={
                            screen.folderId === 'trash'
                              ? handleRequestPermanentDelete
                              : undefined
                          }
                        />
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </main>

          <FloatingBottomBar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onCompose={() => handleCreateNote()}
            onVoiceError={(msg) => showToast(msg)}
            accent={settings.accent}
            isMobileFrame={isMobileFrame}
          />
        </div>
      )}

      {/* Templates Sheet */}
      <TemplatesSheet
        open={showTemplates}
        onClose={() => setShowTemplates(false)}
        onSelectTemplate={(tpl) => handleCreateNote(tpl)}
        isMobileFrame={isMobileFrame}
      />

      {/* First-Time Notification Permission Prompt */}
      {showNotifPrompt && (
        <div
          className={`${
            isMobileFrame ? 'absolute' : 'fixed'
          } inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-md p-4`}
          role="dialog"
          aria-modal="true"
          aria-label="Allow Notification"
        >
          <button
            type="button"
            onClick={() => {
              if (typeof Notification !== 'undefined') {
                try {
                  localStorage.setItem(NOTIF_PROMPT_DONE_KEY, '1');
                } catch {
                  // Ignore storage error
                }
              }
              setShowNotifPrompt(false);
              void handleToggleNotifications();
            }}
            className={`min-h-[52px] px-7 rounded-full shadow-2xl text-[15px] font-semibold flex items-center gap-2.5 transition-transform active:scale-95 text-white dark:text-black ${accentStyle.bg}`}
          >
            <Bell className="w-4 h-4" />
            <span>Allow Notification</span>
          </button>
        </div>
      )}

      {/* Confirm Permanent Delete Sheet */}
      {pendingPermanentDeleteId && (
        <div
          className={`${
            isMobileFrame ? 'absolute' : 'fixed'
          } inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-4`}
          onClick={() => setPendingPermanentDeleteId(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Confirm permanent deletion"
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#1C1C1E] border border-slate-200 dark:border-white/[0.1] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Delete note permanently?
            </h2>
            <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1.5">
              This action cannot be undone. The note and its checklist items will be erased.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setPendingPermanentDeleteId(null)}
                className="min-h-[44px] rounded-xl bg-slate-100 dark:bg-zinc-800 text-sm font-medium text-slate-700 dark:text-zinc-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handlePermanentDelete(pendingPermanentDeleteId)}
                className="min-h-[44px] rounded-xl bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700"
              >
                Delete Forever
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div
          role="status"
          className={`${
            isMobileFrame ? 'sticky bottom-20 mx-4' : 'fixed bottom-20 left-1/2 -translate-x-1/2'
          } z-40 px-4 py-2.5 rounded-full bg-slate-900 dark:bg-[#2C2C2E] text-white text-xs font-medium shadow-lg border border-white/10 flex items-center justify-center gap-3`}
        >
          <span>{toast.message}</span>
          {toast.undoNoteId && (
            <button
              type="button"
              onClick={() => {
                handleRestoreNote(toast.undoNoteId!);
                setToast(null);
              }}
              className={`font-bold underline underline-offset-2 ${accentStyle.text}`}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );

  if (isMobileFrame) {
    return (
      <div className="min-h-screen w-full bg-slate-200/80 dark:bg-[#09090B] flex items-center justify-center p-0 md:p-6">
        {shellContent}
      </div>
    );
  }

  return shellContent;
}
