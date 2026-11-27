/**
 * R-B consent gate tests for the AI insights route.
 *
 * AI insights send PHI (night/therapy data) to Anthropic. The route must refuse
 * (403) unless the user's profiles.ai_insights_consent is true, and must proceed
 * normally when it is true. This is the load-bearing gate that prevents PHI from
 * leaving the device without explicit consent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock external dependencies before importing route ──────────

vi.mock('@/lib/csrf', () => ({ validateOrigin: vi.fn(() => true) }));

vi.mock('@/lib/rate-limit', () => ({
  aiRateLimiter: { isLimited: vi.fn(() => false) },
  aiPremiumRateLimiter: { isLimited: vi.fn(() => false) },
  getRateLimitKey: vi.fn(() => '127.0.0.1'),
  getUserRateLimitKey: vi.fn((id: string) => `user:${id}`),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

// Profile/consent row is configurable per-test via this mutable holder.
let consentValue: boolean = true;

const mockSupabaseFrom = vi.fn().mockReturnValue({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn().mockImplementation(() =>
    Promise.resolve({ data: { tier: 'supporter', ai_insights_consent: consentValue } })
  ),
  maybeSingle: vi.fn().mockResolvedValue({ data: null }),
  insert: vi.fn().mockReturnThis(),
  then: vi.fn().mockResolvedValue({ error: null }),
});
const mockRpc = vi.fn().mockResolvedValue({ data: null });

vi.mock('@/lib/supabase/server', () => ({
  getSupabaseServer: vi.fn(() => ({
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'consent-user' } }, error: null }) },
  })),
  getSupabaseServiceRole: vi.fn(() => ({
    from: (...args: unknown[]) => mockSupabaseFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  })),
}));

vi.mock('@/lib/email/sequences', () => ({
  cancelSequence: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/discord-webhook', () => ({
  sendAlert: vi.fn().mockResolvedValue(undefined),
  COLORS: { green: 0x10b981, amber: 0xf59e0b, red: 0xef4444, blue: 0x3b82f6, purple: 0x8b5cf6, teal: 0x14b8a6 },
  _budget: { date: '', count: 0 },
  routeAlert: vi.fn().mockResolvedValue(false),
  sendOpsAlert: vi.fn().mockResolvedValue(false),
  sendCriticalAlert: vi.fn().mockResolvedValue(false),
  alertCredentialExpiry: vi.fn().mockResolvedValue(false),
  alertStripePaymentFailed: vi.fn().mockResolvedValue(false),
  alertSecurityIncident: vi.fn().mockResolvedValue(false),
  formatMonitorEmbed: vi.fn().mockReturnValue({}),
  formatRevenueEmbed: vi.fn().mockReturnValue({}),
  formatUserSignalEmbed: vi.fn().mockReturnValue({}),
  formatEmailAlertEmbed: vi.fn().mockReturnValue({}),
  formatBroadcastEmbed: vi.fn().mockReturnValue({}),
  formatGrowthEmbed: vi.fn().mockReturnValue({}),
}));

const mockChatGPT = vi.hoisted(() => vi.fn());
vi.mock('@/lib/chatgpt-insights', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/chatgpt-insights')>(),
  generateChatGPTInsights: mockChatGPT,
}));

const mockMessagesCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', async () => {
  const actual = await vi.importActual<typeof import('@anthropic-ai/sdk')>('@anthropic-ai/sdk');
  class MockAnthropic {
    messages = { create: (...args: unknown[]) => mockMessagesCreate(...args) };
    static AuthenticationError = actual.AuthenticationError;
    static PermissionDeniedError = actual.PermissionDeniedError;
    static BadRequestError = actual.BadRequestError;
    static NotFoundError = actual.NotFoundError;
    static InternalServerError = actual.InternalServerError;
    static APIConnectionError = actual.APIConnectionError;
    static APIConnectionTimeoutError = actual.APIConnectionTimeoutError;
    static RateLimitError = actual.RateLimitError;
  }
  return { ...actual, default: MockAnthropic };
});

// ── Helpers ────────────────────────────────────────────────────

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('https://airwaylab.app/api/ai-insights', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://airwaylab.app' },
    body: JSON.stringify(body),
  });
}

function validBody(): Record<string, unknown> {
  return {
    nights: [{
      dateStr: '2026-03-12',
      durationHours: 7,
      sessionCount: 1,
      settings: {},
      glasgow: { overall: 3.5 },
      wat: { flScore: 40 },
      ned: { nedMean: 25 },
      oximetry: null,
    }],
    selectedNightIndex: 0,
    therapyChangeDate: null,
  };
}

function mockSuccessResponse() {
  mockMessagesCreate.mockResolvedValue({
    content: [{ type: 'text', text: '[{"id":"ai-1","type":"info","title":"Test","body":"Body.","category":"trend"}]' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 50 },
  });
}

async function callRoute(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/ai-insights/route');
  return POST(makeRequest(body) as never);
}

// ── Tests ─────────────────────────────────────────────────────

describe('AI Insights — R-B consent gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key';
    consentValue = true;
    mockSuccessResponse();
  });

  it('returns 403 and never calls Anthropic when consent is not granted', async () => {
    consentValue = false;
    const res = await callRoute(validBody());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/consent/i);
    // The load-bearing guarantee: no PHI reached the model.
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('proceeds to call Anthropic when consent is granted', async () => {
    consentValue = true;
    const res = await callRoute(validBody());
    expect(res.status).toBe(200);
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
    expect(mockChatGPT).not.toHaveBeenCalled();
  });
});

const localOrigin = 'http://127.0.0.1:3000';
const deepConsent = 'https://api.openai.com; mode=deep';
const breath = { ned: 3, fi: 0.8, mShape: false, tPeakTi: 0.5, qPeak: 24, duration: 1.2 };
async function callChatGPTRoute(overrides = {}, consent = 'https://api.openai.com', origin = localOrigin) {
  const { POST } = await import('@/app/api/ai-insights/route');
  const req = new Request(`${origin}/api/ai-insights`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Origin: origin, Host: new URL(origin).host,
      ...(consent && { 'X-AirwayLab-ChatGPT-Consent': consent }),
    },
    body: JSON.stringify({ ...validBody(), ...overrides }),
  });
  return POST(req as never);
}

describe('AI Insights — local ChatGPT plan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('AIRWAYLAB_CHATGPT_OWNER_ID', 'consent-user');
    vi.stubEnv('AIRWAYLAB_CHATGPT_MODEL', 'example-model');
    vi.stubEnv('NEXT_PUBLIC_APP_URL', localOrigin);
    consentValue = false;
  });
  afterEach(() => vi.unstubAllEnvs());

  it('applies request consent and bypasses hosted consent, logging, and quotas', async () => {
    mockChatGPT.mockResolvedValueOnce('[{"id":"ai-1","type":"info","title":"Test","body":"Body.","category":"trend","link":{"href":"/untrusted"}}]');
    const response = await callChatGPTRoute();
    expect(response.status).toBe(200);
    const { insights, isDeep } = await response.json();
    expect(insights[0]).not.toHaveProperty('link');
    expect(isDeep).toBe(false);
    expect(mockChatGPT).toHaveBeenCalledWith('example-model', expect.any(String), expect.stringContaining('2026-03-12'), expect.any(AbortSignal));
    expect(mockSupabaseFrom).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it.each(['', 'https://not-openai.example'])('rejects consent value %j', async (consent) => {
    expect((await callChatGPTRoute({}, consent)).status).toBe(403);
    expect(mockChatGPT).not.toHaveBeenCalled();
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('rejects a stale consent header after disabling the mode, without falling back', async () => {
    vi.stubEnv('AIRWAYLAB_CHATGPT_OWNER_ID', '');
    expect((await callChatGPTRoute()).status).toBe(403);
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it('rejects a remote origin and non-owner', async () => {
    expect((await callChatGPTRoute({}, undefined, 'https://airwaylab.app')).status).toBe(403);
    vi.stubEnv('AIRWAYLAB_CHATGPT_OWNER_ID', 'another-user');
    expect((await callChatGPTRoute()).status).toBe(403);
    expect(mockChatGPT).not.toHaveBeenCalled();
  });

  it.each([{ perBreathSummary: { breaths: [breath], breathCount: 1 } }, {
    nightNotes: { caffeine: null, alcohol: null, congestion: null, position: null, stress: null, exercise: null, note: 'private note' },
  }])('rejects disallowed request fields: %j', async (overrides) => {
    expect((await callChatGPTRoute(overrides)).status).toBe(400);
    expect(mockChatGPT).not.toHaveBeenCalled();
  });

  it('requires consent for the exact analysis mode', async () => {
    const body = { deep: true, perBreathSummary: { breaths: [breath], breathCount: 1 } };
    expect((await callChatGPTRoute(body)).status).toBe(403);
    expect((await callChatGPTRoute({}, deepConsent)).status).toBe(403);
    expect(mockChatGPT).not.toHaveBeenCalled();
  });

  it('sends only validated computed breath metrics on an explicitly deep request', async () => {
    mockChatGPT.mockResolvedValueOnce('[{"id":"ai-1","type":"info","title":"Test","body":"Body.","category":"ned"}]');
    const response = await callChatGPTRoute({
      deep: true,
      perBreathSummary: { breaths: [{ ...breath, inspFlow: [1, 2, 3] }], breathCount: 1 },
    }, deepConsent);
    expect(response.status).toBe(200);
    expect((await response.json()).isDeep).toBe(true);
    const [, instructions, prompt] = mockChatGPT.mock.calls[0]!;
    expect(instructions).toContain('do not generalize');
    expect(JSON.parse(prompt).perBreathSummary).toEqual({ breaths: [breath], breathCount: 1 });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });

  it.each([0, 1001])('rejects an invalid deep summary size (%i) before dispatch', async (count) => {
    const body = { deep: true, perBreathSummary: { breaths: Array.from({ length: count }, () => breath), breathCount: count } };
    expect((await callChatGPTRoute(body, deepConsent)).status).toBe(400);
    expect(mockChatGPT).not.toHaveBeenCalled();
  });

  it('does not expose malformed provider output or fall back', async () => {
    mockChatGPT.mockResolvedValueOnce('private data and invalid JSON');
    const response = await callChatGPTRoute();
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('private data');
    expect(mockMessagesCreate).not.toHaveBeenCalled();
  });
});
