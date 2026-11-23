import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { getAnalytics, isSupported as isAnalyticsSupported } from 'firebase/analytics';
import { Auth, getAuth } from 'firebase/auth';
import { Database, getDatabase } from 'firebase/database';
import {
  doc,
  Firestore,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import {
  getMessaging,
  isSupported as isMessagingSupported,
  Messaging,
} from 'firebase/messaging';

export const firebaseConfig = {
  apiKey:
    import.meta.env.VITE_FIREBASE_API_KEY ||
    'AIzaSyAV5IDF9Fd0Kii5UE4z_3q4XlI-Gx70Woc',
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ||
    'adiba-massanger.firebaseapp.com',
  databaseURL:
    import.meta.env.VITE_FIREBASE_DATABASE_URL ||
    'https://adiba-massanger-default-rtdb.firebaseio.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'adiba-massanger',
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ||
    'adiba-massanger.firebasestorage.app',
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '892763194508',
  appId:
    import.meta.env.VITE_FIREBASE_APP_ID ||
    '1:892763194508:web:5914d6715f8c9aefa8e7a9',
  measurementId:
    import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-QSSDC3L2H1',
};

export const VAPID_KEY =
  import.meta.env.VITE_FIREBASE_VAPID_KEY ||
  'BChojSp4hGSJrshbzbUQ5Cef_KICoHDO0nSsfzliM1BffALRYhLsQLeEwQ2IbRMGApNf3gR_Y50zy-FXJxWwaYA';

export function isFirebaseConfigured(): boolean {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.projectId &&
      firebaseConfig.appId
  );
}

let cachedApp: FirebaseApp | null = null;
let cachedAuth: Auth | null = null;
let cachedDb: Firestore | null = null;
let cachedRtdb: Database | null = null;

if (isFirebaseConfigured()) {
  cachedApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
  cachedAuth = getAuth(cachedApp);
  try {
    cachedDb = initializeFirestore(cachedApp, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch {
    cachedDb = getFirestore(cachedApp);
  }
  if (firebaseConfig.databaseURL) {
    try {
      cachedRtdb = getDatabase(cachedApp);
    } catch {
      cachedRtdb = null;
    }
  }

  if (typeof window !== 'undefined' && firebaseConfig.measurementId) {
    void isAnalyticsSupported().then((supported) => {
      if (supported && cachedApp) {
        try {
          getAnalytics(cachedApp);
        } catch {
          // Ignore analytics errors in restricted contexts
        }
      }
    });
  }
}

export const firebaseApp = cachedApp;
export const auth = cachedAuth;
export const db = cachedDb;
export const rtdb = cachedRtdb;

export async function getFirebaseMessagingSafe(): Promise<Messaging | null> {
  if (!cachedApp || typeof window === 'undefined') return null;
  try {
    const supported = await isMessagingSupported();
    if (!supported) return null;
    return getMessaging(cachedApp);
  } catch {
    return null;
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const currentUser = auth?.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid ?? null,
      email: currentUser?.email ?? null,
      emailVerified: currentUser?.emailVerified ?? null,
      isAnonymous: currentUser?.isAnonymous ?? null,
      tenantId: currentUser?.tenantId ?? null,
      providerInfo:
        currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<{
  ok: boolean;
  error?: string;
}> {
  if (!db) {
    return { ok: false, error: 'Firebase is not configured' };
  }
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return { ok: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
      return { ok: false, error: 'offline' };
    }
    // Permission denied on /test/connection still proves Firestore server is reachable
    return { ok: true };
  }
}
