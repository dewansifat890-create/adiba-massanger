import { ArchiveRestore, Check, Pin, RotateCcw, Trash2 } from 'lucide-react';
import { NOTE_COLORS } from '../data/defaultNotes';
import { AccentColor, FontStyle, Note, NoteFolder, ViewMode } from '../types/notes';
import {
  formatRelativeTime,
  getAccentClasses,
  getFontClass,
  getNoteStats,
  sortChecklist,
} from '../utils/noteHelpers';

interface NoteCardProps {
  note: Note;
  folders: NoteFolder[];
  viewMode: ViewMode;
  fontStyle: FontStyle;
  accent: AccentColor;
  showPreviews: boolean;
  showStats: boolean;
  moveCheckedToBottom: boolean;
  onOpen: (note: Note) => void;
  onTogglePin: (id: string) => void;
  onToggleChecklistItem: (noteId: string, itemId: string) => void;
  onRestore?: (id: string) => void;
  onPermanentDelete?: (id: string) => void;
}

export function NoteCard({
  note,
  folders,
  viewMode,
  fontStyle,
  accent,
  showPreviews,
  showStats,
  moveCheckedToBottom,
  onOpen,
  onTogglePin,
  onToggleChecklistItem,
  onRestore,
  onPermanentDelete,
}: NoteCardProps) {
  const colorMeta = NOTE_COLORS.find((c) => c.id === note.color) ?? NOTE_COLORS[0];
  const folderLabel = folders.find((f) => f.id === note.folder)?.label ?? 'Notes';
  const stats = getNoteStats(note);
  const accentStyle = getAccentClasses(accent);
  const fontClass = getFontClass(fontStyle);

  const visibleChecklist = sortChecklist(note.checklist, moveCheckedToBottom).slice(0, 4);
  const remainingTasks = Math.max(0, note.checklist.length - visibleChecklist.length);

  return (
    <article
      className={`group relative rounded-[20px] border transition-colors duration-150 ${colorMeta.cardClass} ${
        viewMode === 'list' ? 'p-4' : 'p-3.5 flex flex-col justify-between'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => onOpen(note)}
          className={`flex-1 text-left focus-visible:outline-none focus-visible:ring-2 rounded-lg ${accentStyle.ring}`}
        >
          <h3
            className={`${fontClass} text-[16px] font-semibold text-slate-900 dark:text-white line-clamp-2 leading-snug`}
          >
            {note.title.trim() || 'New Note'}
          </h3>
        </button>

        {!note.trashed && !note.archived && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(note.id);
            }}
            aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
            className={`-mt-2 -mr-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 ${accentStyle.ring} ${
              note.pinned
                ? accentStyle.text
                : 'text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-zinc-200'
            }`}
          >
            <Pin className="w-4 h-4" fill={note.pinned ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>

      {showPreviews && (
        <div className="mt-1 space-y-2">
          {note.body.trim() && (
            <button
              type="button"
              onClick={() => onOpen(note)}
              className="block w-full text-left focus-visible:outline-none"
            >
              <p
                className={`${fontClass} text-sm text-slate-600 dark:text-zinc-400 leading-relaxed ${
                  viewMode === 'list' ? 'line-clamp-2' : 'line-clamp-3'
                }`}
              >
                {note.body.trim()}
              </p>
            </button>
          )}

          {visibleChecklist.length > 0 && (
            <ul className="space-y-0.5">
              {visibleChecklist.map((item) => (
                <li key={item.id} className="flex items-start gap-2">
                  <button
                    type="button"
                    disabled={note.trashed}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleChecklistItem(note.id, item.id);
                    }}
                    aria-label={item.done ? `Mark "${item.text}" incomplete` : `Complete "${item.text}"`}
                    className="min-h-[30px] min-w-[26px] -ml-1 flex items-center justify-center rounded-md"
                  >
                    <span
                      className={`w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                        item.done
                          ? `${accentStyle.bg} border-transparent text-white dark:text-black`
                          : 'border-slate-300 dark:border-zinc-600 bg-transparent'
                      }`}
                    >
                      {item.done && <Check className="w-2.5 h-2.5" strokeWidth={3} />}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpen(note)}
                    className={`flex-1 text-left text-sm leading-snug py-0.5 truncate ${
                      item.done
                        ? 'line-through text-slate-400 dark:text-zinc-500'
                        : 'text-slate-700 dark:text-zinc-300'
                    }`}
                  >
                    {item.text || 'Empty task'}
                  </button>
                </li>
              ))}
              {remainingTasks > 0 && (
                <li className="text-xs text-slate-400 dark:text-zinc-500 pl-6 tabular-nums">
                  +{remainingTasks} more {remainingTasks === 1 ? 'task' : 'tasks'}
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      <div className="mt-2.5 pt-2 border-t border-black/[0.05] dark:border-white/[0.06] flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onOpen(note)}
          className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500 dark:text-zinc-500 text-left focus-visible:outline-none"
        >
          <span className="tabular-nums">{formatRelativeTime(note.updatedAt)}</span>
          <span aria-hidden="true">·</span>
          <span>{folderLabel}</span>
          {stats.totalTasks > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">
                {stats.doneTasks}/{stats.totalTasks}
              </span>
            </>
          )}
          {showStats && stats.words > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{stats.words}w</span>
            </>
          )}
        </button>

        {note.archived && onRestore && (
          <button
            type="button"
            onClick={() => onRestore(note.id)}
            aria-label="Unarchive note"
            className="min-h-[40px] min-w-[40px] -my-2 -mr-2 flex items-center justify-center rounded-xl text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white"
          >
            <ArchiveRestore className="w-4 h-4" />
          </button>
        )}

        {note.trashed && (
          <div className="flex items-center -my-2 -mr-2">
            {onRestore && (
              <button
                type="button"
                onClick={() => onRestore(note.id)}
                aria-label="Restore note"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-600 dark:text-zinc-300 hover:text-slate-900 dark:hover:text-white"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
            {onPermanentDelete && (
              <button
                type="button"
                onClick={() => onPermanentDelete(note.id)}
                aria-label="Delete permanently"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-rose-600 dark:text-rose-400"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
