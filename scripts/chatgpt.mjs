import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import {
  disconnect, exchange, getAccessToken, issuer, pkceChallenge, readSession, resource,
  saveSession, scopes, verifyIdentity, withSessionLock,
} from '../lib/chatgpt-session.mjs';

try {
  switch (process.argv[2]) {
    case 'login': await signIn(); break;
    case 'logout': await disconnect(); break;
    case 'models': await listModels(); break;
    default:
      process.stderr.write('Usage: node scripts/chatgpt.mjs login|logout|models\n');
      process.exitCode = 1;
  }
} catch (error) {
  // Never print raw fetch/parse errors, OAuth URLs, or token responses.
  const message = error?.code === 'EEXIST'
    ? 'Another session operation is in progress. See the README if it was interrupted.'
    : process.argv[2] === 'logout'
      ? 'Check the connection in ChatGPT Settings → Apps.'
      : 'Check your connection or ChatGPT plan, then retry.';
  process.stderr.write(`ChatGPT setup failed. ${message}\n`);
  process.exitCode = 1;
}

async function signIn() {
  const saved = await withSessionLock(async () => {
    const existing = await readSession();
    if (existing) return existing;
    const session = { hostId: `urn:uuid:${randomUUID()}` };
    await saveSession(session);
    return session;
  });
  const state = randomBytes(32).toString('base64url');
  const nonce = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const server = createServer();
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const redirect = `http://127.0.0.1:${server.address().port}/auth/callback`;
    const authorization = new URL('/api/accounts/authorize', issuer);
    authorization.search = new URLSearchParams({
      client_id: saved?.clientId ?? 'dynamic_agent_client',
      ...(!saved?.clientId && { agent_name_hint: 'AirwayLab' }),
      ext_agent_host_id: saved.hostId, response_type: 'code', redirect_uri: redirect,
      scope: scopes, resource, state, nonce,
      code_challenge_method: 'S256', code_challenge: pkceChallenge(verifier),
    }).toString();

    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Login timed out.')), 180_000);
      server.on('request', (request, response) => {
        const url = new URL(redirect);
        const [path, query] = (request.url ?? '').split('?');
        const params = new URLSearchParams(query);
        if (request.method !== 'GET' || request.headers.host !== url.host || path !== url.pathname || params.get('state') !== state) {
          response.writeHead(400).end('Invalid callback.');
          return;
        }
        clearTimeout(timer);
        response.writeHead(200, { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
          .end('Return to your terminal to check the sign-in result.');
        resolve(params);
      });
      execFile('open', [authorization.href], (error) => {
        if (error) { clearTimeout(timer); reject(error); }
      });
    });
    const code = result.get('code');
    const suppliedClient = result.get('client_id');
    const clientId = saved?.clientId ?? suppliedClient;
    if (result.has('error') || !code || !clientId || clientId === 'dynamic_agent_client' ||
        (suppliedClient && suppliedClient !== clientId)) throw new Error('Sign-in was not authorized.');
    await withSessionLock(async () => {
      const current = await readSession();
      if (!current || current.clientId !== saved.clientId || current.hostId !== saved.hostId ||
          current.refresh_token !== saved.refresh_token) {
        throw new Error('The local session changed during sign-in.');
      }
      const token = await exchange({
        grant_type: 'authorization_code', client_id: clientId, code,
        code_verifier: verifier, redirect_uri: redirect,
      });
      const subject = await verifyIdentity(token.id_token, clientId, nonce);
      if (saved.subject && subject !== saved.subject) throw new Error('The authorized account changed.');
      await saveSession({ hostId: saved.hostId, clientId, subject, ...token });
    });
    process.stdout.write('ChatGPT connected. Run node scripts/chatgpt.mjs models to list eligible models.\n');
  } finally {
    server.close();
  }
}

async function listModels() {
  const token = await getAccessToken();
  if (!token) throw new Error('Sign in first.');
  const res = await fetch(`${resource}/models`, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error('Could not list models.');
  const catalog = await res.json();
  for (const model of catalog.models) {
    if (model.visibility === 'list' && typeof model.slug === 'string' && /^[\w.-]+$/.test(model.slug)) {
      process.stdout.write(`${model.slug}\n`);
    }
  }
}
