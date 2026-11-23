import { createSign, createVerify } from 'node:crypto';

interface ServiceAccountCreds {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

interface CachedAccessToken {
  token: string;
  expiresAt: number;
  cacheKey: string;
}

interface CachedCerts {
  certs: Record<string, string>;
  expiresAt: number;
}

interface CachedEntry<T> {
  value: T;
  expiresAt: number;
}

const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/datastore',
  'https://www.googleapis.com/auth/firebase.messaging',
].join(' ');

const WARM_TTL_MS = 45_000;

let cachedAccessToken: CachedAccessToken | null = null;
let cachedCerts: CachedCerts | null = null;
const chatAuthCache = new Map<string, CachedEntry<boolean>>();

function makeDmId(userA: string, userB: string): string {
  return [userA, userB].sort().join('__');
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

function base64UrlDecodeJson<T>(segment: string): T | null {
  try {
    const raw = Buffer.from(segment, 'base64url').toString('utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function parseServiceAccount(): ServiceAccountCreds | null {
  let rawJson = process.env.FIREBASE_SERVICE_ACCOUNT?.trim() || '';
  if (
    (rawJson.startsWith("'") && rawJson.endsWith("'")) ||
    (rawJson.startsWith('"') && rawJson.endsWith('"') && !rawJson.startsWith('{"'))
  ) {
    rawJson = rawJson.slice(1, -1).trim();
  }

  if (rawJson) {
    try {
      const parsed = (
        rawJson.startsWith('{')
          ? JSON.parse(rawJson)
          : JSON.parse(Buffer.from(rawJson, 'base64').toString('utf8'))
      ) as {
        privateKey?: string;
        private_key?: string;
        clientEmail?: string;
        client_email?: string;
        projectId?: string;
        project_id?: string;
      };

      const privateKey = (parsed.privateKey || parsed.private_key || '').replace(
        /\\n/g,
        '\n'
      );
      const clientEmail = (parsed.clientEmail || parsed.client_email || '').trim();
      const projectId = (
        parsed.projectId ||
        parsed.project_id ||
        process.env.VITE_FIREBASE_PROJECT_ID ||
        'adiba-massanger'
      ).trim();

      if (privateKey && clientEmail && projectId) {
        return { projectId, clientEmail, privateKey };
      }
    } catch {
      // Fall through to individual env vars
    }
  }

  const projectId = (
    process.env.FIREBASE_PROJECT_ID ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    'adiba-massanger'
  ).trim();
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

async function getGoogleCerts(forceRefresh = false): Promise<Record<string, string>> {
  const now = Date.now();
  if (!forceRefresh && cachedCerts && cachedCerts.expiresAt > now) {
    return cachedCerts.certs;
  }

  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) {
    throw new Error(`Failed to load Google public certs: ${res.status}`);
  }
  const certs = (await res.json()) as Record<string, string>;
  const cc = res.headers.get('cache-control') || '';
  const maxAgeMatch = cc.match(/max-age=(\d+)/i);
  const ttlMs = maxAgeMatch ? Number(maxAgeMatch[1]) * 1000 : 3600 * 1000;
  cachedCerts = {
    certs,
    expiresAt: now + Math.max(60_000, ttlMs),
  };
  return certs;
}

async function verifyFirebaseIdToken(
  idToken: string,
  projectId: string
): Promise<string> {
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed JWT');
  }
  const [headerB64, payloadB64, sigB64] = parts;

  const header = base64UrlDecodeJson<{ alg?: string; kid?: string }>(headerB64);
  const payload = base64UrlDecodeJson<{
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    auth_time?: number;
  }>(payloadB64);

  if (!header || !payload) {
    throw new Error('Invalid JWT JSON');
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
    throw new Error('Unsupported JWT algorithm or missing kid');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) {
    throw new Error('JWT audience mismatch');
  }
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error('JWT issuer mismatch');
  }
  if (
    typeof payload.sub !== 'string' ||
    payload.sub.length === 0 ||
    payload.sub.length > 128
  ) {
    throw new Error('Invalid JWT subject');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new Error('JWT expired');
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) {
    throw new Error('JWT issued in future');
  }
  if (typeof payload.auth_time !== 'number' || payload.auth_time > nowSec + 300) {
    throw new Error('Invalid auth_time');
  }

  let certs = await getGoogleCerts(false);
  let certPem = certs[header.kid];
  if (!certPem) {
    certs = await getGoogleCerts(true);
    certPem = certs[header.kid];
  }
  if (!certPem) {
    throw new Error('Unknown signing key');
  }

  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const sigBuf = Buffer.from(sigB64, 'base64url');
  if (!verifier.verify(certPem, sigBuf)) {
    throw new Error('Invalid JWT signature');
  }

  return payload.sub;
}

async function getGoogleAccessToken(sa: ServiceAccountCreds): Promise<string> {
  const now = Date.now();
  const cacheKey = `${sa.projectId}:${sa.clientEmail}`;
  if (
    cachedAccessToken &&
    cachedAccessToken.cacheKey === cacheKey &&
    cachedAccessToken.expiresAt > now + 60_000
  ) {
    return cachedAccessToken.token;
  }

  const iat = Math.floor(now / 1000);
  const exp = iat + 3600;
  const headerSegment = base64UrlEncode(
    JSON.stringify({ alg: 'RS256', typ: 'JWT' })
  );
  const claimSegment = base64UrlEncode(
    JSON.stringify({
      iss: sa.clientEmail,
      scope: OAUTH_SCOPES,
      aud: OAUTH_TOKEN_URL,
      iat,
      exp,
    })
  );
  const signingInput = `${headerSegment}.${claimSegment}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = base64UrlEncode(signer.sign(sa.privateKey));
  const assertion = `${signingInput}.${signature}`;

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const tokenRes = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text().catch(() => '');
    throw new Error(`OAuth token exchange failed (${tokenRes.status}): ${errText}`);
  }

  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!tokenJson.access_token) {
    throw new Error('Missing access_token in OAuth response');
  }

  const ttlMs = (tokenJson.expires_in ?? 3600) * 1000;
  cachedAccessToken = {
    token: tokenJson.access_token,
    expiresAt: now + ttlMs,
    cacheKey,
  };
  return tokenJson.access_token;
}

interface FirestoreValue {
  stringValue?: string;
  nullValue?: null;
  arrayValue?: {
    values?: Array<{ stringValue?: string }>;
  };
  mapValue?: {
    fields?: Record<string, FirestoreValue>;
  };
}

interface FirestoreDocResponse {
  fields?: Record<string, FirestoreValue>;
}

async function getFirestoreDoc(
  projectId: string,
  accessToken: string,
  docPath: string
): Promise<FirestoreDocResponse | null> {
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/(default)/documents/${docPath}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Firestore read failed (${res.status}): ${errText}`);
  }
  return (await res.json()) as FirestoreDocResponse;
}

interface DeadTokenCleanup {
  clearLegacySingle: boolean;
  deadDeviceKeys: string[];
}

async function clearDeadFcmTokens(
  projectId: string,
  accessToken: string,
  userId: string,
  cleanup: DeadTokenCleanup
): Promise<void> {
  const maskParams: string[] = [];
  const fields: Record<string, FirestoreValue> = {};

  if (cleanup.clearLegacySingle) {
    maskParams.push('updateMask.fieldPaths=fcmToken');
    fields.fcmToken = { nullValue: null };
  }

  const safeKeys = cleanup.deadDeviceKeys.filter((k) =>
    /^[A-Za-z0-9_-]{1,64}$/.test(k)
  );
  if (safeKeys.length > 0) {
    const mapFields: Record<string, FirestoreValue> = {};
    for (const k of safeKeys) {
      maskParams.push(`updateMask.fieldPaths=${encodeURIComponent(`fcmTokens.${k}`)}`);
      mapFields[k] = { nullValue: null };
    }
    fields.fcmTokens = { mapValue: { fields: mapFields } };
  }

  if (maskParams.length === 0) return;

  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/(default)/documents/users/${encodeURIComponent(
    userId
  )}?${maskParams.join('&')}`;

  await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
}

interface ResolvedTokenTarget {
  token: string;
  deviceKeys: string[];
  matchesLegacy: boolean;
}

async function resolveChatAndTokens(
  projectId: string,
  accessToken: string,
  callerUid: string,
  toUserId: string
): Promise<{
  allowed: boolean;
  notFound?: boolean;
  tokens: ResolvedTokenTarget[];
}> {
  const now = Date.now();
  const chatId = makeDmId(callerUid, toUserId);
  const authKey = `${callerUid}:${chatId}`;
  const cachedAllowed = chatAuthCache.get(authKey);
  const hasWarmAuth = Boolean(cachedAllowed && cachedAllowed.expiresAt > now);

  let [chatDoc, recipientDoc] = await Promise.all([
    hasWarmAuth
      ? Promise.resolve(null)
      : getFirestoreDoc(projectId, accessToken, `chats/${encodeURIComponent(chatId)}`),
    getFirestoreDoc(projectId, accessToken, `users/${encodeURIComponent(toUserId)}`),
  ]);

  if (!hasWarmAuth && !chatDoc) {
    // Brief single retry in case first-ever chat creation write is finishing concurrently
    await new Promise((r) => setTimeout(r, 180));
    chatDoc = await getFirestoreDoc(
      projectId,
      accessToken,
      `chats/${encodeURIComponent(chatId)}`
    );
  }

  let allowed = hasWarmAuth ? Boolean(cachedAllowed!.value) : false;
  if (!hasWarmAuth) {
    if (!chatDoc) {
      return { allowed: false, notFound: true, tokens: [] };
    }
    const participantValues =
      chatDoc.fields?.participants?.arrayValue?.values || [];
    const participants = participantValues
      .map((v) => v.stringValue)
      .filter((v): v is string => typeof v === 'string');
    allowed = participants.includes(callerUid) && participants.includes(toUserId);
    if (allowed) {
      chatAuthCache.set(authKey, { value: true, expiresAt: now + WARM_TTL_MS });
    }
  }

  if (!allowed) {
    return { allowed: false, tokens: [] };
  }

  const targetMap = new Map<string, ResolvedTokenTarget>();
  const mapFields = recipientDoc?.fields?.fcmTokens?.mapValue?.fields;
  if (mapFields && typeof mapFields === 'object') {
    for (const [deviceKey, val] of Object.entries(mapFields)) {
      const tok = typeof val?.stringValue === 'string' ? val.stringValue.trim() : '';
      if (!tok) continue;
      const existing = targetMap.get(tok);
      if (existing) {
        existing.deviceKeys.push(deviceKey);
      } else {
        targetMap.set(tok, {
          token: tok,
          deviceKeys: [deviceKey],
          matchesLegacy: false,
        });
      }
    }
  }

  const legacyToken = recipientDoc?.fields?.fcmToken?.stringValue?.trim();
  if (legacyToken) {
    const existing = targetMap.get(legacyToken);
    if (existing) {
      existing.matchesLegacy = true;
    } else {
      targetMap.set(legacyToken, {
        token: legacyToken,
        deviceKeys: [],
        matchesLegacy: true,
      });
    }
  }

  return { allowed: true, tokens: Array.from(targetMap.values()) };
}

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  const sa = parseServiceAccount();
  if (!sa) {
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

  let bodyData: { toUserId?: unknown; messageId?: unknown; warmup?: unknown } = {};
  try {
    bodyData = (await req.json()) as {
      toUserId?: unknown;
      messageId?: unknown;
      warmup?: unknown;
    };
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  // Run Firebase ID token verification & Google OAuth access token minting in parallel
  let callerUid = '';
  let accessToken = '';
  try {
    [callerUid, accessToken] = await Promise.all([
      verifyFirebaseIdToken(token, sa.projectId),
      getGoogleAccessToken(sa),
    ]);
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid auth token' }, 401);
  }

  const toUserId =
    typeof bodyData?.toUserId === 'string' ? bodyData.toUserId.trim() : '';

  // Handle pre-warm ping while user opens chat / types so Send fires with 0 cold start
  if (bodyData?.warmup === true) {
    if (/^[A-Za-z0-9_-]{4,128}$/.test(toUserId) && toUserId !== callerUid) {
      await resolveChatAndTokens(sa.projectId, accessToken, callerUid, toUserId).catch(
        () => {}
      );
    }
    return jsonResponse({ ok: true, warmed: true });
  }

  if (!/^[A-Za-z0-9_-]{4,128}$/.test(toUserId) || toUserId === callerUid) {
    return jsonResponse({ ok: false, error: 'Invalid recipient' }, 400);
  }

  const rawMsgId =
    typeof bodyData?.messageId === 'string' ? bodyData.messageId.trim() : '';
  const cleanMsgId = /^[A-Za-z0-9_-]{4,128}$/.test(rawMsgId) ? rawMsgId : '';

  try {
    const resolved = await resolveChatAndTokens(
      sa.projectId,
      accessToken,
      callerUid,
      toUserId
    );
    if (!resolved.allowed) {
      return jsonResponse(
        {
          ok: false,
          error: resolved.notFound ? 'Not a participant' : 'Access denied',
        },
        403
      );
    }

    if (resolved.tokens.length === 0) {
      return jsonResponse({ ok: true, pushed: false, reason: 'no_fcm_token' });
    }

    const tagId = cleanMsgId
      ? `notepad-msg-${cleanMsgId}`
      : `notepad-reminder-${Date.now()}`;
    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(
      sa.projectId
    )}/messages:send`;

    const sendResults = await Promise.all(
      resolved.tokens.map(async (target) => {
        const fcmRes = await fetch(fcmUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token: target.token,
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
              android: {
                priority: 'HIGH',
                ttl: '86400s',
                notification: {
                  title: 'NotePad',
                  body: 'You have a new note reminder',
                  sound: 'default',
                  default_sound: true,
                  notification_priority: 'PRIORITY_HIGH',
                  visibility: 'PUBLIC',
                  tag: tagId,
                },
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
                fcm_options: {
                  link: '/',
                },
              },
            },
          }),
        });

        if (fcmRes.ok) {
          return { ok: true as const, target };
        }

        const errJson = (await fcmRes.json().catch(() => ({}))) as {
          error?: {
            status?: string;
            message?: string;
            details?: Array<{ errorCode?: string }>;
          };
        };
        const fcmErrorCode =
          errJson.error?.details?.find((d) => d.errorCode)?.errorCode ||
          errJson.error?.status ||
          `fcm_http_${fcmRes.status}`;

        const isInvalidToken =
          fcmErrorCode === 'UNREGISTERED' ||
          (fcmErrorCode === 'INVALID_ARGUMENT' &&
            (errJson.error?.message || '')
              .toLowerCase()
              .includes('registration token'));

        return { ok: false as const, target, fcmErrorCode, isInvalidToken };
      })
    );

    const deadDeviceKeys: string[] = [];
    let clearLegacySingle = false;
    let sentCount = 0;
    let lastErrorCode = '';

    for (const r of sendResults) {
      if (r.ok) {
        sentCount += 1;
      } else {
        lastErrorCode = r.fcmErrorCode;
        if (r.isInvalidToken) {
          if (r.target.matchesLegacy) clearLegacySingle = true;
          deadDeviceKeys.push(...r.target.deviceKeys);
        }
      }
    }

    if (clearLegacySingle || deadDeviceKeys.length > 0) {
      await clearDeadFcmTokens(sa.projectId, accessToken, toUserId, {
        clearLegacySingle,
        deadDeviceKeys,
      }).catch(() => {});
    }

    if (sentCount > 0) {
      return jsonResponse({ ok: true, pushed: true, sentCount });
    }

    console.warn('Netlify FCM reminder send skipped:', lastErrorCode);
    return jsonResponse({ ok: true, pushed: false, reason: lastErrorCode });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'push_unavailable';
    console.warn('Netlify push-reminder error:', message);
    return jsonResponse({ ok: true, pushed: false, reason: 'push_unavailable' });
  }
};
