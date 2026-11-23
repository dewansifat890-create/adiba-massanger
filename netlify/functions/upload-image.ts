import { createHash, createVerify } from 'node:crypto';

interface CachedCerts {
  certs: Record<string, string>;
  expiresAt: number;
}

interface CloudinaryCreds {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const IMGBB_UPLOAD_URL = 'https://api.imgbb.com/1/upload';

let cachedCerts: CachedCerts | null = null;

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

function base64UrlDecodeJson<T>(segment: string): T | null {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
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
  cachedCerts = { certs, expiresAt: now + Math.max(60_000, ttlMs) };
  return certs;
}

async function verifyFirebaseIdToken(
  idToken: string,
  projectId: string
): Promise<string> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT');
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

  if (!header || !payload) throw new Error('Invalid JWT');
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Invalid JWT header');

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) throw new Error('Audience mismatch');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error('Issuer mismatch');
  }
  if (!payload.sub || payload.sub.length > 128) throw new Error('Invalid subject');
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new Error('Token expired');
  }

  let certs = await getGoogleCerts(false);
  let certPem = certs[header.kid];
  if (!certPem) {
    certs = await getGoogleCerts(true);
    certPem = certs[header.kid];
  }
  if (!certPem) throw new Error('Unknown signing key');

  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  if (!verifier.verify(certPem, Buffer.from(sigB64, 'base64url'))) {
    throw new Error('Invalid signature');
  }
  return payload.sub;
}

function getCloudinaryCreds(): CloudinaryCreds | null {
  const rawUrl = process.env.CLOUDINARY_URL?.trim();
  if (rawUrl) {
    const match = rawUrl.match(/^cloudinary:\/\/([^:]+):([^@]+)@([^/\s]+)$/i);
    if (match) {
      return {
        apiKey: decodeURIComponent(match[1]),
        apiSecret: decodeURIComponent(match[2]),
        cloudName: decodeURIComponent(match[3]),
      };
    }
  }
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim() || '';
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim() || '';
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim() || '';
  if (cloudName && apiKey && apiSecret) {
    return { cloudName, apiKey, apiSecret };
  }
  return null;
}

async function uploadToImgbb(
  imgbbKey: string,
  cleanBase64: string,
  mimeType: string,
  cleanName: string
): Promise<{ ok: true; url: string; thumbUrl: string } | { ok: false; error: string }> {
  const ext = mimeType.includes('png')
    ? 'png'
    : mimeType.includes('webp')
    ? 'webp'
    : 'jpg';
  const binary = Buffer.from(cleanBase64, 'base64');

  const form = new FormData();
  form.append('key', imgbbKey);
  form.append('image', new Blob([binary], { type: mimeType }), `${cleanName}.${ext}`);
  form.append('name', cleanName);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const uploadRes = await fetch(IMGBB_UPLOAD_URL, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
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
    if (uploadRes.ok && uploadJson.success && imageUrl) {
      return {
        ok: true,
        url: imageUrl,
        thumbUrl: uploadJson.data?.thumb?.url || imageUrl,
      };
    }
    return {
      ok: false,
      error: uploadJson.error?.message || `imgbb_http_${uploadRes.status}`,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'imgbb_network_error',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function uploadImageToCloudinary(
  creds: CloudinaryCreds,
  cleanBase64: string,
  mimeType: string,
  cleanName: string
): Promise<{ ok: true; url: string; thumbUrl: string } | { ok: false; error: string }> {
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = 'notepad_images';
  const toSign = `folder=${folder}&timestamp=${timestamp}${creds.apiSecret}`;
  const signature = createHash('sha1').update(toSign).digest('hex');

  const binary = Buffer.from(cleanBase64, 'base64');
  const form = new FormData();
  form.append('file', new Blob([binary], { type: mimeType }), `${cleanName}.jpg`);
  form.append('api_key', creds.apiKey);
  form.append('timestamp', String(timestamp));
  form.append('folder', folder);
  form.append('signature', signature);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(creds.cloudName)}/image/upload`,
      {
        method: 'POST',
        body: form,
        signal: controller.signal,
      }
    );
    const json = (await res.json().catch(() => ({}))) as {
      secure_url?: string;
      error?: { message?: string };
    };
    if (res.ok && json.secure_url) {
      return {
        ok: true,
        url: json.secure_url,
        thumbUrl: json.secure_url,
      };
    }
    return {
      ok: false,
      error: json.error?.message || `cloudinary_http_${res.status}`,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'cloudinary_network_error',
    };
  } finally {
    clearTimeout(timer);
  }
}

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
  }

  const imgbbKey = process.env.IMGBB_API_KEY?.trim() || '';
  const cloudinaryCreds = getCloudinaryCreds();

  if (!imgbbKey && !cloudinaryCreds) {
    return jsonResponse({ ok: false, error: 'missing_imgbb_api_key' }, 503);
  }

  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length).trim()
    : '';
  if (!token) {
    return jsonResponse({ ok: false, error: 'Missing bearer token' }, 401);
  }

  const projectId = (
    process.env.FIREBASE_PROJECT_ID ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    'adiba-massanger'
  ).trim();

  try {
    await verifyFirebaseIdToken(token, projectId);
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid auth token' }, 401);
  }

  let body: { imageBase64?: unknown; name?: unknown } = {};
  try {
    body = (await req.json()) as { imageBase64?: unknown; name?: unknown };
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const rawBase64 =
    typeof body.imageBase64 === 'string' ? body.imageBase64.trim() : '';
  const mimeMatch = rawBase64.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const cleanBase64 = rawBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');

  if (!cleanBase64 || cleanBase64.length > 2_000_000) {
    return jsonResponse({ ok: false, error: 'Invalid or oversized image payload' }, 400);
  }

  const cleanName =
    typeof body.name === 'string' && body.name.trim()
      ? body.name.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48)
      : `img_${Date.now()}`;

  let lastError = 'upload_unavailable';

  if (imgbbKey) {
    const imgbbResult = await uploadToImgbb(
      imgbbKey,
      cleanBase64,
      mimeType,
      cleanName
    );
    if (imgbbResult.ok) {
      return jsonResponse({
        ok: true,
        url: imgbbResult.url,
        thumbUrl: imgbbResult.thumbUrl,
      });
    }
    lastError = imgbbResult.error;
  }

  if (cloudinaryCreds) {
    const cloudResult = await uploadImageToCloudinary(
      cloudinaryCreds,
      cleanBase64,
      mimeType,
      cleanName
    );
    if (cloudResult.ok) {
      return jsonResponse({
        ok: true,
        url: cloudResult.url,
        thumbUrl: cloudResult.thumbUrl,
      });
    }
    lastError = cloudResult.error;
  }

  return jsonResponse({ ok: false, error: lastError }, 502);
};
