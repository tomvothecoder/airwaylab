'use client';

import { createContext, type ReactNode } from 'react';

export const ChatGPTMode = createContext(false);

export function ChatGPTModeProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <ChatGPTMode.Provider value={enabled}>{children}</ChatGPTMode.Provider>;
}
