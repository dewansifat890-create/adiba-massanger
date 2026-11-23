import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  GoogleAuthProvider,
  linkWithCredential,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  goOffline,
  goOnline,
  onDisconnect,
  onValue,
  ref as rtdbRef,
  serverTimestamp as rtdbServerTimestamp,
  set as rtdbSet,
} from 'firebase/database';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  Unsubscribe,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getToken, onMessage } from 'firebase/messaging';
import {
  auth,
  db,
  getFirebaseMessagingSafe,
  handleFirestoreError,
  OperationType,
  rtdb,
  VAPID_KEY,
} from '../lib/firebase';
import {
  ChatReaction,
  ChatReplyPreview,
  DirectMessage,
  MessengerUser,
} from '../types/notes';

export function makeDmId(userA: string, userB: string): string {
  return [userA, userB].sort().join('__');
}

export function sanitizeHandle(raw: string, fallbackUid?: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9_-]/g, '');
  if (cleaned.length >= 3) return cleaned.slice(0, 28);
  if (fallbackUid) return `user-${fallbackUid.slice(0, 5).toLowerCase()}`;
  return `user-${Math.floor(1000 + Math.random() * 9000)}`;
}

export async function waitForInitialAuthUser(): Promise<User | null> {
  if (!auth) return null;
  if (auth.currentUser) return auth.currentUser;
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth!, (user) => {
      unsub();
      resolve(user);
    });
  });
}

export async function ensureFirebaseSignedIn(): Promise<{
  user: User | null;
  errorCode?: string;
}> {
  if (!auth) return { user: null, errorCode: 'not-configured' };
  const existing = await waitForInitialAuthUser();
  if (existing) return { user: existing };
  try {
    const cred = await signInAnonymously(auth);
    return { user: cred.user };
  } catch (err: unknown) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code: unknown }).code)
        : 'auth-error';
    return { user: null, errorCode: code };
  }
}

export async function signInEmailPassword(
  email: string,
  password: string,
  createNew: boolean
): Promise<User> {
  if (!auth) throw new Error('Firebase Auth is not initialized');
  if (createNew) {
    if (auth.currentUser && auth.currentUser.isAnonymous) {
      const cred = EmailAuthProvider.credential(email.trim(), password);
      const linked = await linkWithCredential(auth.currentUser, cred);
      return linked.user;
    }
    const created = await createUserWithEmailAndPassword(
      auth,
      email.trim(),
      password
    );
    return created.user;
  }
  const signedIn = await signInWithEmailAndPassword(auth, email.trim(), password);
  return signedIn.user;
}

export async function signInGoogleAccount(): Promise<User> {
  if (!auth) throw new Error('Firebase Auth is not initialized');
  const provider = new GoogleAuthProvider();
  const res = await signInWithPopup(auth, provider);
  return res.user;
}

export async function signOutFirebaseAccount(): Promise<void> {
  if (!auth) return;
  await signOut(auth);
}

export async function syncFirebaseUserProfile(
  uid: string,
  desiredDisplayName: string,
  desiredHandle: string,
  fcmToken?: string
): Promise<MessengerUser> {
  if (!db) {
    return {
      userId: uid,
      handle: sanitizeHandle(desiredHandle, uid),
      displayName: desiredDisplayName.trim() || 'User',
    };
  }

  const cleanName = desiredDisplayName.trim() || 'User';
  let targetHandle = sanitizeHandle(desiredHandle, uid);

  let existingHandle: string | null = null;
  let existingToken: string | undefined;
  try {
    const userSnap = await getDoc(doc(db, 'users', uid));
    if (userSnap.exists()) {
      const data = userSnap.data() as { handle?: string; fcmToken?: string };
      existingHandle = data.handle || null;
      existingToken = data.fcmToken;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${uid}`);
  }

  // Claim or verify unique handle in /handles/{handle}
  let handleClaimed = false;
  try {
    const handleRef = doc(db, 'handles', targetHandle);
    const handleSnap = await getDoc(handleRef);
    if (!handleSnap.exists()) {
      await setDoc(handleRef, {
        uid,
        handle: targetHandle,
        updatedAt: Date.now(),
      });
      handleClaimed = true;
    } else {
      const data = handleSnap.data() as { uid?: string };
      if (data.uid === uid) {
        handleClaimed = true;
      }
    }
  } catch {
    // Handle might already belong to someone else or permission check
  }

  if (!handleClaimed) {
    if (existingHandle) {
      targetHandle = existingHandle;
    } else {
      targetHandle = `${targetHandle.slice(0, 20)}-${uid.slice(0, 4).toLowerCase()}`;
      try {
        await setDoc(doc(db, 'handles', targetHandle), {
          uid,
          handle: targetHandle,
          updatedAt: Date.now(),
        });
      } catch {
        // Ignore fallback handle conflict
      }
    }
  } else if (existingHandle && existingHandle !== targetHandle) {
    try {
      await deleteDoc(doc(db, 'handles', existingHandle));
    } catch {
      // Ignore old handle cleanup error
    }
  }

  const userPayload: Record<string, unknown> = {
    uid,
    handle: targetHandle,
    displayName: cleanName,
    updatedAt: Date.now(),
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    lastSeen: Date.now(),
  };
  if (fcmToken) {
    userPayload.fcmToken = fcmToken;
  } else if (existingToken) {
    userPayload.fcmToken = existingToken;
  }

  try {
    await setDoc(doc(db, 'users', uid), userPayload, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${uid}`);
  }

  return {
    userId: uid,
    handle: targetHandle,
    displayName: cleanName,
  };
}

export async function lookupFirebaseUser(
  rawQuery: string
): Promise<MessengerUser | null> {
  if (!db) return null;
  const cleanHandle = rawQuery
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9_-]/g, '');

  if (cleanHandle) {
    try {
      const handleSnap = await getDoc(doc(db, 'handles', cleanHandle));
      if (handleSnap.exists()) {
        const { uid } = handleSnap.data() as { uid?: string };
        if (uid) {
          const userSnap = await getDoc(doc(db, 'users', uid));
          if (userSnap.exists()) {
            const u = userSnap.data() as {
              uid?: string;
              handle?: string;
              displayName?: string;
            };
            return {
              userId: uid,
              handle: u.handle || cleanHandle,
              displayName: u.displayName || cleanHandle,
            };
          }
        }
      }
    } catch {
      // Fall through to UID lookup
    }
  }

  // Fallback: direct UID lookup if user pasted a UID
  const rawId = rawQuery.trim();
  if (rawId && rawId.length >= 6 && !rawId.includes('/')) {
    try {
      const userSnap = await getDoc(doc(db, 'users', rawId));
      if (userSnap.exists()) {
        const u = userSnap.data() as {
          handle?: string;
          displayName?: string;
        };
        return {
          userId: rawId,
          handle: u.handle || rawId.slice(0, 10),
          displayName: u.displayName || 'User',
        };
      }
    } catch {
      return null;
    }
  }

  return null;
}

export function subscribeToFirebaseChats(
  myUid: string,
  callbacks: {
    onPeerProfile: (peer: MessengerUser) => void;
    onMessagesUpdate: (dmId: string, messages: DirectMessage[]) => void;
    onNewIncomingMessage: (peerId: string, msg: DirectMessage) => void;
    onChatMetaUpdate?: (
      dmId: string,
      peerId: string,
      meta: {
        peerDeliveredAt: number;
        peerSeenAt: number;
        peerTyping: boolean;
      }
    ) => void;
    onKnownChatsChange?: (chatIds: Set<string>) => void;
    onRecovered?: () => void;
    onError?: (err: Error) => void;
  }
): () => void {
  if (!db) return () => {};

  const messageUnsubs = new Map<string, Unsubscribe>();
  const rtdbTypingUnsubs = new Map<string, Unsubscribe>();
  const fetchedPeers = new Set<string>();
  const initialLoadedChats = new Set<string>();
  const seenMsgIds = new Set<string>();
  const knownChatIds = new Set<string>();
  const typingExpireTimers = new Map<string, number>();
  const chatMetaState = new Map<
    string,
    {
      peerId: string;
      peerDeliveredAt: number;
      peerSeenAt: number;
      lastFsTypingVal: number;
      lastRtdbTypingVal: number;
      typingReceivedLocalAt: number;
    }
  >();

  const emitChatMeta = (chatId: string) => {
    const st = chatMetaState.get(chatId);
    if (!st) return;
    const isTyping =
      st.typingReceivedLocalAt > 0 &&
      Date.now() - st.typingReceivedLocalAt < 4500;
    callbacks.onChatMetaUpdate?.(chatId, st.peerId, {
      peerDeliveredAt: st.peerDeliveredAt,
      peerSeenAt: st.peerSeenAt,
      peerTyping: isTyping,
    });
  };

  const scheduleTypingExpiry = (chatId: string) => {
    const prevTimer = typingExpireTimers.get(chatId);
    if (prevTimer) window.clearTimeout(prevTimer);
    const timer = window.setTimeout(() => {
      typingExpireTimers.delete(chatId);
      const st = chatMetaState.get(chatId);
      if (st && st.typingReceivedLocalAt > 0) {
        st.typingReceivedLocalAt = 0;
        emitChatMeta(chatId);
      }
    }, 4500);
    typingExpireTimers.set(chatId, timer);
  };

  const chatsQuery = query(
    collection(db, 'chats'),
    where('participants', 'array-contains', myUid)
  );

  const msgRetryTimers = new Map<string, number>();
  const msgRetryCounts = new Map<string, number>();

  const unsubChats = onSnapshot(
    chatsQuery,
    (snapshot) => {
      callbacks.onRecovered?.();
      const currentChatIds = new Set<string>();

      snapshot.docs.forEach((chatDoc) => {
        const chatId = chatDoc.id;
        currentChatIds.add(chatId);
        knownChatIds.add(chatId);

        const data = chatDoc.data() as {
          participants?: string[];
          deliveryReceipts?: Record<string, number>;
          readReceipts?: Record<string, number>;
          typing?: Record<string, number>;
        };
        const peerId = (data.participants || []).find((p) => p !== myUid);

        if (peerId) {
          const prevMeta = chatMetaState.get(chatId);
          const nextFsVal =
            typeof data.typing?.[peerId] === 'number'
              ? data.typing[peerId]
              : 0;
          let nextTypingLocalAt = prevMeta?.typingReceivedLocalAt ?? 0;

          if (nextFsVal === 0 && (prevMeta?.lastFsTypingVal ?? 0) > 0) {
            nextTypingLocalAt = 0;
          } else if (nextFsVal > 0 && nextFsVal !== prevMeta?.lastFsTypingVal) {
            nextTypingLocalAt = Date.now();
            scheduleTypingExpiry(chatId);
          }

          chatMetaState.set(chatId, {
            peerId,
            peerDeliveredAt:
              typeof data.deliveryReceipts?.[peerId] === 'number'
                ? data.deliveryReceipts[peerId]
                : prevMeta?.peerDeliveredAt ?? 0,
            peerSeenAt:
              typeof data.readReceipts?.[peerId] === 'number'
                ? data.readReceipts[peerId]
                : prevMeta?.peerSeenAt ?? 0,
            lastFsTypingVal: nextFsVal,
            lastRtdbTypingVal: prevMeta?.lastRtdbTypingVal ?? 0,
            typingReceivedLocalAt: nextTypingLocalAt,
          });
          emitChatMeta(chatId);

          if (rtdb && !rtdbTypingUnsubs.has(chatId)) {
            const typingPath = rtdbRef(rtdb, `typing/${chatId}/${peerId}`);
            const unsubTyping = onValue(
              typingPath,
              (snap) => {
                const val = snap.val() as number | null;
                const st = chatMetaState.get(chatId);
                if (!st) return;
                const nextRtdbVal = typeof val === 'number' ? val : 0;
                if (nextRtdbVal > 0) {
                  st.lastRtdbTypingVal = nextRtdbVal;
                  st.typingReceivedLocalAt = Date.now();
                  scheduleTypingExpiry(chatId);
                } else {
                  st.lastRtdbTypingVal = 0;
                  st.typingReceivedLocalAt = 0;
                }
                emitChatMeta(chatId);
              },
              () => {
                // RTDB rules may not be enabled yet; Firestore typing handles fallback
              }
            );
            rtdbTypingUnsubs.set(chatId, unsubTyping);
          }
        }

        if (peerId && !fetchedPeers.has(peerId)) {
          fetchedPeers.add(peerId);
          void getDoc(doc(db!, 'users', peerId))
            .then((peerSnap) => {
              if (peerSnap.exists()) {
                const p = peerSnap.data() as {
                  handle?: string;
                  displayName?: string;
                  isOnline?: boolean;
                  lastSeen?: number;
                };
                callbacks.onPeerProfile({
                  userId: peerId,
                  handle: p.handle || peerId.slice(0, 10),
                  displayName: p.displayName || 'User',
                  isOnline: Boolean(p.isOnline),
                  lastSeen: typeof p.lastSeen === 'number' ? p.lastSeen : undefined,
                });
              } else {
                callbacks.onPeerProfile({
                  userId: peerId,
                  handle: peerId.slice(0, 10),
                  displayName: 'User',
                });
              }
            })
            .catch(() => {
              // Ignore transient peer fetch error
            });
        }

        const attachMessagesListener = () => {
          if (messageUnsubs.has(chatId)) return;
          const msgsQuery = query(
            collection(db!, 'chats', chatId, 'messages'),
            orderBy('createdAt', 'asc')
          );

          const unsubMsgs = onSnapshot(
            msgsQuery,
            (msgSnap) => {
              msgRetryCounts.delete(chatId);
              callbacks.onRecovered?.();
              const msgs: DirectMessage[] = msgSnap.docs.map((d) => {
                const m = d.data() as Partial<DirectMessage> & {
                  senderId?: string;
                };
                return {
                  id: d.id,
                  dmId: chatId,
                  fromUserId: m.fromUserId || m.senderId || '',
                  toUserId: m.toUserId || '',
                  senderName: m.senderName || 'User',
                  text: m.text || '',
                  imageUrl:
                    typeof m.imageUrl === 'string' && m.imageUrl
                      ? m.imageUrl
                      : undefined,
                  createdAt:
                    typeof m.createdAt === 'number' ? m.createdAt : Date.now(),
                  unsent: Boolean(m.unsent),
                  unsentAt:
                    typeof m.unsentAt === 'number' ? m.unsentAt : undefined,
                  replyTo: m.unsent ? undefined : m.replyTo,
                  reactions: m.unsent
                    ? []
                    : Array.isArray(m.reactions)
                    ? m.reactions
                    : [],
                };
              });

              const wasInitialized = initialLoadedChats.has(chatId);
              if (!wasInitialized) {
                msgs.forEach((m) => seenMsgIds.add(m.id));
                initialLoadedChats.add(chatId);
              } else {
                msgSnap.docChanges().forEach((change) => {
                  if (change.type === 'added') {
                    const m = msgs.find((x) => x.id === change.doc.id);
                    if (
                      m &&
                      !seenMsgIds.has(m.id) &&
                      m.fromUserId !== myUid
                    ) {
                      seenMsgIds.add(m.id);
                      callbacks.onNewIncomingMessage(m.fromUserId, m);
                    }
                  }
                });
                msgs.forEach((m) => seenMsgIds.add(m.id));
              }

              callbacks.onMessagesUpdate(chatId, msgs);
            },
            (err) => {
              unsubMsgs();
              messageUnsubs.delete(chatId);
              const attempts = msgRetryCounts.get(chatId) ?? 0;
              if (
                err.message.toLowerCase().includes('permission') &&
                attempts < 3
              ) {
                msgRetryCounts.set(chatId, attempts + 1);
                const prevRetry = msgRetryTimers.get(chatId);
                if (prevRetry) window.clearTimeout(prevRetry);
                const delay = attempts === 0 ? 1200 : 2500;
                const retryTimer = window.setTimeout(() => {
                  msgRetryTimers.delete(chatId);
                  void auth?.currentUser
                    ?.getIdToken(true)
                    .catch(() => {})
                    .finally(() => {
                      if (knownChatIds.has(chatId)) {
                        attachMessagesListener();
                      }
                    });
                }, delay);
                msgRetryTimers.set(chatId, retryTimer);
                return;
              }
              callbacks.onError?.(err);
            }
          );

          messageUnsubs.set(chatId, unsubMsgs);
        };

        if (!messageUnsubs.has(chatId) && !chatDoc.metadata.hasPendingWrites) {
          attachMessagesListener();
        }
      });

      for (const [existingId, unsub] of messageUnsubs.entries()) {
        if (!currentChatIds.has(existingId)) {
          unsub();
          messageUnsubs.delete(existingId);
        }
      }
      for (const [existingId, unsub] of rtdbTypingUnsubs.entries()) {
        if (!currentChatIds.has(existingId)) {
          unsub();
          rtdbTypingUnsubs.delete(existingId);
        }
      }

      callbacks.onKnownChatsChange?.(new Set(knownChatIds));
    },
    (error) => {
      callbacks.onError?.(error);
    }
  );

  return () => {
    unsubChats();
    for (const timer of msgRetryTimers.values()) {
      window.clearTimeout(timer);
    }
    for (const timer of typingExpireTimers.values()) {
      window.clearTimeout(timer);
    }
    for (const unsub of messageUnsubs.values()) {
      unsub();
    }
    for (const unsub of rtdbTypingUnsubs.values()) {
      unsub();
    }
    msgRetryTimers.clear();
    msgRetryCounts.clear();
    typingExpireTimers.clear();
    messageUnsubs.clear();
    rtdbTypingUnsubs.clear();
  };
}

export function startFirebasePresence(myUid: string): () => void {
  if (!db && !rtdb) return () => {};
  let active = true;

  const writeFirestorePresence = (online: boolean) => {
    if (!db || !active) return;
    void setDoc(
      doc(db, 'users', myUid),
      {
        uid: myUid,
        isOnline: online,
        lastSeen: Date.now(),
      },
      { merge: true }
    ).catch(() => {
      // Ignore transient network error when going offline
    });
  };

  let unsubRtdbConn: Unsubscribe | null = null;
  if (rtdb) {
    try {
      const connectedRef = rtdbRef(rtdb, '.info/connected');
      const userPresenceRef = rtdbRef(rtdb, `presence/${myUid}`);
      if (navigator.onLine) {
        void rtdbSet(userPresenceRef, {
          online: true,
          lastSeen: rtdbServerTimestamp(),
        }).catch(() => {});
      }
      unsubRtdbConn = onValue(
        connectedRef,
        (snap) => {
          if (!active) return;
          if (snap.val() === true && navigator.onLine) {
            void onDisconnect(userPresenceRef)
              .set({
                online: false,
                lastSeen: rtdbServerTimestamp(),
              })
              .then(() =>
                rtdbSet(userPresenceRef, {
                  online: true,
                  lastSeen: rtdbServerTimestamp(),
                })
              )
              .catch(() => {
                // RTDB rules may be locked; Firestore presence remains active
              });
          }
        },
        () => {
          // Ignore RTDB connection listener error
        }
      );
    } catch {
      // Ignore RTDB init error
    }
  }

  const handleOnline = () => {
    if (!active) return;
    if (rtdb) {
      try {
        goOnline(rtdb);
        void rtdbSet(rtdbRef(rtdb, `presence/${myUid}`), {
          online: true,
          lastSeen: rtdbServerTimestamp(),
        }).catch(() => {});
      } catch {
        // Ignore
      }
    }
    writeFirestorePresence(true);
  };

  const handleOffline = () => {
    if (!active) return;
    if (rtdb) {
      try {
        void rtdbSet(rtdbRef(rtdb, `presence/${myUid}`), {
          online: false,
          lastSeen: rtdbServerTimestamp(),
        }).catch(() => {});
        goOffline(rtdb);
      } catch {
        // Ignore
      }
    }
    writeFirestorePresence(false);
  };

  const handleVisibilityChange = () => {
    if (!active) return;
    if (document.visibilityState === 'visible') {
      if (navigator.onLine) {
        handleOnline();
      } else {
        handleOffline();
      }
    }
  };

  const handlePageHide = () => {
    writeFirestorePresence(false);
    if (rtdb) {
      try {
        void rtdbSet(rtdbRef(rtdb, `presence/${myUid}`), {
          online: false,
          lastSeen: rtdbServerTimestamp(),
        }).catch(() => {});
      } catch {
        // Ignore
      }
    }
  };

  if (navigator.onLine) {
    writeFirestorePresence(true);
  } else {
    writeFirestorePresence(false);
  }

  const heartbeatTimer = window.setInterval(() => {
    if (!active) return;
    if (navigator.onLine) {
      writeFirestorePresence(true);
      if (rtdb) {
        void rtdbSet(rtdbRef(rtdb, `presence/${myUid}`), {
          online: true,
          lastSeen: rtdbServerTimestamp(),
        }).catch(() => {});
      }
    } else {
      writeFirestorePresence(false);
    }
  }, 15000);

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  window.addEventListener('focus', handleOnline);
  window.addEventListener('pageshow', handleOnline);
  window.addEventListener('pagehide', handlePageHide);
  window.addEventListener('beforeunload', handlePageHide);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  return () => {
    active = false;
    window.clearInterval(heartbeatTimer);
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
    window.removeEventListener('focus', handleOnline);
    window.removeEventListener('pageshow', handleOnline);
    window.removeEventListener('pagehide', handlePageHide);
    window.removeEventListener('beforeunload', handlePageHide);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    unsubRtdbConn?.();
    if (rtdb) {
      void rtdbSet(rtdbRef(rtdb, `presence/${myUid}`), {
        online: false,
        lastSeen: rtdbServerTimestamp(),
      }).catch(() => {});
    }
    if (db) {
      void setDoc(
        doc(db, 'users', myUid),
        { uid: myUid, isOnline: false, lastSeen: Date.now() },
        { merge: true }
      ).catch(() => {});
    }
  };
}

export function subscribeToPeerPresence(
  peerUid: string,
  onUpdate: (status: { isOnline: boolean; lastSeen?: number }) => void
): () => void {
  if ((!db && !rtdb) || !peerUid) return () => {};

  let fsOnline: boolean | null = null;
  let fsLastSeen: number | undefined;
  let rtdbOnline: boolean | null = null;
  let rtdbLastSeen: number | undefined;
  let hasRtdbSignal = false;

  const emit = () => {
    if (hasRtdbSignal && rtdbOnline !== null) {
      onUpdate({
        isOnline: rtdbOnline,
        lastSeen: rtdbLastSeen ?? fsLastSeen,
      });
      return;
    }
    const staleThreshold = 75000;
    const freshByHeartbeat =
      fsOnline === true &&
      (typeof fsLastSeen !== 'number' || Date.now() - fsLastSeen < staleThreshold);
    onUpdate({
      isOnline: Boolean(freshByHeartbeat),
      lastSeen: fsLastSeen,
    });
  };

  let unsubFs: Unsubscribe | null = null;
  if (db) {
    unsubFs = onSnapshot(
      doc(db, 'users', peerUid),
      (snap) => {
        if (!snap.exists()) return;
        const d = snap.data() as { isOnline?: boolean; lastSeen?: number };
        fsOnline = Boolean(d.isOnline);
        fsLastSeen = typeof d.lastSeen === 'number' ? d.lastSeen : fsLastSeen;
        emit();
      },
      () => {
        // Ignore transient permission error
      }
    );
  }

  let unsubRtdb: Unsubscribe | null = null;
  if (rtdb) {
    unsubRtdb = onValue(
      rtdbRef(rtdb, `presence/${peerUid}`),
      (snap) => {
        const val = snap.val() as { online?: boolean; lastSeen?: number } | null;
        if (val && typeof val.online === 'boolean') {
          hasRtdbSignal = true;
          rtdbOnline = val.online;
          if (typeof val.lastSeen === 'number') {
            rtdbLastSeen = val.lastSeen;
          }
          emit();
        }
      },
      () => {
        // RTDB rules may not be set; Firestore listener remains active
      }
    );
  }

  const staleCheck = window.setInterval(emit, 8000);

  return () => {
    window.clearInterval(staleCheck);
    unsubFs?.();
    unsubRtdb?.();
  };
}

export async function markFirebaseChatDelivered(
  myUid: string,
  chatId: string,
  upToTs: number
): Promise<void> {
  if (!db) return;
  try {
    await updateDoc(doc(db, 'chats', chatId), {
      [`deliveryReceipts.${myUid}`]: upToTs,
    });
  } catch {
    // Ignore if chat doesn't exist yet
  }
}

export async function markFirebaseChatSeen(
  myUid: string,
  chatId: string,
  upToTs: number
): Promise<void> {
  if (!db) return;
  try {
    await updateDoc(doc(db, 'chats', chatId), {
      [`deliveryReceipts.${myUid}`]: upToTs,
      [`readReceipts.${myUid}`]: upToTs,
    });
  } catch {
    // Ignore if chat doesn't exist yet
  }
}

export async function sendFirebaseTypingStatus(
  myUid: string,
  peerUid: string,
  isTyping: boolean
): Promise<void> {
  const chatId = makeDmId(myUid, peerUid);
  const stamp = isTyping ? Date.now() : 0;

  if (rtdb) {
    try {
      const typingNode = rtdbRef(rtdb, `typing/${chatId}/${myUid}`);
      if (isTyping) {
        void onDisconnect(typingNode).remove().catch(() => {});
      }
      void rtdbSet(typingNode, isTyping ? stamp : null).catch(() => {});
    } catch {
      // Ignore RTDB error
    }
  }

  if (db) {
    try {
      await updateDoc(doc(db, 'chats', chatId), {
        [`typing.${myUid}`]: stamp,
      });
    } catch {
      // Chat might not exist before first message
    }
  }
}

export async function uploadCompressedChatImage(
  imageBase64: string,
  name?: string
): Promise<string> {
  const idToken = await auth?.currentUser?.getIdToken();
  const res = await fetch('/api/upload-image', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ imageBase64, name }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    url?: string;
    error?: string;
  };
  if (!res.ok || !data.ok || !data.url) {
    throw new Error(data.error || 'Image upload failed');
  }
  return data.url;
}

export async function warmupPushEndpoint(peerUid?: string): Promise<void> {
  try {
    const idToken = await auth?.currentUser?.getIdToken();
    if (!idToken) return;
    await fetch('/api/push/reminder', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        warmup: true,
        ...(peerUid ? { toUserId: peerUid } : {}),
      }),
    });
  } catch {
    // Non-blocking warmup
  }
}

export async function sendFirebaseDirectMessage(params: {
  myUid: string;
  myName: string;
  peerUid: string;
  text: string;
  messageId: string;
  imageUrl?: string;
  replyTo?: ChatReplyPreview;
  chatAlreadyExists: boolean;
}): Promise<void> {
  if (!db) throw new Error('Firestore not initialized');
  const {
    myUid,
    myName,
    peerUid,
    text,
    messageId,
    imageUrl,
    replyTo,
    chatAlreadyExists,
  } = params;
  const chatId = makeDmId(myUid, peerUid);
  const now = Date.now();
  const chatRef = doc(db, 'chats', chatId);
  const lastPreviewText = text.trim() || (imageUrl ? '📷 Photo' : '');

  const msgPayload: Record<string, unknown> = {
    id: messageId,
    dmId: chatId,
    senderId: myUid,
    fromUserId: myUid,
    toUserId: peerUid,
    senderName: myName,
    text,
    createdAt: now,
    reactions: [],
  };
  if (imageUrl) {
    msgPayload.imageUrl = imageUrl;
  }
  if (replyTo) {
    msgPayload.replyTo = replyTo;
  }

  const dispatchPushReminder = async () => {
    try {
      const idToken = await auth?.currentUser?.getIdToken();
      if (!idToken) return;
      await fetch('/api/push/reminder', {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ toUserId: peerUid, messageId }),
      });
    } catch {
      // Non-blocking: foreground/realtime listeners still deliver messages
    }
  };

  if (chatAlreadyExists) {
    // Fire chat update, message write, AND background push concurrently for sub-second delivery
    const chatWrite = updateDoc(chatRef, {
      updatedAt: now,
      lastMessage: {
        text: lastPreviewText,
        senderId: myUid,
        createdAt: now,
      },
    }).catch(() =>
      setDoc(
        chatRef,
        {
          participants: [myUid, peerUid].sort(),
          updatedAt: now,
          lastMessage: {
            text: lastPreviewText,
            senderId: myUid,
            createdAt: now,
          },
        },
        { merge: true }
      )
    );

    const msgWrite = setDoc(
      doc(db, 'chats', chatId, 'messages', messageId),
      msgPayload
    ).catch((error) => {
      handleFirestoreError(
        error,
        OperationType.CREATE,
        `chats/${chatId}/messages/${messageId}`
      );
    });

    await Promise.all([chatWrite, msgWrite, dispatchPushReminder()]);
    return;
  }

  try {
    await setDoc(
      chatRef,
      {
        participants: [myUid, peerUid].sort(),
        updatedAt: now,
        lastMessage: {
          text: lastPreviewText,
          senderId: myUid,
          createdAt: now,
        },
      },
      { merge: true }
    );
  } catch {
    await updateDoc(chatRef, {
      updatedAt: now,
      lastMessage: {
        text: lastPreviewText,
        senderId: myUid,
        createdAt: now,
      },
    });
  }

  const msgWrite = setDoc(
    doc(db, 'chats', chatId, 'messages', messageId),
    msgPayload
  ).catch((error) => {
    handleFirestoreError(
      error,
      OperationType.CREATE,
      `chats/${chatId}/messages/${messageId}`
    );
  });

  await Promise.all([msgWrite, dispatchPushReminder()]);
}

export async function toggleFirebaseMessageReaction(
  myUid: string,
  chatId: string,
  messageId: string,
  emoji: string,
  currentReactions: ChatReaction[]
): Promise<void> {
  if (!db) return;
  const reactions = currentReactions.map((r) => ({
    emoji: r.emoji,
    userIds: [...r.userIds],
  }));
  const idx = reactions.findIndex((r) => r.emoji === emoji);
  if (idx >= 0) {
    const entry = reactions[idx];
    if (entry.userIds.includes(myUid)) {
      const nextIds = entry.userIds.filter((id) => id !== myUid);
      if (nextIds.length === 0) reactions.splice(idx, 1);
      else reactions[idx] = { ...entry, userIds: nextIds };
    } else {
      reactions[idx] = { ...entry, userIds: [...entry.userIds, myUid] };
    }
  } else {
    reactions.push({ emoji, userIds: [myUid] });
  }

  try {
    await updateDoc(doc(db, 'chats', chatId, 'messages', messageId), {
      reactions,
    });
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.UPDATE,
      `chats/${chatId}/messages/${messageId}`
    );
  }
}

export async function deleteFirebaseDirectMessage(
  chatId: string,
  messageId: string
): Promise<void> {
  if (!db) return;
  try {
    await updateDoc(doc(db, 'chats', chatId, 'messages', messageId), {
      text: '',
      imageUrl: deleteField(),
      unsent: true,
      unsentAt: Date.now(),
      replyTo: deleteField(),
      reactions: [],
    });
  } catch (error) {
    handleFirestoreError(
      error,
      OperationType.UPDATE,
      `chats/${chatId}/messages/${messageId}`
    );
  }
}

export async function registerFirebasePushNotifications(
  uid: string
): Promise<{ ok: boolean; token?: string; reason?: string }> {
  if (typeof Notification === 'undefined') {
    return { ok: false, reason: 'unsupported' };
  }
  const permission =
    Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, reason: 'denied' };
  }

  const messaging = await getFirebaseMessagingSafe();
  if (!messaging || !VAPID_KEY) {
    return { ok: false, reason: 'messaging-unsupported' };
  }

  try {
    let swReg: ServiceWorkerRegistration | undefined;
    if ('serviceWorker' in navigator) {
      const targetSwUrl = import.meta.env.PROD
        ? '/sw.js'
        : '/firebase-messaging-sw.js';

      // Clean up legacy FCM-scoped or conflicting SW registrations
      try {
        const allRegs = await navigator.serviceWorker.getRegistrations();
        for (const reg of allRegs) {
          const url =
            reg.active?.scriptURL ||
            reg.installing?.scriptURL ||
            reg.waiting?.scriptURL ||
            '';
          if (
            reg.scope.includes('firebase-cloud-messaging-push-scope') ||
            (import.meta.env.PROD && url.includes('firebase-messaging-sw.js'))
          ) {
            await reg.unregister().catch(() => {});
          }
        }
      } catch {
        // Ignore cleanup errors
      }

      const existingRoot = await navigator.serviceWorker.getRegistration('/');
      const existingUrl =
        existingRoot?.active?.scriptURL ||
        existingRoot?.installing?.scriptURL ||
        existingRoot?.waiting?.scriptURL ||
        '';
      if (existingRoot && existingUrl.includes(targetSwUrl.replace(/^\//, ''))) {
        swReg = existingRoot;
      } else {
        swReg = await navigator.serviceWorker.register(targetSwUrl, {
          scope: '/',
        });
      }

      if (!swReg.active) {
        const pending = swReg.installing || swReg.waiting;
        if (
          pending &&
          pending.state !== 'activated' &&
          pending.state !== 'redundant'
        ) {
          await new Promise<void>((resolve) => {
            const timeout = window.setTimeout(() => {
              pending.removeEventListener('statechange', onState);
              resolve();
            }, 6000);
            const onState = () => {
              if (pending.state === 'activated' || pending.state === 'redundant') {
                window.clearTimeout(timeout);
                pending.removeEventListener('statechange', onState);
                resolve();
              }
            };
            pending.addEventListener('statechange', onState);
          });
        }
        if (!swReg.active) {
          swReg = await Promise.race([
            navigator.serviceWorker.ready,
            new Promise<ServiceWorkerRegistration>((resolve) =>
              window.setTimeout(() => resolve(swReg!), 4000)
            ),
          ]);
        }
      }
    }

    let token = '';
    try {
      token = await getToken(messaging, {
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: swReg,
      });
    } catch (firstErr) {
      // Recover from stale PushSubscription or corrupted VAPID subscription
      if (swReg?.pushManager) {
        try {
          const existingSub = await swReg.pushManager.getSubscription();
          if (existingSub) {
            await existingSub.unsubscribe();
          }
          token = await getToken(messaging, {
            vapidKey: VAPID_KEY,
            serviceWorkerRegistration: swReg,
          });
        } catch {
          throw firstErr;
        }
      } else {
        throw firstErr;
      }
    }

    if (token && db) {
      await setDoc(
        doc(db, 'users', uid),
        { fcmToken: token, updatedAt: Date.now() },
        { merge: true }
      );
      return { ok: true, token };
    }
    return { ok: false, reason: 'no-token' };
  } catch (err) {
    console.warn('FCM registration error:', err);
    return { ok: false, reason: 'token-error' };
  }
}

export function syncMutePrefToSw(muted: boolean): void {
  if (typeof caches !== 'undefined') {
    void caches
      .open('notepad-prefs-v1')
      .then((cache) =>
        cache.put('/__mute_pref__', new Response(muted ? '1' : '0'))
      )
      .catch(() => {});
  }
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    try {
      navigator.serviceWorker.controller.postMessage({
        type: 'SET_MUTE_PREF',
        muted,
      });
    } catch {
      // Ignore postMessage failure
    }
  }
}

export function syncActiveChatToSw(
  peerId: string | null,
  visible: boolean
): void {
  if (typeof caches !== 'undefined') {
    void caches
      .open('notepad-prefs-v1')
      .then((cache) =>
        cache.put(
          '/__active_chat__',
          new Response(JSON.stringify({ peerId, visible }))
        )
      )
      .catch(() => {});
  }
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    try {
      navigator.serviceWorker.controller.postMessage({
        type: 'SET_ACTIVE_CHAT',
        peerId,
        visible,
      });
    } catch {
      // Ignore postMessage failure
    }
  }
}

export function markMessageNotifiedInSw(messageId: string): void {
  if (!messageId) return;
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    try {
      navigator.serviceWorker.controller.postMessage({
        type: 'MARK_NOTIFIED',
        messageId,
      });
    } catch {
      // Ignore postMessage failure
    }
  }
}

export async function attachForegroundMessageListener(
  onReminder: (meta?: {
    fromUserId?: string;
    messageId?: string;
    shownInSw?: boolean;
  }) => void
): Promise<() => void> {
  let unsubFcm: (() => void) | null = null;
  const messaging = await getFirebaseMessagingSafe();
  if (messaging) {
    unsubFcm = onMessage(messaging, (payload) => {
      const fromUserId =
        typeof payload?.data?.fromUserId === 'string'
          ? payload.data.fromUserId
          : undefined;
      const messageId =
        typeof payload?.data?.messageId === 'string'
          ? payload.data.messageId
          : undefined;
      onReminder({ fromUserId, messageId, shownInSw: false });
    });
  }

  const handleSwMessage = (event: MessageEvent) => {
    if (event.data && event.data.type === 'NOTEPAD_PUSH_REMINDER') {
      const fromUserId =
        typeof event.data?.payload?.data?.fromUserId === 'string'
          ? event.data.payload.data.fromUserId
          : undefined;
      const messageId =
        typeof event.data?.payload?.data?.messageId === 'string'
          ? event.data.payload.data.messageId
          : undefined;
      const shownInSw = Boolean(event.data?.shownInSw);
      onReminder({ fromUserId, messageId, shownInSw });
    }
  };
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', handleSwMessage);
  }

  return () => {
    unsubFcm?.();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.removeEventListener('message', handleSwMessage);
    }
  };
}
