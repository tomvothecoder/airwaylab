import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIInsightsGate } from '@/components/dashboard/ai-insights-gate';
import { ChatGPTMode } from '@/lib/chatgpt-mode';
import type { NightResult } from '@/lib/types';

const { fetchStandard, fetchDeep, loadNotes, loadBreaths } = vi.hoisted(() => ({
  fetchStandard: vi.fn().mockResolvedValue({ insights: [] }),
  fetchDeep: vi.fn().mockResolvedValue({ insights: [], isDeep: true }),
  loadNotes: vi.fn(), loadBreaths: vi.fn(),
}));
vi.mock('@/lib/auth/auth-context', () => ({
  useAuth: () => ({ user: { id: 'owner' }, tier: 'community', isPaid: false, profile: { ai_insights_consent: true } }),
}));
vi.mock('@/lib/ai-insights-client', () => ({ fetchAIInsights: fetchStandard, fetchDeepAIInsights: fetchDeep }));
vi.mock('@/lib/night-notes', () => ({ loadNightNotes: loadNotes }));
vi.mock('@/lib/breath-data-idb', () => ({ loadBreathData: loadBreaths }));
vi.mock('@/components/dashboard/insights-panel', () => ({ InsightsPanel: () => null }));

const night = { dateStr: '2026-03-12', ned: { breaths: [] } } as unknown as NightResult;

function renderGate(isSharedView = false, selectedNight = night) {
  return render(
    <ChatGPTMode.Provider value>
      <AIInsightsGate nights={[selectedNight]} selectedNight={selectedNight} previousNight={null} therapyChangeDate={null}
        ruleBasedInsights={[]} isDemo={false} isNewUser={false} isSharedView={isSharedView} />
    </ChatGPTMode.Provider>,
  );
}

describe('ChatGPT plan consent in the insights dashboard', () => {
  beforeEach(() => vi.clearAllMocks());
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

  it('asks separately before sending only computed metrics from a restored night', async () => {
    const stored = { ned: 5, fi: 0.8, isMShape: true, tPeakTi: 0.5, qPeak: 24, ti: 1.2, inspStartSec: 42 };
    loadBreaths.mockResolvedValueOnce(Array.from({ length: 1001 }, () => stored));
    renderGate();
    expect(screen.getByText(/first 1,000 per-breath metric summaries/)).toBeVisible();
    expect(loadBreaths).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send to OpenAI & generate deep insights' }));
    });
    expect(loadBreaths).toHaveBeenCalledWith(night.dateStr);
    expect(fetchDeep).toHaveBeenCalledWith([night], 0, null, expect.any(AbortSignal), undefined, {
      breaths: Array.from({ length: 1000 }, () => ({ ned: 5, fi: 0.8, mShape: true, tPeakTi: 0.5, qPeak: 24, duration: 1.2 })),
      breathCount: 1001,
    }, true);
    expect(fetchStandard).not.toHaveBeenCalled();
    expect(loadNotes).not.toHaveBeenCalled();
  });

  it('asks for a re-upload rather than sending a standard request when breaths are missing', async () => {
    loadBreaths.mockResolvedValueOnce(null);
    renderGate();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send to OpenAI & generate deep insights' }));
    });
    expect(screen.getByText(/Re-upload your SD card/)).toBeVisible();
    expect(fetchStandard).not.toHaveBeenCalled();
    expect(fetchDeep).not.toHaveBeenCalled();
  });

  it('does not show the action in shared views', () => {
    renderGate(true);
    expect(screen.queryByRole('button', { name: /Send to OpenAI/ })).not.toBeInTheDocument();
  });
});
