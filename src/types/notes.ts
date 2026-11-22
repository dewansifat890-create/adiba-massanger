export type FolderId = string;

export interface NoteFolder {
  id: FolderId;
  label: string;
  isSystem?: boolean;
}

export type NoteColor = 'default' | 'sky' | 'sage' | 'amber' | 'rose' | 'violet';

export type ThemeMode = 'light' | 'dark' | 'system';

export type AccentColor = 'amber' | 'cobalt' | 'emerald' | 'rose';

export type FontStyle = 'sans' | 'serif' | 'mono';

export type FontSize = 'small' | 'medium' | 'large';

export type ViewMode = 'grid' | 'list';

export type SortOption = 'updatedAt' | 'createdAt' | 'title';

export type DesktopLayoutMode = 'mobile-frame' | 'responsive';

export type AppScreen =
  | { type: 'folders' }
  | { type: 'folder'; folderId: 'all' | 'tasks' | 'archive' | 'trash' | FolderId }
  | { type: 'messenger' }
  | { type: 'settings' };

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  checklist: ChecklistItem[];
  folder: FolderId;
  color: NoteColor;
  pinned: boolean;
  archived: boolean;
  trashed: boolean;
  trashedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface MessengerUser {
  userId: string;
  handle: string;
  displayName: string;
  updatedAt?: number;
  isOnline?: boolean;
  lastSeen?: number;
}

export interface ChatReaction {
  emoji: string;
  userIds: string[];
}

export interface ChatReplyPreview {
  id: string;
  senderName: string;
  text: string;
}

export interface DirectMessage {
  id: string;
  dmId: string;
  fromUserId: string;
  toUserId: string;
  senderName: string;
  text: string;
  createdAt: number;
  deliveredAt?: number;
  seenAt?: number;
  unsent?: boolean;
  unsentAt?: number;
  replyTo?: ChatReplyPreview;
  reactions?: ChatReaction[];
}

export interface AppSettings {
  theme: ThemeMode;
  accent: AccentColor;
  desktopLayout: DesktopLayoutMode;
  fontStyle: FontStyle;
  fontSize: FontSize;
  viewMode: ViewMode;
  sortBy: SortOption;
  defaultFolder: FolderId;
  showPreviews: boolean;
  showStats: boolean;
  moveCheckedToBottom: boolean;
  smartChecklistSyntax: boolean;
  confirmDelete: boolean;
  chatDisplayName: string;
}
