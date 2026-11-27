# OpenAI-compatible AI Insights (self-hosted)

**Goal:** Use a personal ChatGPT Plus plan for standard AI Insights on a local AirwayLab install. Also support OpenAI-compatible endpoints with an operator-supplied API key. The two credentials are not interchangeable.

## Implementation

1. **ChatGPT Plus first.** Use [Sign in with ChatGPT for open-source apps](https://developers.openai.com/siwc/token-sharing-open-source), with a local sign-in/disconnect command rather than a new account UI. Use the documented OAuth flow (including PKCE, callback and ID-token validation), store credentials outside the repo in protected local storage, and support refresh and disconnect. Select an eligible model from the signed-in account's catalog. Call the public Responses API directly (`store: false`, `stream: true`); accept output only after `response.completed`. Report plan limits without falling back to paid API usage. No Codex subprocess or token copying.
2. **API-key mode.** Add a small server-side `fetch` adapter for `/v1/chat/completions`. Configure the base URL, model, and bearer token (optional for unauthenticated loopback servers) through server-only environment variables. Accept operator-configured HTTPS or loopback HTTP, reject redirects, and never accept a destination or key from a browser request. API charges, if any, are separate from ChatGPT Plus.

## Shared behavior

- Both modes require a server bound to loopback and one configured AirwayLab owner ID. Reuse `/api/ai-insights`, its origin/auth/payload checks, prompt sanitization, output validation, and clinical safeguards. Reject non-owner, deep, or per-breath requests before dispatch. No auto-run, free-text notes, demo/shared-view generation, or fallback. Leave hosted Anthropic behavior, consent, and quotas unchanged.
- Before each run, disclose the configured destination and the data sent (nightly metrics, dates, settings, and trends). Require confirmation on the request and reject it if the destination differs from what the user confirmed. Do not read or write Anthropic consent for these runs. Update the privacy disclosure and keep prompts, generated text, credentials, and raw provider errors out of remote logs and storage.
- No database migration, browser-direct provider calls, provider marketplace, or hosted BYOK. Disabling the server setting restores the default path.

## ChatGPT deep insights follow-up

- Add a separate manual action that discloses up to 1,000 selected-night per-breath metric summaries. Require deep-specific consent at the route; never upgrade a standard request to deep. Keep owner/loopback checks and omit notes, waveforms, and remote logging.
- Read computed metrics from the selected night or browser IndexedDB. If unavailable, ask the user to re-upload. Label the returned insights as deep and tell the model not to generalize the sampled breaths to the whole night. No tier, schema migration, or hosted behavior change.
- Verify separate consent, missing breath data, restored nights, payload field allowlisting, and unchanged standard requests. Smoke-test both buttons using synthetic data.

## Verification

- Test unchanged Anthropic behavior, non-owner and deep request rejection, missing consent or changed destination, malformed output, timeout, and no fallback. Test Plus completion, refresh/disconnect, and plan limits; test API-key auth, optional loopback auth, and redirect rejection.
- Before shipping, run the repo checks and smoke-test each mode with synthetic data. Verify valid insights, accurate metric references, no therapy recommendations, no health text in remote logs, and that declining consent sends no provider request.
