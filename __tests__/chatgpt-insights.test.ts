// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateChatGPTInsights } from '@/lib/chatgpt-insights';
import { getAccessToken } from '@/lib/chatgpt-session.mjs';

vi.mock('@/lib/chatgpt-session.mjs', () => ({
  getAccessToken: vi.fn(), resource: 'https://api.openai.com/v1',
}));

const fetchMock = vi.fn();
const generate = () => generateChatGPTInsights('model', 'instructions', 'synthetic input', new AbortController().signal);

function stream(...chunks: string[]) {
  fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  })));
}

describe('ChatGPT plan Responses API', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(getAccessToken).mockResolvedValue('plan-token');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('assembles streamed deltas and requires completion', async () => {
    stream('event: response.output_text.delta\r\ndata: {"type":"response.output',
      '_text.delta","delta":"[]"}\r\n\r\ndata: {"type":"response.completed"}\n\n');
    await expect(generate()).resolves.toBe('[]');
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(options).toMatchObject({ headers: { Authorization: 'Bearer plan-token' }, redirect: 'error', cache: 'no-store' });
    expect(JSON.parse(options.body)).toEqual({
      model: 'model', instructions: 'instructions', store: false, stream: true,
      input: [{ role: 'user', content: 'synthetic input' }],
    });
  });

  it('rejects a disconnected session before sending data', async () => {
    vi.mocked(getAccessToken).mockResolvedValueOnce(null);
    await expect(generate()).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an interrupted stream even if it contains valid JSON', async () => {
    stream('data: {"type":"response.output_text.delta","delta":"[]"}\n\n');
    await expect(generate()).rejects.toMatchObject({ status: 502 });
  });

  it('reports a usage limit delivered after streaming begins', async () => {
    stream('data: {"type":"response.failed","response":{"error":{"code":"subscription_sharing_usage_limit_exceeded"}}}\n\n');
    await expect(generate()).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
