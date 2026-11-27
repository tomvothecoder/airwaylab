import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const issuer = 'https://auth.openai.com';
export const resource = 'https://api.openai.com/v1';
export const scopes = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const directory = join(homedir(), '.config', 'airwaylab');
const sessionPath = join(directory, 'chatgpt.json');
const authPath = `${issuer}/api/accounts/oauth`;
const timeout = () => AbortSignal.timeout(10_000);

export async function readSession() {
  try {
    return JSON.parse(await readFile(sessionPath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return null;
  }
}

// Serialize sign-in, refresh and disconnect across the CLI and Next.js process.
export async function withSessionLock(callback) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = `${sessionPath}.lock`;
  await mkdir(lock, { mode: 0o700 });
  try {
    return await callback();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

export async function saveSession(session) {
  const temp = `${sessionPath}.${randomUUID()}`;
  try {
    await writeFile(temp, JSON.stringify(session), { flag: 'wx', mode: 0o600 });
    await rename(temp, sessionPath);
  } finally {
    await rm(temp, { force: true });
  }
}

export async function exchange(fields) {
  const response = await fetch(`${authPath}/token`, {
    method: 'POST', redirect: 'error', signal: timeout(),
    body: new URLSearchParams({ ...fields, resource }),
  });
  if (!response.ok) throw new Error('ChatGPT authorization failed. Sign in again.');
  const token = await response.json();
  if (typeof token.scope !== 'string' || !token.scope.split(' ').includes('chatgpt.tokens.use.direct') ||
      typeof token.access_token !== 'string' || typeof token.refresh_token !== 'string' ||
      typeof token.expires_in !== 'number' || token.token_type?.toLowerCase() !== 'bearer') {
    throw new Error('This ChatGPT account did not grant plan usage.');
  }
  return { ...token, expiresAt: Date.now() + token.expires_in * 1000 };
}

export async function verifyIdentity(jwt, clientId, nonce) {
  if (typeof jwt !== 'string') throw new Error('ChatGPT did not return an ID token.');
  const [header, payload, signature, extra] = jwt.split('.');
  if (!header || !payload || !signature || extra !== undefined) throw new Error('Invalid ChatGPT ID token.');
  const metadata = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
  const response = await fetch(`${issuer}/.well-known/jwks.json`, { redirect: 'error', signal: timeout() });
  if (!response.ok) throw new Error('Could not verify the ChatGPT ID token.');
  const { keys } = await response.json();
  const key = keys.find((candidate) => candidate.kid === metadata.kid && candidate.kty === 'RSA');
  if (metadata.alg !== 'RS256' || !key || !verify('RSA-SHA256', Buffer.from(`${header}.${payload}`),
    createPublicKey({ key, format: 'jwk' }), Buffer.from(signature, 'base64url'))) {
    throw new Error('Invalid ChatGPT ID token signature.');
  }
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== issuer || !audience.includes(clientId) ||
      ((audience.length > 1 || claims.azp !== undefined) && claims.azp !== clientId) ||
      claims.nonce !== nonce || typeof claims.sub !== 'string' || !claims.sub ||
      typeof claims.exp !== 'number' || claims.exp <= Date.now() / 1000) {
    throw new Error('Invalid ChatGPT ID token claims.');
  }
  return claims.sub;
}

export async function getAccessToken() {
  const session = await readSession();
  if (!session?.refresh_token) return null;
  if (session.expiresAt > Date.now() + 60_000) return session.access_token;
  return withSessionLock(async () => {
    const current = await readSession();
    if (!current?.refresh_token) return null;
    if (current.expiresAt > Date.now() + 60_000) return current.access_token;
    const token = await exchange({ grant_type: 'refresh_token', client_id: current.clientId, refresh_token: current.refresh_token });
    await saveSession({ ...current, ...token, id_token: current.id_token });
    return token.access_token;
  });
}

export async function disconnect() {
  return withSessionLock(async () => {
    const session = await readSession();
    if (!session?.refresh_token) return;
    const { hostId, clientId, subject, refresh_token } = session;
    try {
      const response = await fetch(`${authPath}/revoke`, {
        method: 'POST', redirect: 'error', signal: timeout(),
        body: new URLSearchParams({ client_id: clientId, token: refresh_token, token_type_hint: 'refresh_token' }),
      });
      if (!response.ok) throw new Error('Revocation failed');
    } catch {
      throw new Error('Could not confirm revocation. Disconnect AirwayLab in ChatGPT Settings.');
    } finally {
      await saveSession({ hostId, clientId, subject });
    }
  });
}

export function pkceChallenge(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}
