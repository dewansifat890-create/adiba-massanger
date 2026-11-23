import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
  type PrecacheEntry,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';

interface SWWindowClient {
  focused?: boolean;
  visibilityState?: string;
  url: string;
  focus?: () => Promise<SWWindowClient>;
  postMessage: (message: unknown) => void;
}

interface SWExtendableEvent extends Event {
  waitUntil: (promise: Promise<unknown>) => void;
}

interface SWPushEvent extends SWExtendableEvent {
  data?: {
    json: () => unknown;
    text: () => string;
  } | null;
}

interface SWNotificationEvent extends SWExtendableEvent {
  notification: Notification & { data?: { url?: string } };
}

interface SWMessageEvent extends SWExtendableEvent {
  data?: unknown;
}

interface SWGlobalScope {
  __WB_MANIFEST: Array<PrecacheEntry | string>;
  navigator?: { userAgent?: string };
  skipWaiting: () => Promise<void>;
  clients: {
    claim: () => Promise<void>;
    matchAll: (options: {
      type?: 'window' | 'worker' | 'sharedworker' | 'all';
      includeUncontrolled?: boolean;
    }) => Promise<SWWindowClient[]>;
    openWindow?: (url: string) => Promise<SWWindowClient | null>;
  };
  registration: ServiceWorkerRegistration;
  addEventListener: {
    (type: 'push', listener: (event: SWPushEvent) => void): void;
    (type: 'notificationclick', listener: (event: SWNotificationEvent) => void): void;
    (type: 'install', listener: (event: SWExtendableEvent) => void): void;
    (type: 'activate', listener: (event: SWExtendableEvent) => void): void;
    (type: 'message', listener: (event: SWMessageEvent) => void): void;
  };
}

declare const self: SWGlobalScope;

const PREFS_CACHE_NAME = 'notepad-prefs-v1';
const MUTE_PREF_KEY = '/__mute_pref__';
const ACTIVE_CHAT_KEY = '/__active_chat__';
const recentNotifiedIds = new Set<string>();

function rememberNotifiedId(id: string): void {
  if (!id) return;
  recentNotifiedIds.add(id);
  if (recentNotifiedIds.size > 200) {
    const oldest = recentNotifiedIds.values().next().value;
    if (oldest) recentNotifiedIds.delete(oldest);
  }
}

async function readMutePref(): Promise<boolean> {
  try {
    const cache = await caches.open(PREFS_CACHE_NAME);
    const res = await cache.match(MUTE_PREF_KEY);
    if (!res) return false;
    return (await res.text()) === '1';
  } catch {
    return false;
  }
}

async function readActiveChatPref(): Promise<{
  peerId: string | null;
  visible: boolean;
}> {
  try {
    const cache = await caches.open(PREFS_CACHE_NAME);
    const res = await cache.match(ACTIVE_CHAT_KEY);
    if (!res) return { peerId: null, visible: false };
    const parsed = (await res.json()) as {
      peerId?: string | null;
      visible?: boolean;
    };
    return {
      peerId: typeof parsed.peerId === 'string' ? parsed.peerId : null,
      visible: Boolean(parsed.visible),
    };
  } catch {
    return { peerId: null, visible: false };
  }
}

// Register push & notificationclick SYNCHRONOUSLY at top-level so background wakes
// on iOS PWA and Android Chrome always deliver notifications when the app is closed.
self.addEventListener('push', (event: SWPushEvent) => {
  let payload: {
    notification?: { title?: string; body?: string; icon?: string; badge?: string };
    data?: {
      title?: string;
      body?: string;
      url?: string;
      fromUserId?: string;
      messageId?: string;
    };
    fcmOptions?: { link?: string };
  } = {};

  if (event.data) {
    try {
      payload = event.data.json() as typeof payload;
    } catch {
      try {
        const rawText = event.data.text();
        if (rawText) {
          payload = { data: { body: rawText } };
        }
      } catch {
        // Ignore unparseable push data
      }
    }
  }

  const title =
    payload.notification?.title || payload.data?.title || 'NotePad';
  const body =
    payload.notification?.body ||
    payload.data?.body ||
    'You have a new note reminder';
  const url = payload.data?.url || payload.fcmOptions?.link || '/';
  const fromUserId = payload.data?.fromUserId || '';
  const messageId = payload.data?.messageId || '';
  const ua = (self.navigator?.userAgent || '').toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua);

  event.waitUntil(
    Promise.all([
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }),
      readMutePref(),
      readActiveChatPref(),
    ]).then(([clientList, isMuted, activeChat]) => {
      if (messageId && recentNotifiedIds.has(messageId)) {
        return undefined;
      }

      let hasVisibleClient = false;
      let hasActiveVisibleClient = false;
      for (const client of clientList) {
        if (client.visibilityState === 'visible') {
          hasVisibleClient = true;
          if (client.focused) {
            hasActiveVisibleClient = true;
          }
        }
      }

      const isViewingSenderChat =
        hasVisibleClient &&
        Boolean(fromUserId) &&
        activeChat.visible &&
        activeChat.peerId === fromUserId;

      if (isViewingSenderChat) {
        if (messageId) rememberNotifiedId(messageId);
        return undefined;
      }

      const willShowInSw = isIOS || !hasActiveVisibleClient;

      for (const client of clientList) {
        try {
          client.postMessage({
            type: 'NOTEPAD_PUSH_REMINDER',
            payload,
            shownInSw: willShowInSw,
          });
        } catch {
          // Ignore postMessage failure
        }
      }

      if (messageId) {
        rememberNotifiedId(messageId);
      }

      // Apple WebKit revokes Web Push permission if background push skips showNotification.
      // On Android/Desktop, show whenever app is closed, minimized, or screen is off.
      if (willShowInSw) {
        const notifTag = messageId
          ? `notepad-msg-${messageId}`
          : `notepad-reminder-${Date.now()}`;
        return self.registration.showNotification(title, {
          body,
          icon: '/pwa-192x192.png',
          badge: '/pwa-192x192.png',
          tag: notifTag,
          silent: isMuted,
          data: { url, fromUserId, messageId },
        });
      }
      return undefined;
    })
  );
});

self.addEventListener('notificationclick', (event: SWNotificationEvent) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.focus) return client.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
        return undefined;
      })
  );
});

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event: SWExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event: SWMessageEvent) => {
  const data = event.data as
    | {
        type?: string;
        muted?: boolean;
        peerId?: string | null;
        visible?: boolean;
        messageId?: string;
      }
    | undefined;
  if (!data) return;
  if (data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  } else if (data.type === 'MARK_NOTIFIED' && typeof data.messageId === 'string') {
    rememberNotifiedId(data.messageId);
  } else if (data.type === 'SET_MUTE_PREF') {
    event.waitUntil(
      caches
        .open(PREFS_CACHE_NAME)
        .then((c) => c.put(MUTE_PREF_KEY, new Response(data.muted ? '1' : '0')))
        .catch(() => {})
    );
  } else if (data.type === 'SET_ACTIVE_CHAT') {
    event.waitUntil(
      caches
        .open(PREFS_CACHE_NAME)
        .then((c) =>
          c.put(
            ACTIVE_CHAT_KEY,
            new Response(
              JSON.stringify({
                peerId: data.peerId || null,
                visible: Boolean(data.visible),
              })
            )
          )
        )
        .catch(() => {})
    );
  }
});

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    denylist: [/^\/api\//, /^\/firebase-messaging-sw\.js$/],
  })
);

registerRoute(
  /^https:\/\/fonts\.googleapis\.com\/.*/i,
  new CacheFirst({
    cacheName: 'google-fonts-cache',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 10,
        maxAgeSeconds: 60 * 60 * 24 * 365,
      }),
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
    ],
  }),
  'GET'
);

registerRoute(
  /^https:\/\/fonts\.gstatic\.com\/.*/i,
  new CacheFirst({
    cacheName: 'gstatic-fonts-cache',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 10,
        maxAgeSeconds: 60 * 60 * 24 * 365,
      }),
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
    ],
  }),
  'GET'
);
