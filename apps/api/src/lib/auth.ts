const DEVICE_CODE_TTL_SECONDS = 15 * 60;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEVICE_CODE_INTERVAL_SECONDS = 5;

// Firebase configuration
const FIREBASE_PROJECT_ID = 'scrimble-auth';
const FIREBASE_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

interface DeviceCodeRow {
  id: string;
  user_id: string;
  user_code: string;
  scope: string | null;
  expires_at: string;
  consumed_at: string | null;
  approved_at: string | null;
}

interface SessionRow {
  session_id: string;
  user_id: string;
  email: string;
  expires_at: string;
}

import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface AuthContext {
  userId: string;
  email: string;
  sessionId: string;
  expiresAt: string;
}

export interface DeviceCodeChallenge {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export interface DeviceCodeTokenResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  scope?: string;
}

export interface DeviceCodeTokenError {
  error: string;
  errorDescription: string;
}

export interface ApproveDeviceCodeResult {
  ok: boolean;
  reason?: 'not_found' | 'expired' | 'consumed';
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function buildUserCode(): string {
  const raw = crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

function isExpired(expiresAt: string): boolean {
  return Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) <= Date.now();
}

export async function issueDeviceCodeChallenge(
  db: D1Database,
  input: {
    clientId: string;
    scope?: string;
    audience?: string;
    origin: string;
  },
): Promise<DeviceCodeChallenge> {
  const userId = `user-${crypto.randomUUID()}`;
  const userEmail = `${userId}@scrimble.dev`;
  const deviceCode = crypto.randomUUID();
  const userCode = buildUserCode();
  const expiresIn = DEVICE_CODE_TTL_SECONDS;
  const expiresAt = new Date(Date.now() + (expiresIn * 1000)).toISOString();
  const verificationUri = `${input.origin}/oauth/device/verify`;
  const verificationUriComplete = `${verificationUri}?user_code=${encodeURIComponent(userCode)}`;

  await db.prepare(
    `
      INSERT INTO users (id, email)
      VALUES (?1, ?2)
      ON CONFLICT(id) DO NOTHING
    `,
  ).bind(userId, userEmail).run();

  await db.prepare(
    `
      INSERT INTO device_codes (
        id,
        user_id,
        user_code,
        client_id,
        scope,
        audience,
        expires_at,
        created_at
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'))
    `,
  ).bind(
    deviceCode,
    userId,
    userCode,
    input.clientId,
    input.scope ?? null,
    input.audience ?? null,
    expiresAt,
  ).run();

  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete,
    expiresIn,
    interval: DEVICE_CODE_INTERVAL_SECONDS,
  };
}

export async function exchangeDeviceCodeForToken(
  db: D1Database,
  input: {
    clientId: string;
    deviceCode: string;
  },
): Promise<DeviceCodeTokenResult | DeviceCodeTokenError> {
  const deviceCodeRow = await db.prepare(
    `
      SELECT id, user_id, user_code, scope, expires_at, consumed_at, approved_at
      FROM device_codes
      WHERE id = ?1
        AND client_id = ?2
      LIMIT 1
    `,
  ).bind(input.deviceCode, input.clientId).first<DeviceCodeRow>();

  if (!deviceCodeRow) {
    return {
      error: 'invalid_grant',
      errorDescription: 'Device code is invalid.',
    };
  }

  if (deviceCodeRow.consumed_at !== null) {
    return {
      error: 'expired_token',
      errorDescription: 'Device code has already been consumed.',
    };
  }

  if (isExpired(deviceCodeRow.expires_at)) {
    return {
      error: 'expired_token',
      errorDescription: 'Device code expired before authorization completed.',
    };
  }

  if (deviceCodeRow.approved_at === null) {
    return {
      error: 'authorization_pending',
      errorDescription: 'User has not completed device authorization yet.',
    };
  }

  const accessToken = `scrimble_${crypto.randomUUID()}_${crypto.randomUUID().replace(/-/g, '')}`;
  const tokenHash = await sha256Hex(accessToken);
  const expiresIn = SESSION_TTL_SECONDS;
  const sessionExpiresAt = new Date(Date.now() + (expiresIn * 1000)).toISOString();

  await db.prepare(
    `
      INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
      VALUES (?1, ?2, ?3, ?4, datetime('now'))
    `,
  ).bind(
    crypto.randomUUID(),
    deviceCodeRow.user_id,
    tokenHash,
    sessionExpiresAt,
  ).run();

  await db.prepare(
    `
      UPDATE device_codes
      SET consumed_at = datetime('now')
      WHERE id = ?1
    `,
  ).bind(deviceCodeRow.id).run();

  return {
    accessToken,
    tokenType: 'Bearer',
    expiresIn,
    ...(deviceCodeRow.scope ? { scope: deviceCodeRow.scope } : {}),
  };
}

export async function approveDeviceCodeByUserCode(
  db: D1Database,
  userCode: string,
): Promise<ApproveDeviceCodeResult> {
  const normalizedUserCode = userCode.trim().toUpperCase();
  if (!normalizedUserCode) {
    return { ok: false, reason: 'not_found' };
  }

  const row = await db.prepare(
    `
      SELECT id, user_id, user_code, scope, expires_at, consumed_at, approved_at
      FROM device_codes
      WHERE user_code = ?1
      ORDER BY created_at DESC
      LIMIT 1
    `,
  ).bind(normalizedUserCode).first<DeviceCodeRow>();

  if (!row) {
    return { ok: false, reason: 'not_found' };
  }

  if (row.consumed_at !== null) {
    return { ok: false, reason: 'consumed' };
  }

  if (isExpired(row.expires_at)) {
    return { ok: false, reason: 'expired' };
  }

  if (row.approved_at === null) {
    await db.prepare(
      `
        UPDATE device_codes
        SET approved_at = datetime('now')
        WHERE id = ?1
      `,
    ).bind(row.id).run();
  }

  return { ok: true };
}

export async function resolveAuthContextFromBearer(
  db: D1Database,
  authorizationHeader?: string,
): Promise<AuthContext | null> {
  if (!authorizationHeader) {
    return null;
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }
  const accessToken = match[1]?.trim();
  if (!accessToken) {
    return null;
  }

  const tokenHash = await sha256Hex(accessToken);
  const row = await db.prepare(
    `
      SELECT sessions.id AS session_id, sessions.user_id, users.email, sessions.expires_at
      FROM sessions
      INNER JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ?1
      LIMIT 1
    `,
  ).bind(tokenHash).first<SessionRow>();

  if (!row || isExpired(row.expires_at)) {
    return null;
  }

  return {
    userId: row.user_id,
    email: row.email,
    sessionId: row.session_id,
    expiresAt: row.expires_at,
  };
}

/**
 * Verifies a Firebase ID token and returns the decoded payload.
 */
export async function verifyFirebaseIdToken(idToken: string) {
  const JWKS = createRemoteJWKSet(new URL(FIREBASE_JWKS_URL));
  
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
    audience: FIREBASE_PROJECT_ID,
    algorithms: ['RS256'],
  });

  return {
    uid: payload.sub as string,
    email: payload['email'] as string,
    email_verified: payload['email_verified'] as boolean,
  };
}

/**
 * Bridge function to approve a device code using a verified Firebase identity.
 */
export async function approveDeviceCodeWithFirebase(
  db: D1Database,
  userCode: string,
  idToken: string,
): Promise<ApproveDeviceCodeResult> {
  const firebaseUser = await verifyFirebaseIdToken(idToken);
  if (!firebaseUser.uid) {
    throw new Error('Invalid Firebase token: missing UID.');
  }

  const normalizedUserCode = userCode.trim().toUpperCase();
  const row = await db.prepare(
    `
      SELECT id, user_id, user_code, scope, expires_at, consumed_at, approved_at
      FROM device_codes
      WHERE user_code = ?1
      ORDER BY created_at DESC
      LIMIT 1
    `,
  ).bind(normalizedUserCode).first<DeviceCodeRow>();

  if (!row) {
    return { ok: false, reason: 'not_found' };
  }

  if (row.consumed_at !== null) {
    return { ok: false, reason: 'consumed' };
  }

  if (isExpired(row.expires_at)) {
    return { ok: false, reason: 'expired' };
  }

  // Ensure Scrimble user exists and is linked to Firebase identity
  // We use the Firebase UID as the Scrimble user ID for consistency
  const userId = firebaseUser.uid;
  const email = firebaseUser.email || `${userId}@firebase.internal`;

  await db.prepare(
    `
      INSERT INTO users (id, email)
      VALUES (?1, ?2)
      ON CONFLICT(id) DO UPDATE SET email = ?2, updated_at = datetime('now')
    `,
  ).bind(userId, email).run();

  // Mark device code as approved for THIS user
  await db.prepare(
    `
      UPDATE device_codes
      SET approved_at = datetime('now'),
          user_id = ?1
      WHERE id = ?2
    `,
  ).bind(userId, row.id).run();

  return { ok: true };
}
