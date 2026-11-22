import { CalendarDays, CheckSquare, FileText, Users, X } from 'lucide-react';
import { FolderId } from '../types/notes';

export interface NoteTemplate {
  id: string;
  label: string;
  subtitle: string;
  title: string;
  body: string;
  checklist: string[];
  folder?: FolderId;
  icon: typeof FileText;
}

export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: 'blank',
    label: 'Blank Note',
    subtitle: 'Start writing from scratch',
    title: '',
    body: '',
    checklist: [],
    icon: FileText,
  },
  {
    id: 'checklist',
    label: 'Smart Checklist',
    subtitle: 'Track tasks with completion count',
    title: 'To-Do List',
    body: '',
    checklist: ['First task', 'Second task', 'Third task'],
    icon: CheckSquare,
  },
  {
    id: 'meeting',
    label: 'Meeting Notes',
    subtitle: 'Agenda, decisions, and action items',
    title: `Meeting — ${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date())}`,
    body: 'Attendees:\n\nKey Discussion:\n- \n\nDecisions:',
    checklist: ['Follow up on action items', 'Share summary'],
    folder: 'work',
    icon: Users,
  },
  {
    id: 'daily',
    label: 'Daily Log',
    subtitle: 'Today’s focus and reflections',
    title: new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    }).format(new Date()),
    body: 'Main Focus:\n\nNotes & Thoughts:\n',
    checklist: ['Morning priority', 'Wrap-up review'],
    folder: 'journal',
    icon: CalendarDays,
  },
];

interface TemplatesSheetProps {
  open: boolean;
  onClose: () => void;
  onSelectTemplate: (template: NoteTemplate) => void;
  isMobileFrame: boolean;
}

export function TemplatesSheet({
  open,
  onClose,
  onSelectTemplate,
  isMobileFrame,
}: TemplatesSheetProps) {
  if (!open) return null;

  return (
    <div
      className={`${
        isMobileFrame ? 'absolute' : 'fixed'
      } inset-0 z-50 flex items-end justify-center bg-black/45 backdrop-blur-xs`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="New note templates"
    >
      <div
        className="w-full max-w-lg rounded-t-3xl bg-white dark:bg-[#1C1C1E] border-t border-slate-200 dark:border-white/[0.1] px-4 pt-3 pb-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1.5 bg-slate-300 dark:bg-zinc-700 rounded-full mx-auto mb-3" />
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Create Note
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close templates"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-white/[0.06]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-white/[0.07]">
          {NOTE_TEMPLATES.map((tpl) => {
            const Icon = tpl.icon;
            return (
              <button
                key={tpl.id}
                type="button"
                onClick={() => {
                  onSelectTemplate(tpl);
                  onClose();
                }}
                className="w-full flex items-center gap-3.5 py-3 px-2 min-h-[56px] text-left rounded-xl hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-zinc-800 flex items-center justify-center shrink-0 text-slate-700 dark:text-zinc-200">
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">
                    {tpl.label}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-zinc-400 truncate">
                    {tpl.subtitle}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
