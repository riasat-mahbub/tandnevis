import { invoke, isTauri } from '@tauri-apps/api/core';

export interface ApplicationRuntimeInfo {
  portable: boolean;
  dataDirectory: string;
  applicationVersion: string;
  webview2Required: boolean;
  webview2RuntimeActive: boolean;
}

export interface RuntimeGateway {
  desktop: boolean;
  info(): Promise<ApplicationRuntimeInfo>;
}

export const desktopRuntimeGateway: RuntimeGateway = {
  desktop: isTauri(),
  info: () => invoke('app_runtime_info'),
};
