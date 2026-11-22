import {
  App,
  cert,
  getApps,
  initializeApp,
  ServiceAccount,
} from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { getMessaging as getAdminMessaging } from 'firebase-admin/messaging';

function makeDmId(userA: string, userB: string): string {
  return [userA, userB].sort().join('__');
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function parseServiceAccount(): ServiceAccount | null {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (rawJson) {
    try {
      const parsed = (
        rawJson.startsWith('{')
          ? JSON.parse(rawJson)
          : JSON.parse(Buffer.from(rawJson, 'base64').toString('utf8'))
      ) as ServiceAccount & { private_key?: string; project_id?: string; client_email?: string };

      const privateKey = (parsed.privateKey || parsed.private_key || '').replace(
        /\\n/g,
        '\n'
      );
      const clientEmail = parsed.clientEmail || parsed.client_email || '';
      const projectId =
        parsed.projectId ||
        parsed.project_id ||
        process.env.VITE_FIREBASE_PROJECT_ID ||
        'adiba-massanger';

      if (privateKey && clientEmail && projectId) {
        return { projectId, clientEmail, privateKey };
      }
    } catch {
      // Fall through to individual env vars
    }
  }

  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    'adiba-massanger';
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim() || '';
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(
    /\\n/g,
    '\n'
  );

  if (projectId && clientEmail && privateKey) {
    return { projectId, clientEmail, privateKey };
  }
  return null;
}

function getOrInitAdminApp(): { app: App | null; missingCredentials: boolean } {
  const appName = 'netlify-push-admin';
  const existing = getApps().find((a) => a.name === appName);
  if (existing) {
    return { app: existing, missingCredentials: false };
  }

  const sa = parseServiceAccount();
  if (!sa) {
    return { app: null, missingCredentials: true };
  }

  const app = initializeApp({ credential: cert(sa) }, appName);
  return { app, missingCredentials: false };
}

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  const { app: adminApp, missingCredentials } = getOrInitAdminApp();
  if (!adminApp || missingCredentials) {
    return jsonResponse({
      ok: true,
      pushed: false,
      reason: 'missing_firebase_service_account',
    });
  }

  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : '';
  if (!token) {
    return jsonResponse({ ok: false, error: 'Missing bearer token' }, 401);
  }

  let callerUid = '';
  try {
    const decoded = await getAdminAuth(adminApp).verifyIdToken(token);
    callerUid = decoded.uid;
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid auth token' }, 401);
  }

  let bodyData: { toUserId?: unknown } = {};
  try {
    bodyData = (await req.json()) as { toUserId?: unknown };
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const toUserId =
    typeof bodyData?.toUserId === 'string' ? bodyData.toUserId.trim() : '';
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(toUserId) || toUserId === callerUid) {
    return jsonResponse({ ok: false, error: 'Invalid recipient' }, 400);
  }

  try {
    const adminDb = getAdminFirestore(adminApp);
    const chatId = makeDmId(callerUid, toUserId);
    const chatDoc = await adminDb.collection('chats').doc(chatId).get();
    if (!chatDoc.exists) {
      return jsonResponse({ ok: false, error: 'Not a participant' }, 403);
    }
    const participants = chatDoc.data()?.participants;
    if (
      !Array.isArray(participants) ||
      !participants.includes(callerUid) ||
      !participants.includes(toUserId)
    ) {
      return jsonResponse({ ok: false, error: 'Access denied' }, 403);
    }

    const recipientDoc = await adminDb.collection('users').doc(toUserId).get();
    const fcmToken = recipientDoc.data()?.fcmToken;
    if (typeof fcmToken !== 'string' || !fcmToken) {
      return jsonResponse({ ok: true, pushed: false, reason: 'no_fcm_token' });
    }

    const tagId = `notepad-reminder-${Date.now()}`;
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
          renotify: true,
        },
        fcmOptions: {
          link: '/',
        },
      },
    });

    return jsonResponse({ ok: true, pushed: true });
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
    console.warn('Netlify FCM reminder send skipped:', errCode);
    return jsonResponse({ ok: true, pushed: false, reason: errCode });
  }
};
