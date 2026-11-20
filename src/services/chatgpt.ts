import { invoke, isTauri } from '@tauri-apps/api/core';

export type NativeChatGPTStatus = 'disconnected' | 'connected' | 'needs_reconnect' | 'needs_plan_permission' | 'unavailable';

export interface NativeChatGPTModel { slug: string; displayName: string }

/** Native connection metadata only; OAuth credentials never cross into the renderer. */
export interface NativeChatGPTState {
  status: NativeChatGPTStatus;
  account: string | null;
  models: NativeChatGPTModel[];
  selectedModel: string | null;
  ready: boolean;
  usageAcknowledged: boolean;
  firstUsePending: boolean;
  reason: string | null;
  remoteRevocationConfirmed: boolean | null;
}

export interface ChatGPTGateway {
  desktop: boolean;
  connectionState(): Promise<NativeChatGPTState>;
  connect(): Promise<NativeChatGPTState>;
  acknowledgeUsage(): Promise<NativeChatGPTState>;
  setModel(model: string): Promise<NativeChatGPTState>;
  testConnection(model: string): Promise<NativeChatGPTState>;
  disconnect(): Promise<NativeChatGPTState>;
}

export const desktopChatGPTGateway: ChatGPTGateway = {
  desktop: isTauri(),
  connectionState: () => invoke('chatgpt_connection_state'),
  connect: () => invoke('chatgpt_connect'),
  acknowledgeUsage: () => invoke('chatgpt_acknowledge_usage'),
  setModel: model => invoke('chatgpt_set_model', { model }),
  testConnection: model => invoke('chatgpt_test_connection', { model }),
  disconnect: () => invoke('chatgpt_disconnect'),
};
