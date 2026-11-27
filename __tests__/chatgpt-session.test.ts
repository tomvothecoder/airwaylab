// @vitest-environment node
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const home = await mkdtemp(join(tmpdir(), 'airwaylab-chatgpt-test-'));
vi.doMock('node:os', () => ({ homedir: () => home }));
const { disconnect, getAccessToken, issuer, readSession, saveSession, verifyIdentity, withSessionLock } =
  await import('@/lib/chatgpt-session.mjs');
const fetchMock = vi.fn();
const session = { hostId: 'host', clientId: 'registered-client', subject: 'account', refresh_token: 'old', expiresAt: 0 };
const token = { access_token: 'new-access', refresh_token: 'rotated', expires_in: 3600, token_type: 'Bearer', scope: 'chatgpt.tokens.use.direct resource.invoke' };

beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  await withSessionLock(() => saveSession(session));
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => rm(home, { recursive: true, force: true }));

describe('ChatGPT plan credentials', () => {
  it('stores tokens privately and atomically replaces the rotated refresh token', async () => {
    fetchMock.mockResolvedValueOnce(Response.json(token));
    await expect(getAccessToken()).resolves.toBe('new-access');
    expect(await readSession()).toMatchObject({ refresh_token: 'rotated', clientId: session.clientId });
    const mode = (await stat(join(home, '.config', 'airwaylab', 'chatgpt.json'))).mode;
    expect(mode & 0o777).toBe(0o600);
    await expect(getAccessToken()).resolves.toBe('new-access');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clears tokens even if revocation fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 502 }));
    await expect(disconnect()).rejects.toThrow(/confirm revocation/);
    expect(await readSession()).toEqual({ hostId: session.hostId, clientId: session.clientId, subject: session.subject });
    await expect(getAccessToken()).resolves.toBeNull();
  });

  it('requires plan permission during refresh and does not overwrite the saved session without it', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ ...token, scope: 'openid profile email' }));
    await expect(getAccessToken()).rejects.toThrow(/did not grant plan usage/);
    expect(await readSession()).toEqual(session);
  });

  it('verifies the ID token signature and callback nonce and audience', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const key = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key' };
    fetchMock.mockImplementation(() => Promise.resolve(Response.json({ keys: [key] })));
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const input = `${encode({ alg: 'RS256', kid: 'test-key' })}.${encode({
      iss: issuer, aud: session.clientId, sub: session.subject, nonce: 'nonce', exp: Date.now() / 1000 + 60,
    })}`;
    const jwt = `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
    await expect(verifyIdentity(jwt, session.clientId, 'nonce')).resolves.toBe(session.subject);
    await expect(verifyIdentity(jwt, session.clientId, 'mismatch')).rejects.toThrow(/claims/);
    await expect(verifyIdentity(jwt, 'wrong-client', 'nonce')).rejects.toThrow(/claims/);
    await expect(verifyIdentity(`${input}.forged`, session.clientId, 'nonce')).rejects.toThrow(/signature/);
  });
});
