export type LoginState =
  | 'idle'
  | 'waiting_phone'
  | 'waiting_code'
  | 'waiting_password'
  | 'authorized'
  | 'error';

export interface LoginFlowResponse {
  state: LoginState;
  message: string;
  nextAction?: string;
  lastError?: string | null;
}

export interface UserClientStatus {
  loginState: LoginState;
  connected: boolean;
  authorized: boolean;
  nextAction?: string;
  lastError?: string | null;
}

export interface DownloadedStoryMedia {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}
