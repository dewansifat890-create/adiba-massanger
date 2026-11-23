import 'dotenv/config';
import express from 'express';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { getMessaging as getAdminMessaging } from 'firebase-admin/messaging';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { WebSocket, WebSocketServer } from 'ws';

interface MessengerUser {
  userId: string;
  handle: string;
  displayName: string;
  updatedAt: number;
  lastSeen?: number;
}

interface ChatReaction {
  emoji: string;
  userIds: string[];
}

interface ChatReplyPreview {
  id: string;
  senderName: string;
  text: string;
}

interface DirectMessage {
  id: string;
  dmId: string;
  fromUserId: string;
  toUserId: string;
  senderName: string;
  text: string;
  imageUrl?: string;
  createdAt: number;
  deliveredAt?: number;
  seenAt?: number;
  unsent?: boolean;
  unsentAt?: number;
  replyTo?: ChatReplyPreview;
  reactions?: ChatReaction[];
}

interface PersistedData {
  users: Record<string, MessengerUser>;
  dms: Record<string, DirectMessage[]>;
}

interface ClientMeta {
  ws: WebSocket;
  userId: string | null;
  activeDmId: string | null;
}

const DATA_FILE = path.join(os.tmpdir(), 'notepad-messenger-store-v1.json');
const users = new Map<string, MessengerUser>();
const dms = new Map<string, DirectMessage[]>();

function loadFromDisk(): void {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw) as PersistedData;
    if (parsed?.users && typeof parsed.users === 'object') {
      for (const [id, u] of Object.entries(parsed.users)) {
        if (u && u.userId) users.set(id, u);
      }
    }
    if (parsed?.dms && typeof parsed.dms === 'object') {
      for (const [dmId, list] of Object.entries(parsed.dms)) {
        if (Array.isArray(list)) dms.set(dmId, list);
      }
    }
  } catch {
    // Ignore corrupt cache
  }
}

function saveToDisk(): void {
  try {
    const payload: PersistedData = {
      users: Object.fromEntries(users.entries()),
      dms: Object.fromEntries(
        Array.from(dms.entries()).map(([k, v]) => [k, v.slice(-300)])
      ),
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(payload), 'utf8');
  } catch {
    // Ignore disk errors
  }
}

function makeDmId(userA: string, userB: string): string {
  return [userA, userB].sort().join('__');
}

loadFromDisk();
users.delete('demo-user');

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Map<WebSocket, ClientMeta>();

  server.on('upgrade', (request, socket, head) => {
    try {
      const url = new URL(
        request.url || '/',
        `http://${request.headers.host || 'localhost'}`
      );
      if (url.pathname === '/ws') {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      }
    } catch {
      // Ignore malformed upgrade URLs
    }
  });

  app.use(express.json({ limit: '2mb' }));

  const firebaseProjectId =
    process.env.VITE_FIREBASE_PROJECT_ID || 'adiba-massanger';
  const adminApp = firebaseProjectId
    ? getApps().length
      ? getApp()
      : initializeApp({ projectId: firebaseProjectId })
    : null;

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/firebase-messaging-sw.js', (_req, res) => {
    const script = `
var recentNotifiedIds = new Set();

function rememberNotifiedId(id) {
  if (!id) return;
  recentNotifiedIds.add(id);
  if (recentNotifiedIds.size > 200) {
    var first = recentNotifiedIds.values().next().value;
    if (first) recentNotifiedIds.delete(first);
  }
}

function readPrefBool(key) {
  return caches.open('notepad-prefs-v1').then(function (cache) {
    return cache.match(key);
  }).then(function (res) {
    if (!res) return false;
    return res.text().then(function (t) { return t === '1'; });
  }).catch(function () { return false; });
}

function readActiveChat() {
  return caches.open('notepad-prefs-v1').then(function (cache) {
    return cache.match('/__active_chat__');
  }).then(function (res) {
    if (!res) return { peerId: null, visible: false };
    return res.json();
  }).catch(function () { return { peerId: null, visible: false }; });
}

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', function (event) {
  var d = event.data;
  if (!d || typeof d !== 'object') return;
  if (d.type === 'MARK_NOTIFIED' && typeof d.messageId === 'string') {
    rememberNotifiedId(d.messageId);
  } else if (d.type === 'SET_MUTE_PREF') {
    event.waitUntil(caches.open('notepad-prefs-v1').then(function (c) {
      return c.put('/__mute_pref__', new Response(d.muted ? '1' : '0'));
    }).catch(function () {}));
  } else if (d.type === 'SET_ACTIVE_CHAT') {
    event.waitUntil(caches.open('notepad-prefs-v1').then(function (c) {
      return c.put('/__active_chat__', new Response(JSON.stringify({ peerId: d.peerId || null, visible: Boolean(d.visible) })));
    }).catch(function () {}));
  }
});

self.addEventListener('push', function (event) {
  var payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (e) {
      try {
        payload = { data: { body: event.data.text() } };
      } catch (err) {}
    }
  }
  var notif = payload.notification || payload.data || {};
  var title = notif.title || 'NotePad';
  var body = notif.body || 'You have a new note reminder';
  var url = (payload.data && payload.data.url) || (payload.fcmOptions && payload.fcmOptions.link) || '/';
  var fromUserId = (payload.data && payload.data.fromUserId) || '';
  var messageId = (payload.data && payload.data.messageId) || '';
  var ua = (self.navigator && self.navigator.userAgent ? self.navigator.userAgent : '').toLowerCase();
  var isIOS = /iphone|ipad|ipod/.test(ua);

  event.waitUntil(
    Promise.all([
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }),
      readPrefBool('/__mute_pref__'),
      readActiveChat()
    ]).then(function (results) {
      if (messageId && recentNotifiedIds.has(messageId)) {
        return undefined;
      }
      var clientList = results[0];
      var isMuted = results[1];
      var activeChat = results[2] || {};
      var hasVisibleClient = false;
      var hasActiveVisible = false;
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.visibilityState === 'visible') {
          hasVisibleClient = true;
          if (client.focused) hasActiveVisible = true;
        }
      }
      var isViewingSenderChat = hasVisibleClient && Boolean(fromUserId) && activeChat.visible === true && activeChat.peerId === fromUserId;
      if (isViewingSenderChat) {
        if (messageId) rememberNotifiedId(messageId);
        return undefined;
      }
      var willShowInSw = isIOS || !hasActiveVisible;
      for (var j = 0; j < clientList.length; j++) {
        try {
          clientList[j].postMessage({ type: 'NOTEPAD_PUSH_REMINDER', payload: payload, shownInSw: willShowInSw });
        } catch (err) {}
      }
      if (messageId) rememberNotifiedId(messageId);
      if (willShowInSw) {
        var notifTag = messageId ? ('notepad-msg-' + messageId) : ('notepad-reminder-' + Date.now());
        return self.registration.showNotification(title, {
          body: body,
          icon: '/pwa-192x192.png',
          badge: '/pwa-192x192.png',
          tag: notifTag,
          renotify: false,
          silent: Boolean(isMuted),
          data: { url: url, fromUserId: fromUserId, messageId: messageId }
        });
      }
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var targetUrl = (event.notification && event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
`.trim();

    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Service-Worker-Allowed', '/');
    res.send(script);
  });

  app.post('/api/push/reminder', async (req, res) => {
    if (!adminApp) {
      res.json({ ok: true, pushed: false, reason: 'firebase_not_configured' });
      return;
    }

    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : '';
    if (!token) {
      res.status(401).json({ ok: false, error: 'Missing bearer token' });
      return;
    }

    let callerUid = '';
    try {
      const decoded = await getAdminAuth(adminApp).verifyIdToken(token);
      callerUid = decoded.uid;
    } catch {
      res.status(401).json({ ok: false, error: 'Invalid auth token' });
      return;
    }

    if (req.body?.warmup === true) {
      res.json({ ok: true, warmed: true });
      return;
    }

    const toUserId =
      typeof req.body?.toUserId === 'string' ? req.body.toUserId.trim() : '';
    if (!/^[A-Za-z0-9_-]{4,128}$/.test(toUserId) || toUserId === callerUid) {
      res.status(400).json({ ok: false, error: 'Invalid recipient' });
      return;
    }

    const rawMsgId =
      typeof req.body?.messageId === 'string' ? req.body.messageId.trim() : '';
    const cleanMsgId = /^[A-Za-z0-9_-]{4,128}$/.test(rawMsgId) ? rawMsgId : '';

    try {
      const adminDb = getAdminFirestore(adminApp);
      const chatId = makeDmId(callerUid, toUserId);
      const [chatDoc, recipientDoc] = await Promise.all([
        adminDb.collection('chats').doc(chatId).get(),
        adminDb.collection('users').doc(toUserId).get(),
      ]);
      if (!chatDoc.exists) {
        res.status(403).json({ ok: false, error: 'Not a participant' });
        return;
      }
      const participants = chatDoc.data()?.participants;
      if (
        !Array.isArray(participants) ||
        !participants.includes(callerUid) ||
        !participants.includes(toUserId)
      ) {
        res.status(403).json({ ok: false, error: 'Access denied' });
        return;
      }

      const fcmToken = recipientDoc.data()?.fcmToken;
      if (typeof fcmToken !== 'string' || !fcmToken) {
        res.json({ ok: true, pushed: false, reason: 'no_fcm_token' });
        return;
      }

      const tagId = cleanMsgId
        ? `notepad-msg-${cleanMsgId}`
        : `notepad-reminder-${Date.now()}`;
      await getAdminMessaging(adminApp).send({
        token: fcmToken,
        notification: {
          title: 'NotePad',
          body: 'You have a new note reminder',
        },
        data: {
          title: 'NotePad',
          body: 'You have a new note reminder',
          url: '/',
          fromUserId: callerUid,
          ...(cleanMsgId ? { messageId: cleanMsgId } : {}),
        },
        webpush: {
          headers: {
            Urgency: 'high',
            TTL: '86400',
          },
          notification: {
            title: 'NotePad',
            body: 'You have a new note reminder',
            icon: '/pwa-192x192.png',
            badge: '/pwa-192x192.png',
            tag: tagId,
            renotify: false,
          },
          fcmOptions: {
            link: '/',
          },
        },
      });

      res.json({ ok: true, pushed: true });
    } catch (err: unknown) {
      const errCode =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code: unknown }).code)
          : 'push_unavailable';
      if (
        errCode === 'messaging/registration-token-not-registered' ||
        errCode === 'messaging/invalid-registration-token'
      ) {
        try {
          await getAdminFirestore(adminApp)
            .collection('users')
            .doc(toUserId)
            .set({ fcmToken: null }, { merge: true });
        } catch {
          // Ignore cleanup error
        }
      }
      console.warn('FCM reminder send skipped:', errCode);
      res.json({ ok: true, pushed: false, reason: errCode });
    }
  });

  app.post('/api/upload-image', async (req, res) => {
    const imgbbKey = process.env.IMGBB_API_KEY?.trim();
    if (!imgbbKey) {
      res.status(503).json({ ok: false, error: 'missing_imgbb_api_key' });
      return;
    }

    if (adminApp) {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length).trim()
        : '';
      if (!token) {
        res.status(401).json({ ok: false, error: 'Missing bearer token' });
        return;
      }
      try {
        await getAdminAuth(adminApp).verifyIdToken(token);
      } catch {
        res.status(401).json({ ok: false, error: 'Invalid auth token' });
        return;
      }
    }

    const rawBase64 =
      typeof req.body?.imageBase64 === 'string'
        ? req.body.imageBase64.trim()
        : '';
    const cleanBase64 = rawBase64.replace(
      /^data:image\/[a-zA-Z0-9+.-]+;base64,/,
      ''
    );
    if (!cleanBase64 || cleanBase64.length > 2_000_000) {
      res
        .status(400)
        .json({ ok: false, error: 'Invalid or oversized image payload' });
      return;
    }

    const cleanName =
      typeof req.body?.name === 'string' && req.body.name.trim()
        ? req.body.name.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48)
        : `img_${Date.now()}`;

    try {
      const form = new URLSearchParams();
      form.set('image', cleanBase64);
      if (cleanName) form.set('name', cleanName);

      const uploadRes = await fetch(
        `https://api.imgbb.com/1/upload?key=${encodeURIComponent(imgbbKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
        }
      );

      const uploadJson = (await uploadRes.json().catch(() => ({}))) as {
        success?: boolean;
        data?: {
          url?: string;
          display_url?: string;
          thumb?: { url?: string };
        };
        error?: { message?: string };
      };

      const imageUrl = uploadJson.data?.display_url || uploadJson.data?.url;
      if (!uploadRes.ok || !uploadJson.success || !imageUrl) {
        res.status(502).json({
          ok: false,
          error: uploadJson.error?.message || 'imgbb_upload_failed',
        });
        return;
      }

      res.json({
        ok: true,
        url: imageUrl,
        thumbUrl: uploadJson.data?.thumb?.url || imageUrl,
      });
    } catch {
      res.status(502).json({ ok: false, error: 'upload_unavailable' });
    }
  });

  function getUserSockets(userId: string): WebSocket[] {
    const list: WebSocket[] = [];
    for (const meta of clients.values()) {
      if (meta.userId === userId && meta.ws.readyState === WebSocket.OPEN) {
        list.push(meta.ws);
      }
    }
    return list;
  }

  function isUserOnline(userId: string): boolean {
    return getUserSockets(userId).length > 0;
  }

  function sendToUser(userId: string, payload: unknown): void {
    const encoded = JSON.stringify(payload);
    for (const socket of getUserSockets(userId)) {
      socket.send(encoded);
    }
  }

  function broadcastOnlineDirectory(): void {
    const onlineUserIds = Array.from(
      new Set(
        Array.from(clients.values())
          .filter((m) => m.userId && m.ws.readyState === WebSocket.OPEN)
          .map((m) => m.userId as string)
      )
    );
    const lastSeenMap: Record<string, number> = {};
    for (const [uid, u] of users.entries()) {
      if (typeof u.lastSeen === 'number') {
        lastSeenMap[uid] = u.lastSeen;
      }
    }
    const encoded = JSON.stringify({
      type: 'presence:list',
      onlineUserIds,
      lastSeenMap,
    });
    for (const meta of clients.values()) {
      if (meta.ws.readyState === WebSocket.OPEN) {
        meta.ws.send(encoded);
      }
    }
  }

  wss.on('connection', (ws) => {
    clients.set(ws, { ws, userId: null, activeDmId: null });

    ws.on('message', (raw) => {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        return;
      }

      const meta = clients.get(ws);
      if (!meta) return;

      if (data.type === 'auth:register') {
        const userId =
          typeof data.userId === 'string' && data.userId.trim()
            ? data.userId.trim()
            : '';
        const handle =
          typeof data.handle === 'string' && data.handle.trim()
            ? data.handle.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
            : '';
        const displayName =
          typeof data.displayName === 'string' && data.displayName.trim()
            ? data.displayName.trim()
            : 'User';
        if (!userId || !handle) return;

        meta.userId = userId;
        const now = Date.now();
        const userRecord: MessengerUser = {
          userId,
          handle,
          displayName,
          updatedAt: now,
          lastSeen: now,
        };
        users.set(userId, userRecord);
        saveToDisk();

        // Mark pending incoming messages for this user as delivered now that they're online
        const myConversations: Record<string, DirectMessage[]> = {};
        const peerProfiles: MessengerUser[] = [];
        const updatedDeliveredChats: { peerId: string; dmId: string; deliveredAt: number }[] = [];
        for (const [dmId, msgs] of dms.entries()) {
          const parts = dmId.split('__');
          if (parts.includes(userId)) {
            let changed = false;
            for (const m of msgs) {
              if (m.toUserId === userId && !m.deliveredAt) {
                m.deliveredAt = now;
                changed = true;
              }
            }
            myConversations[dmId] = msgs;
            const otherId = parts.find((p) => p !== userId);
            if (otherId) {
              if (users.has(otherId)) {
                peerProfiles.push(users.get(otherId)!);
              }
              if (changed) {
                updatedDeliveredChats.push({ peerId: otherId, dmId, deliveredAt: now });
              }
            }
          }
        }
        if (updatedDeliveredChats.length > 0) saveToDisk();

        ws.send(
          JSON.stringify({
            type: 'auth:ready',
            user: userRecord,
            conversations: myConversations,
            peers: peerProfiles,
          })
        );
        for (const item of updatedDeliveredChats) {
          sendToUser(item.peerId, {
            type: 'dm:receipt',
            dmId: item.dmId,
            byUserId: userId,
            deliveredAt: item.deliveredAt,
          });
        }
        broadcastOnlineDirectory();
        return;
      }

      if (data.type === 'user:lookup') {
        const query =
          typeof data.query === 'string'
            ? data.query.trim().toLowerCase().replace(/^@/, '')
            : '';
        if (!query) return;

        let found: MessengerUser | null = null;
        for (const u of users.values()) {
          if (u.userId.toLowerCase() === query || u.handle.toLowerCase() === query) {
            found = u;
            break;
          }
        }

        if (found) {
          ws.send(
            JSON.stringify({
              type: 'user:found',
              user: found,
              online: isUserOnline(found.userId),
            })
          );
        } else {
          ws.send(
            JSON.stringify({
              type: 'user:not_found',
              query,
            })
          );
        }
        return;
      }

      if (data.type === 'dm:join') {
        if (!meta.userId) return;
        const peerId = typeof data.peerId === 'string' ? data.peerId.trim() : '';
        if (!peerId) return;
        const dmId = makeDmId(meta.userId, peerId);
        meta.activeDmId = dmId;
        const messages = dms.get(dmId) ?? [];
        const now = Date.now();
        let seenUpdated = false;
        for (const m of messages) {
          if (m.toUserId === meta.userId) {
            if (!m.deliveredAt) m.deliveredAt = now;
            if (!m.seenAt) {
              m.seenAt = now;
              seenUpdated = true;
            }
          }
        }
        if (seenUpdated) {
          saveToDisk();
          sendToUser(peerId, {
            type: 'dm:receipt',
            dmId,
            byUserId: meta.userId,
            deliveredAt: now,
            seenAt: now,
          });
        }
        ws.send(
          JSON.stringify({
            type: 'dm:init',
            dmId,
            peerId,
            messages,
          })
        );
        return;
      }

      if (data.type === 'dm:send') {
        if (!meta.userId) return;
        const toUserId =
          typeof data.toUserId === 'string' ? data.toUserId.trim() : '';
        const incoming = data.message as Partial<DirectMessage> | undefined;
        if (!toUserId || !incoming || typeof incoming.id !== 'string') return;
        const text = typeof incoming.text === 'string' ? incoming.text.trim() : '';
        if (!text) return;

        const dmId = makeDmId(meta.userId, toUserId);
        const senderProfile = users.get(meta.userId);
        const now = Date.now();
        const recipientOnline = isUserOnline(toUserId);
        const msg: DirectMessage = {
          id: incoming.id,
          dmId,
          fromUserId: meta.userId,
          toUserId,
          senderName:
            senderProfile?.displayName ||
            (typeof incoming.senderName === 'string' ? incoming.senderName : 'User'),
          text,
          createdAt:
            typeof incoming.createdAt === 'number' ? incoming.createdAt : now,
          deliveredAt: recipientOnline ? now : undefined,
          replyTo: incoming.replyTo,
          reactions: [],
        };

        const list = dms.get(dmId) ?? [];
        if (list.some((m) => m.id === msg.id)) return;
        list.push(msg);
        if (list.length > 300) list.splice(0, list.length - 300);
        dms.set(dmId, list);
        saveToDisk();

        sendToUser(meta.userId, {
          type: 'dm:message',
          dmId,
          message: msg,
        });
        if (toUserId !== meta.userId) {
          sendToUser(toUserId, {
            type: 'dm:message',
            dmId,
            message: msg,
            fromUser: senderProfile ?? {
              userId: meta.userId,
              handle: meta.userId,
              displayName: msg.senderName,
              updatedAt: now,
            },
          });
        }
        return;
      }

      if (data.type === 'dm:react') {
        if (!meta.userId) return;
        const dmId = typeof data.dmId === 'string' ? data.dmId : '';
        const messageId = typeof data.messageId === 'string' ? data.messageId : '';
        const emoji = typeof data.emoji === 'string' ? data.emoji : '';
        if (!dmId || !messageId || !emoji) return;

        const list = dms.get(dmId) ?? [];
        const target = list.find((m) => m.id === messageId);
        if (!target) return;

        const reactions = target.reactions ? [...target.reactions] : [];
        const idx = reactions.findIndex((r) => r.emoji === emoji);
        if (idx >= 0) {
          const entry = reactions[idx];
          if (entry.userIds.includes(meta.userId)) {
            const nextIds = entry.userIds.filter((id) => id !== meta.userId);
            if (nextIds.length === 0) reactions.splice(idx, 1);
            else reactions[idx] = { ...entry, userIds: nextIds };
          } else {
            reactions[idx] = { ...entry, userIds: [...entry.userIds, meta.userId] };
          }
        } else {
          reactions.push({ emoji, userIds: [meta.userId] });
        }
        target.reactions = reactions;
        saveToDisk();

        const [u1, u2] = dmId.split('__');
        if (u1) sendToUser(u1, { type: 'dm:updated', dmId, message: target });
        if (u2 && u2 !== u1) sendToUser(u2, { type: 'dm:updated', dmId, message: target });
        return;
      }

      if (data.type === 'dm:delete') {
        if (!meta.userId) return;
        const dmId = typeof data.dmId === 'string' ? data.dmId : '';
        const messageId = typeof data.messageId === 'string' ? data.messageId : '';
        if (!dmId || !messageId) return;

        const list = dms.get(dmId) ?? [];
        const target = list.find((m) => m.id === messageId);
        if (!target || target.fromUserId !== meta.userId) return;
        target.text = '';
        target.unsent = true;
        target.unsentAt = Date.now();
        delete target.replyTo;
        target.reactions = [];
        saveToDisk();

        const [u1, u2] = dmId.split('__');
        if (u1) sendToUser(u1, { type: 'dm:updated', dmId, message: target });
        if (u2 && u2 !== u1) sendToUser(u2, { type: 'dm:updated', dmId, message: target });
        return;
      }

      if (data.type === 'dm:typing') {
        if (!meta.userId) return;
        const toUserId = typeof data.toUserId === 'string' ? data.toUserId : '';
        if (!toUserId) return;
        sendToUser(toUserId, {
          type: 'dm:typing',
          fromUserId: meta.userId,
          isTyping: Boolean(data.isTyping),
        });
        return;
      }

      if (data.type === 'dm:seen') {
        if (!meta.userId) return;
        const peerId = typeof data.peerId === 'string' ? data.peerId.trim() : '';
        if (!peerId) return;
        const dmId = makeDmId(meta.userId, peerId);
        const list = dms.get(dmId) ?? [];
        const now = Date.now();
        let changed = false;
        for (const m of list) {
          if (m.toUserId === meta.userId) {
            if (!m.deliveredAt) m.deliveredAt = now;
            if (!m.seenAt) {
              m.seenAt = now;
              changed = true;
            }
          }
        }
        if (changed) {
          saveToDisk();
          sendToUser(peerId, {
            type: 'dm:receipt',
            dmId,
            byUserId: meta.userId,
            deliveredAt: now,
            seenAt: now,
          });
        }
      }
    });

    ws.on('close', () => {
      const closedMeta = clients.get(ws);
      clients.delete(ws);
      if (closedMeta?.userId && !isUserOnline(closedMeta.userId)) {
        const existing = users.get(closedMeta.userId);
        if (existing) {
          existing.lastSeen = Date.now();
          users.set(closedMeta.userId, existing);
          saveToDisk();
        }
      }
      broadcastOnlineDirectory();
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server },
        ws: { server },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const PORT = 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

startServer();
