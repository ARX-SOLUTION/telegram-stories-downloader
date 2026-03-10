import { Api } from 'telegram';

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
  phoneNumber?: string | null;
  nextAction?: string;
  lastError?: string | null;
}

export interface StoryMediaItem {
  id: number;
  date: number;
  isPinned: boolean;
  isExpired: boolean;
  media: Api.TypeMessageMedia;
  storyItem: Api.StoryItem;
}

export interface StoryDownloadResult {
  storyId: number;
  date: number;
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

export interface StoryFetchStatus {
  username: string;
  total: number;
  downloaded: number;
  failed: number;
}

export interface PaginatedStoriesResult {
  stories: StoryDownloadResult[];
  page: number;
  total: number;
  hasMore: boolean;
  pagesCount: number;
}
