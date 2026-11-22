import { AppSettings, Note, NoteColor, NoteFolder } from '../types/notes';

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  accent: 'amber',
  desktopLayout: 'mobile-frame',
  fontStyle: 'sans',
  fontSize: 'medium',
  viewMode: 'list',
  sortBy: 'updatedAt',
  defaultFolder: 'notes',
  showPreviews: true,
  showStats: true,
  moveCheckedToBottom: true,
  smartChecklistSyntax: true,
  confirmDelete: true,
  chatDisplayName: 'Me',
};

export const DEFAULT_FOLDERS: NoteFolder[] = [
  { id: 'notes', label: 'Notes', isSystem: true },
  { id: 'personal', label: 'Personal Notes', isSystem: true },
];

export const NOTE_COLORS: {
  id: NoteColor;
  label: string;
  cardClass: string;
  swatchClass: string;
}[] = [
  {
    id: 'default',
    label: 'Default',
    cardClass:
      'bg-white dark:bg-[#1C1C1E] border-slate-200/90 dark:border-white/[0.08]',
    swatchClass: 'bg-white dark:bg-[#2C2C2E] border-slate-300 dark:border-zinc-600',
  },
  {
    id: 'amber',
    label: 'Gold',
    cardClass:
      'bg-amber-50/80 dark:bg-amber-950/35 border-amber-200/80 dark:border-amber-800/40',
    swatchClass:
      'bg-amber-200 dark:bg-amber-700 border-amber-300 dark:border-amber-600',
  },
  {
    id: 'sky',
    label: 'Sky',
    cardClass:
      'bg-sky-50/75 dark:bg-sky-950/35 border-sky-200/80 dark:border-sky-800/40',
    swatchClass: 'bg-sky-200 dark:bg-sky-800 border-sky-300 dark:border-sky-700',
  },
  {
    id: 'sage',
    label: 'Sage',
    cardClass:
      'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200/80 dark:border-emerald-800/40',
    swatchClass:
      'bg-emerald-200 dark:bg-emerald-800 border-emerald-300 dark:border-emerald-700',
  },
  {
    id: 'rose',
    label: 'Rose',
    cardClass:
      'bg-rose-50/75 dark:bg-rose-950/30 border-rose-200/80 dark:border-rose-800/40',
    swatchClass: 'bg-rose-200 dark:bg-rose-800 border-rose-300 dark:border-rose-700',
  },
  {
    id: 'violet',
    label: 'Iris',
    cardClass:
      'bg-violet-50/70 dark:bg-violet-950/30 border-violet-200/80 dark:border-violet-800/40',
    swatchClass:
      'bg-violet-200 dark:bg-violet-800 border-violet-300 dark:border-violet-700',
  },
];

export function createInitialNotes(): Note[] {
  return [];
}

export function createSampleNotes(): Note[] {
  const now = Date.now();
  const min = 60 * 1000;
  const hour = 60 * min;

  return [
    {
      id: 'note-welcome',
      title: 'Quick Tips for Smart Notes',
      body: 'Start typing anywhere to capture ideas fast. Type "- [ ] " at the start of a line to automatically turn it into an interactive checklist item.',
      checklist: [
        { id: 'c1', text: 'Pin important notes to keep them at the top', done: true },
        { id: 'c2', text: 'Tap a checkbox directly from the list', done: false },
      ],
      folder: 'notes',
      color: 'default',
      pinned: true,
      archived: false,
      trashed: false,
      createdAt: now - 24 * hour,
      updatedAt: now - 15 * min,
    },
    {
      id: 'note-personal',
      title: 'Weekend Checklist',
      body: 'Keep things simple and organized.',
      checklist: [
        { id: 'p1', text: 'Buy coffee beans', done: false },
        { id: 'p2', text: 'Evening walk', done: false },
      ],
      folder: 'personal',
      color: 'default',
      pinned: false,
      archived: false,
      trashed: false,
      createdAt: now - 12 * hour,
      updatedAt: now - 2 * hour,
    },
  ];
}
