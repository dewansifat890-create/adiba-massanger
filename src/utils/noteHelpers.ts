import { AccentColor, ChecklistItem, FontSize, FontStyle, Note, SortOption } from '../types/notes';

export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function getNoteStats(note: Note): {
  words: number;
  chars: number;
  readMinutes: number;
  totalTasks: number;
  doneTasks: number;
} {
  const checklistText = note.checklist.map((item) => item.text).join(' ');
  const combined = `${note.title} ${note.body} ${checklistText}`.trim();
  const words = combined ? combined.split(/\s+/).filter(Boolean).length : 0;
  const chars = combined.length;
  const readMinutes = Math.max(1, Math.ceil(words / 200));
  const totalTasks = note.checklist.length;
  const doneTasks = note.checklist.filter((item) => item.done).length;

  return { words, chars, readMinutes, totalTasks, doneTasks };
}

export function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return 'Just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp));
}

export function sortNotes(notes: Note[], sortBy: SortOption): Note[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }
    if (sortBy === 'title') {
      const titleA = (a.title || 'Untitled').toLowerCase();
      const titleB = (b.title || 'Untitled').toLowerCase();
      return titleA.localeCompare(titleB);
    }
    if (sortBy === 'createdAt') {
      return b.createdAt - a.createdAt;
    }
    return b.updatedAt - a.updatedAt;
  });
}

export function sortChecklist(items: ChecklistItem[], moveCheckedToBottom: boolean): ChecklistItem[] {
  if (!moveCheckedToBottom) return items;
  return [...items].sort((a, b) => Number(a.done) - Number(b.done));
}

export function matchesQuery(note: Note, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (note.title.toLowerCase().includes(q)) return true;
  if (note.body.toLowerCase().includes(q)) return true;
  if (note.folder.toLowerCase().includes(q)) return true;
  return note.checklist.some((item) => item.text.toLowerCase().includes(q));
}

export function noteToMarkdown(note: Note): string {
  const lines: string[] = [];
  lines.push(`# ${note.title || 'Untitled Note'}`);
  lines.push('');
  if (note.body.trim()) {
    lines.push(note.body.trim());
    lines.push('');
  }
  if (note.checklist.length > 0) {
    lines.push('## Checklist');
    note.checklist.forEach((item) => {
      lines.push(`- [${item.done ? 'x' : ' '}] ${item.text}`);
    });
    lines.push('');
  }
  return lines.join('\n');
}

export function getAccentClasses(accent: AccentColor): {
  bg: string;
  bgHover: string;
  text: string;
  ring: string;
  softBg: string;
  border: string;
} {
  switch (accent) {
    case 'emerald':
      return {
        bg: 'bg-emerald-600 dark:bg-emerald-500',
        bgHover: 'hover:bg-emerald-700 dark:hover:bg-emerald-400',
        text: 'text-emerald-600 dark:text-emerald-400',
        ring: 'focus-visible:ring-emerald-500',
        softBg: 'bg-emerald-50 dark:bg-emerald-950/50',
        border: 'border-emerald-600 dark:border-emerald-500',
      };
    case 'cobalt':
      return {
        bg: 'bg-blue-600 dark:bg-blue-500',
        bgHover: 'hover:bg-blue-700 dark:hover:bg-blue-400',
        text: 'text-blue-600 dark:text-blue-400',
        ring: 'focus-visible:ring-blue-500',
        softBg: 'bg-blue-50 dark:bg-blue-950/50',
        border: 'border-blue-600 dark:border-blue-500',
      };
    case 'rose':
      return {
        bg: 'bg-rose-600 dark:bg-rose-500',
        bgHover: 'hover:bg-rose-700 dark:hover:bg-rose-400',
        text: 'text-rose-600 dark:text-rose-400',
        ring: 'focus-visible:ring-rose-500',
        softBg: 'bg-rose-50 dark:bg-rose-950/50',
        border: 'border-rose-600 dark:border-rose-500',
      };
    case 'amber':
    default:
      return {
        bg: 'bg-amber-500 dark:bg-[#E5A91A]',
        bgHover: 'hover:bg-amber-600 dark:hover:bg-amber-400',
        text: 'text-amber-600 dark:text-[#E5A91A]',
        ring: 'focus-visible:ring-amber-500',
        softBg: 'bg-amber-50 dark:bg-amber-950/50',
        border: 'border-amber-500 dark:border-[#E5A91A]',
      };
  }
}

export function getFontClass(fontStyle: FontStyle): string {
  switch (fontStyle) {
    case 'serif':
      return 'font-note-serif';
    case 'mono':
      return 'font-note-mono';
    case 'sans':
    default:
      return 'font-note-sans';
  }
}

export function getEditorSizeClass(fontSize: FontSize): {
  title: string;
  body: string;
} {
  switch (fontSize) {
    case 'small':
      return {
        title: 'text-xl leading-snug',
        body: 'text-sm leading-relaxed',
      };
    case 'large':
      return {
        title: 'text-2xl sm:text-3xl leading-snug',
        body: 'text-lg leading-relaxed',
      };
    case 'medium':
    default:
      return {
        title: 'text-2xl leading-snug',
        body: 'text-base leading-relaxed',
      };
  }
}
