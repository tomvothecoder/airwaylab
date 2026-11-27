import { getAccessToken, resource } from './chatgpt-session.mjs';

export class ChatGPTInsightsError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function generateChatGPTInsights(model: string, instructions: string, input: string, signal: AbortSignal): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new ChatGPTInsightsError(503, 'Connect ChatGPT using the local sign-in command first.');

  const response = await fetch(`${resource}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, instructions, input: [{ role: 'user', content: input }], store: false, stream: true }),
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(40_000)]),
  });
  if (response.status === 401) throw new ChatGPTInsightsError(503, 'Reconnect ChatGPT using the local sign-in command.');
  if (response.status === 429) throw planLimit();
  if (!response.ok || !response.body) throw new ChatGPTInsightsError(502, 'ChatGPT could not generate insights.');

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let text = '';
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (received > 512_000) break;
      buffer += value;
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const data = buffer.slice(0, boundary.index).split(/\r?\n/)
          .filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
        buffer = buffer.slice(boundary.index + boundary[0].length);
        if (!data || data === '[DONE]') continue;
        const event = JSON.parse(data);
        const code = event.response?.error?.code ?? event.code;
        if (code === 'subscription_sharing_usage_limit_exceeded' || code === 'subscription_sharing_usage_unavailable') {
          throw planLimit();
        }
        if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') text += event.delta;
        if (event.type === 'response.completed' && text) return text;
        if (['response.failed', 'response.incomplete', 'response.completed', 'error'].includes(event.type)) {
          throw incompleteResponse();
        }
      }
    }
    throw incompleteResponse();
  } finally {
    // eslint-disable-next-line airwaylab/no-silent-catch -- cancellation can fail after the stream has errored; preserve the original error.
    await reader.cancel().catch(() => {});
  }
}

function planLimit() {
  return new ChatGPTInsightsError(429, 'ChatGPT plan usage is unavailable or at its limit. Check ChatGPT Settings → Usage.');
}

function incompleteResponse() {
  return new ChatGPTInsightsError(502, 'ChatGPT returned an incomplete response. Please try again.');
}
