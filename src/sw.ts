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

// Register push & notificationclick SYNCHRONOUSLY at top-level so background wakes
// on iOS PWA and Android Chrome always deliver notifications when the app is closed.
self.addEventListener('push', (event: SWPushEvent) => {
  let payload: {
    notification?: { title?: string; body?: string; icon?: string; badge?: string };
    data?: { title?: string; body?: string; url?: string };
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
  const ua = (self.navigator?.userAgent || '').toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua);

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        let hasActiveVisibleClient = false;
        for (const client of clientList) {
          try {
            client.postMessage({ type: 'NOTEPAD_PUSH_REMINDER', payload });
          } catch {
            // Ignore postMessage failure
          }
          if (client.visibilityState === 'visible' && client.focused) {
            hasActiveVisibleClient = true;
          }
        }

        // Apple WebKit revokes Web Push permission if any push event skips showNotification.
        // On Android/Desktop, always show when app is closed, minimized, or screen is off.
        if (isIOS || !hasActiveVisibleClient) {
          return self.registration.showNotification(title, {
            body,
            icon: '/pwa-192x192.png',
            badge: '/pwa-192x192.png',
            tag: `notepad-reminder-${Date.now()}`,
            data: { url },
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
  if (event.data && (event.data as { type?: string }).type === 'SKIP_WAITING') {
    void self.skipWaiting();
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
