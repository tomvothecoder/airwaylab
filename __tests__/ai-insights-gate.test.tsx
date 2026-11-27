import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AIInsightsGate } from '@/components/dashboard/ai-insights-gate';
import { ChatGPTMode } from '@/lib/chatgpt-mode';
import type { NightResult } from '@/lib/types';

const { fetchStandard, fetchDeep, loadNotes } = vi.hoisted(() => ({
  fetchStandard: vi.fn().mockResolvedValue({ insights: [] }), fetchDeep: vi.fn(), loadNotes: vi.fn(),
}));
vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({ user: { id: 'owner' }, tier: 'community', isPaid: false, profile: { ai_insights_consent: true } }),
}));
vi.mock('@/lib/ai-insights-client', () => ({ fetchAIInsights: fetchStandard, fetchDeepAIInsights: fetchDeep }));
vi.mock('@/lib/night-notes', () => ({ loadNightNotes: loadNotes }));
vi.mock('@/components/dashboard/insights-panel', () => ({ InsightsPanel: () => null }));

const night = { dateStr: '2026-03-12' } as NightResult;

function renderGate(isSharedView = false) {
  return render(
    <ChatGPTMode.Provider value>
      <AIInsightsGate nights={[night]} selectedNight={night} previousNight={null} therapyChangeDate={null}
        ruleBasedInsights={[]} isDemo={false} isNewUser={false} isSharedView={isSharedView} />
    </ChatGPTMode.Provider>,
  );
}

describe('ChatGPT plan consent in the insights dashboard', () => {
  it('does not auto-run and sends standard insights only after clicking the OpenAI action', async () => {
    renderGate();
    expect(fetchStandard).not.toHaveBeenCalled();
    expect(screen.getByText(/No night notes, per-breath summaries, or raw waveforms/)).toBeVisible();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send to OpenAI & generate insights' }));
    });
    expect(fetchStandard).toHaveBeenCalledTimes(1);
    expect(fetchStandard).toHaveBeenCalledWith([night], 0, null, expect.any(AbortSignal), undefined, true);
    expect(fetchDeep).not.toHaveBeenCalled();
    expect(loadNotes).not.toHaveBeenCalled();
  });

  it('does not show the action in shared views', () => {
    renderGate(true);
    expect(screen.queryByRole('button', { name: /Send to OpenAI/ })).not.toBeInTheDocument();
  });
});
