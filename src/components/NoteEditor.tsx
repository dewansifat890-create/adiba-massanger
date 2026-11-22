import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronLeft,
  Clock,
  Copy,
  Download,
  Folder,
  Heading,
  List,
  ListChecks,
  Minus,
  MoreHorizontal,
  Palette,
  Paperclip,
  Pin,
  Plus,
  RotateCcw,
  Share,
  Table,
  Trash2,
  X,
} from 'lucide-react';
import { NOTE_COLORS } from '../data/defaultNotes';
import {
  AppSettings,
  ChecklistItem,
  FolderId,
  Note,
  NoteColor,
  NoteFolder,
} from '../types/notes';
import {
  formatRelativeTime,
  generateId,
  getAccentClasses,
  getEditorSizeClass,
  getFontClass,
  getNoteStats,
  noteToMarkdown,
  sortChecklist,
} from '../utils/noteHelpers';

interface NoteEditorProps {
  note: Note;
  folders: NoteFolder[];
  settings: AppSettings;
  isMobileFrame: boolean;
  onBack: () => void;
  onChange: (updated: Note) => void;
  onDuplicate: (note: Note) => void;
  onTrash: (id: string) => void;
  onRestore: (id: string) => void;
  onPermanentDelete: (id: string) => void;
  onShowToast: (message: string) => void;
}

type ToolbarPopover = 'aa' | 'attach' | 'tint' | null;

export function NoteEditor({
  note,
  folders,
  settings,
  isMobileFrame,
  onBack,
  onChange,
  onDuplicate,
  onTrash,
  onRestore,
  onPermanentDelete,
  onShowToast,
}: NoteEditorProps) {
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showFolderSubmenu, setShowFolderSubmenu] = useState(false);
  const [activePopover, setActivePopover] = useState<ToolbarPopover>(null);
  const [newTaskText, setNewTaskText] = useState('');
  const [showChecklistInput, setShowChecklistInput] = useState(note.checklist.length > 0);
  const [confirmPermanent, setConfirmPermanent] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const taskInputRef = useRef<HTMLInputElement>(null);

  const accentStyle = getAccentClasses(settings.accent);
  const fontClass = getFontClass(settings.fontStyle);
  const sizeClass = getEditorSizeClass(settings.fontSize);
  const colorMeta = NOTE_COLORS.find((c) => c.id === note.color) ?? NOTE_COLORS[0];
  const folderLabel = folders.find((f) => f.id === note.folder)?.label ?? 'Notes';
  const stats = getNoteStats(note);
  const orderedChecklist = sortChecklist(note.checklist, settings.moveCheckedToBottom);

  useEffect(() => {
    if (!note.title && !note.body && note.checklist.length === 0 && !note.trashed) {
      titleRef.current?.focus();
    }
  }, [note.id]);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.style.height = 'auto';
      bodyRef.current.style.height = `${Math.max(220, bodyRef.current.scrollHeight)}px`;
    }
  }, [note.body, settings.fontSize, settings.fontStyle]);

  const updateNote = (patch: Partial<Note>) => {
    onChange({
      ...note,
      ...patch,
      updatedAt: Date.now(),
    });
  };

  const handleBodyChange = (value: string) => {
    if (settings.smartChecklistSyntax) {
      const lines = value.split('\n');
      const matchIndex = lines.findIndex((line) => /^\s*(-\s\[\s?\]|\[\s?\])\s$/.test(line));
      if (matchIndex !== -1) {
        lines.splice(matchIndex, 1);
        const newItem: ChecklistItem = {
          id: generateId(),
          text: '',
          done: false,
        };
        setShowChecklistInput(true);
        updateNote({
          body: lines.join('\n'),
          checklist: [...note.checklist, newItem],
        });
        requestAnimationFrame(() => {
          taskInputRef.current?.focus();
        });
        return;
      }
    }
    updateNote({ body: value });
  };

  const insertSnippet = (snippet: string) => {
    if (note.trashed) return;
    const el = bodyRef.current;
    if (!el) {
      updateNote({ body: `${note.body}${note.body ? '\n' : ''}${snippet}` });
      return;
    }
    const start = el.selectionStart ?? note.body.length;
    const end = el.selectionEnd ?? note.body.length;
    const before = note.body.slice(0, start);
    const after = note.body.slice(end);
    const needsLeadingNewline =
      snippet.startsWith('## ') || snippet.startsWith('• ') || snippet.startsWith('---') || snippet.startsWith('| ')
        ? before.length > 0 && !before.endsWith('\n')
          ? '\n'
          : ''
        : '';
    const nextBody = `${before}${needsLeadingNewline}${snippet}${after}`;
    updateNote({ body: nextBody });
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + needsLeadingNewline.length + snippet.length;
      el.setSelectionRange(cursor, cursor);
    });
  };

  const handleAddChecklistItem = (text?: string) => {
    const clean = (text ?? newTaskText).trim();
    if (!clean) {
      setShowChecklistInput(true);
      requestAnimationFrame(() => taskInputRef.current?.focus());
      return;
    }
    const item: ChecklistItem = {
      id: generateId(),
      text: clean,
      done: false,
    };
    updateNote({ checklist: [...note.checklist, item] });
    setNewTaskText('');
    requestAnimationFrame(() => taskInputRef.current?.focus());
  };

  const handleToggleTask = (itemId: string) => {
    updateNote({
      checklist: note.checklist.map((item) =>
        item.id === itemId ? { ...item, done: !item.done } : item
      ),
    });
  };

  const handleUpdateTaskText = (itemId: string, text: string) => {
    updateNote({
      checklist: note.checklist.map((item) =>
        item.id === itemId ? { ...item, text } : item
      ),
    });
  };

  const handleDeleteTask = (itemId: string) => {
    updateNote({
      checklist: note.checklist.filter((item) => item.id !== itemId),
    });
  };

  const handleShareOrCopy = async () => {
    const md = noteToMarkdown(note);
    if (navigator.share) {
      try {
        await navigator.share({
          title: note.title || 'Note',
          text: md,
        });
        return;
      } catch {
        // User cancelled or share unsupported; fallback to copy
      }
    }
    try {
      await navigator.clipboard.writeText(md);
      onShowToast('Copied note to clipboard');
    } catch {
      onShowToast('Unable to copy note');
    }
  };

  const handleDownloadMarkdown = () => {
    const md = noteToMarkdown(note);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (note.title.trim() || 'untitled-note')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
    a.href = url;
    a.download = `${safeName}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setActivePopover(null);
    setShowMoreMenu(false);
    onShowToast('Exported Markdown file');
  };

  const closeAllMenus = () => {
    setShowMoreMenu(false);
    setShowFolderSubmenu(false);
    setActivePopover(null);
  };

  return (
    <div
      className={`min-h-full flex-1 flex flex-col transition-colors duration-150 ${
        note.color === 'default'
          ? 'bg-[#f2f2f7] dark:bg-black'
          : colorMeta.cardClass.replace(/border-[^\s]+/g, '')
      }`}
      onClick={closeAllMenus}
    >
      {/* Top Bar matching Screenshot 3: [ < ] ... [ ↑ | ••• ] [ ✓ ] */}
      <header className="sticky top-0 z-30 h-[60px] px-4 flex items-center justify-between gap-3 bg-[#f2f2f7]/90 dark:bg-black/90 backdrop-blur-xl">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to notes"
          className="h-11 w-11 rounded-full bg-white dark:bg-[#1C1C1E] border border-slate-200/80 dark:border-white/[0.1] flex items-center justify-center text-slate-800 dark:text-white shadow-xs transition-transform active:scale-95"
        >
          <ChevronLeft className="w-5 h-5" strokeWidth={2.1} />
        </button>

        <div className="flex items-center gap-2.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          {/* Combined Share + Delete + More Glass Pill */}
          <div className="relative h-11 px-1.5 rounded-full bg-white dark:bg-[#1C1C1E] border border-slate-200/80 dark:border-white/[0.1] shadow-xs flex items-center gap-0.5">
            <button
              type="button"
              onClick={handleShareOrCopy}
              aria-label="Share or copy note"
              className="h-9 w-10 rounded-full flex items-center justify-center text-slate-700 dark:text-zinc-300 hover:text-slate-950 dark:hover:text-white transition-colors"
            >
              <Share className="w-[18px] h-[18px]" strokeWidth={1.85} />
            </button>

            {!note.trashed && (
              <button
                type="button"
                onClick={() => {
                  closeAllMenus();
                  onTrash(note.id);
                }}
                aria-label="Delete note"
                className="h-9 w-10 rounded-full flex items-center justify-center text-slate-700 dark:text-zinc-300 hover:text-rose-500 transition-colors"
              >
                <Trash2 className="w-[18px] h-[18px]" strokeWidth={1.85} />
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setShowMoreMenu((v) => !v);
                setShowFolderSubmenu(false);
                setActivePopover(null);
              }}
              aria-label="More options"
              className="h-9 w-10 rounded-full flex items-center justify-center text-slate-700 dark:text-white hover:bg-slate-100 dark:hover:bg-white/[0.08] transition-colors"
            >
              <MoreHorizontal className="w-[18px] h-[18px]" strokeWidth={2} />
            </button>

            {showMoreMenu && (
              <div className="absolute right-0 top-13 w-52 rounded-2xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-[#1C1C1E] shadow-2xl py-1.5 z-40">
                {!note.trashed && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        updateNote({ pinned: !note.pinned });
                        setShowMoreMenu(false);
                      }}
                      className="w-full px-3.5 min-h-[44px] flex items-center justify-between text-sm text-slate-700 dark:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                    >
                      <span className="flex items-center gap-2.5">
                        <Pin className="w-4 h-4 text-slate-500 dark:text-zinc-400" />
                        <span>{note.pinned ? 'Unpin Note' : 'Pin Note'}</span>
                      </span>
                      {note.pinned && <Check className={`w-4 h-4 ${accentStyle.text}`} />}
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowFolderSubmenu((v) => !v)}
                      className="w-full px-3.5 min-h-[44px] flex items-center justify-between text-sm text-slate-700 dark:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                    >
                      <span className="flex items-center gap-2.5">
                        <Folder className="w-4 h-4 text-slate-500 dark:text-zinc-400" />
                        <span>Folder</span>
                      </span>
                      <span className="text-xs text-slate-400 dark:text-zinc-400 truncate max-w-[90px]">
                        {folderLabel}
                      </span>
                    </button>

                    {showFolderSubmenu && (
                      <div className="mx-2 my-1 rounded-xl bg-slate-50 dark:bg-black/50 py-1">
                        {folders.map((f) => (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => {
                              updateNote({ folder: f.id as FolderId });
                              setShowMoreMenu(false);
                              setShowFolderSubmenu(false);
                            }}
                            className="w-full px-3 min-h-[38px] flex items-center justify-between text-xs text-slate-700 dark:text-zinc-200 hover:bg-slate-200/50 dark:hover:bg-white/[0.06]"
                          >
                            <span className="truncate">{f.label}</span>
                            {note.folder === f.id && <Check className={`w-3.5 h-3.5 ${accentStyle.text}`} />}
                          </button>
                        ))}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        onDuplicate(note);
                        setShowMoreMenu(false);
                      }}
                      className="w-full px-3.5 min-h-[44px] flex items-center gap-2.5 text-sm text-slate-700 dark:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                    >
                      <Plus className="w-4 h-4 text-slate-500 dark:text-zinc-400" />
                      <span>Duplicate</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        updateNote({ archived: !note.archived, pinned: false });
                        setShowMoreMenu(false);
                        onShowToast(note.archived ? 'Restored from Archive' : 'Moved to Archive');
                        onBack();
                      }}
                      className="w-full px-3.5 min-h-[44px] flex items-center gap-2.5 text-sm text-slate-700 dark:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                    >
                      {note.archived ? (
                        <>
                          <ArchiveRestore className="w-4 h-4 text-slate-500 dark:text-zinc-400" />
                          <span>Unarchive</span>
                        </>
                      ) : (
                        <>
                          <Archive className="w-4 h-4 text-slate-500 dark:text-zinc-400" />
                          <span>Archive</span>
                        </>
                      )}
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={handleDownloadMarkdown}
                  className="w-full px-3.5 min-h-[44px] flex items-center gap-2.5 text-sm text-slate-700 dark:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                >
                  <Download className="w-4 h-4 text-slate-500 dark:text-zinc-400" />
                  <span>Export Markdown</span>
                </button>

                {!note.trashed && (
                  <>
                    <div className="my-1 border-t border-slate-100 dark:border-white/[0.07]" />
                    <button
                      type="button"
                      onClick={() => {
                        setShowMoreMenu(false);
                        onTrash(note.id);
                      }}
                      className="w-full px-3.5 min-h-[44px] flex items-center gap-2.5 text-sm text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>Delete Note</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Solid Accent Checkmark Done Button */}
          <button
            type="button"
            onClick={onBack}
            aria-label="Done editing"
            className={`h-11 w-11 rounded-full flex items-center justify-center shadow-md transition-transform active:scale-95 text-white dark:text-black ${accentStyle.bg} ${accentStyle.bgHover}`}
          >
            <Check className="w-5 h-5" strokeWidth={2.5} />
          </button>
        </div>
      </header>

      {/* Trash Banner */}
      {note.trashed && (
        <div className="mx-4 mt-1 mb-2 p-3 rounded-2xl bg-amber-50 dark:bg-[#1C1C1E] border border-amber-200 dark:border-amber-800/40 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-amber-900 dark:text-amber-200">
            Recently Deleted — restore to edit
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onRestore(note.id)}
              className="min-h-[36px] px-3 rounded-xl bg-white dark:bg-zinc-800 text-xs font-medium text-slate-800 dark:text-white flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Restore</span>
            </button>
            {confirmPermanent ? (
              <button
                type="button"
                onClick={() => onPermanentDelete(note.id)}
                className="min-h-[36px] px-3 rounded-xl bg-rose-600 text-white text-xs font-semibold"
              >
                Confirm
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (settings.confirmDelete) {
                    setConfirmPermanent(true);
                  } else {
                    onPermanentDelete(note.id);
                  }
                }}
                className="min-h-[36px] px-3 rounded-xl text-xs font-medium text-rose-500"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      )}

      {/* Clean Distraction-Free Writing Canvas */}
      <main className="flex-1 w-full max-w-3xl mx-auto px-5 pt-2 pb-28">
        <input
          ref={titleRef}
          type="text"
          value={note.title}
          readOnly={note.trashed}
          onChange={(e) => updateNote({ title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              bodyRef.current?.focus();
            }
          }}
          placeholder="Title"
          className={`${fontClass} ${sizeClass.title} w-full bg-transparent font-bold tracking-tight text-slate-900 dark:text-white placeholder:text-slate-400/70 dark:placeholder:text-zinc-700 focus:outline-none mb-2 caret-[#E5A91A]`}
        />

        <textarea
          ref={bodyRef}
          value={note.body}
          readOnly={note.trashed}
          onChange={(e) => handleBodyChange(e.target.value)}
          placeholder="Start writing…"
          rows={8}
          className={`${fontClass} ${sizeClass.body} w-full bg-transparent text-slate-800 dark:text-zinc-100 placeholder:text-slate-400/70 dark:placeholder:text-zinc-700 focus:outline-none resize-none overflow-hidden caret-[#E5A91A]`}
        />

        {/* Interactive Smart Checklist Block */}
        {(orderedChecklist.length > 0 || showChecklistInput) && (
          <section className="mt-4 pt-3 border-t border-black/[0.06] dark:border-white/[0.08]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-500 dark:text-zinc-400">
                Checklist
              </span>
              {stats.totalTasks > 0 && (
                <span className="text-xs text-slate-500 dark:text-zinc-400 tabular-nums">
                  {stats.doneTasks}/{stats.totalTasks}
                </span>
              )}
            </div>

            <ul className="space-y-1">
              {orderedChecklist.map((item) => (
                <li key={item.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={note.trashed}
                    onClick={() => handleToggleTask(item.id)}
                    aria-label={item.done ? 'Mark incomplete' : 'Mark complete'}
                    className="min-h-[42px] min-w-[34px] flex items-center justify-center rounded-lg"
                  >
                    <span
                      className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${
                        item.done
                          ? `${accentStyle.bg} border-transparent text-white dark:text-black`
                          : 'border-slate-300 dark:border-zinc-600'
                      }`}
                    >
                      {item.done && <Check className="w-3 h-3" strokeWidth={3} />}
                    </span>
                  </button>

                  <input
                    type="text"
                    value={item.text}
                    readOnly={note.trashed}
                    onChange={(e) => handleUpdateTaskText(item.id, e.target.value)}
                    placeholder="Task item"
                    className={`${fontClass} flex-1 min-w-0 bg-transparent py-1.5 text-[15px] focus:outline-none caret-[#E5A91A] ${
                      item.done
                        ? 'line-through text-slate-400 dark:text-zinc-500'
                        : 'text-slate-800 dark:text-white'
                    }`}
                  />

                  {!note.trashed && (
                    <button
                      type="button"
                      onClick={() => handleDeleteTask(item.id)}
                      aria-label="Remove task"
                      className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-500"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>

            {!note.trashed && (
              <div className="flex items-center gap-2 mt-1">
                <span className="min-w-[34px] flex items-center justify-center text-slate-400">
                  <Plus className="w-4 h-4" />
                </span>
                <input
                  ref={taskInputRef}
                  type="text"
                  value={newTaskText}
                  onChange={(e) => setNewTaskText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddChecklistItem();
                    }
                  }}
                  placeholder="Add item…"
                  className={`${fontClass} flex-1 bg-transparent py-2 text-[15px] text-slate-800 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-600 focus:outline-none caret-[#E5A91A]`}
                />
                {newTaskText.trim() && (
                  <button
                    type="button"
                    onClick={() => handleAddChecklistItem()}
                    className={`min-h-[36px] px-3.5 rounded-full text-xs font-semibold text-white dark:text-black ${accentStyle.bg}`}
                  >
                    Add
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {/* Quiet Footer Metadata */}
        {settings.showStats && (note.title || note.body || note.checklist.length > 0) && (
          <div className="mt-8 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400 dark:text-zinc-600 tabular-nums">
            <span>Edited {formatRelativeTime(note.updatedAt)}</span>
            <span aria-hidden="true">·</span>
            <span>{stats.words} words</span>
            <span aria-hidden="true">·</span>
            <span>{stats.readMinutes} min read</span>
          </div>
        )}
      </main>

      {/* Bottom Floating Glass Formatting Pill matching Screenshot 3 */}
      {!note.trashed && (
        <div
          className={`${
            isMobileFrame ? 'sticky bottom-0' : 'fixed bottom-0 left-0 right-0'
          } z-30 px-4 pb-4 pt-2 bg-gradient-to-t from-[#f2f2f7] via-[#f2f2f7]/90 to-transparent dark:from-black dark:via-black/90`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Popover above pill */}
          {activePopover === 'aa' && (
            <div className="max-w-sm mx-auto mb-2 p-2 rounded-2xl bg-white dark:bg-[#1C1C1E] border border-slate-200 dark:border-white/[0.1] shadow-2xl flex items-center justify-around gap-1">
              <button
                type="button"
                onClick={() => {
                  insertSnippet('## ');
                  setActivePopover(null);
                }}
                className="min-h-[42px] px-3 rounded-xl flex items-center gap-1.5 text-xs font-medium text-slate-800 dark:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]"
              >
                <Heading className="w-4 h-4" />
                <span>Heading</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  insertSnippet('• ');
                  setActivePopover(null);
                }}
                className="min-h-[42px] px-3 rounded-xl flex items-center gap-1.5 text-xs font-medium text-slate-800 dark:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]"
              >
                <List className="w-4 h-4" />
                <span>Bullet</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  insertSnippet('---\n');
                  setActivePopover(null);
                }}
                className="min-h-[42px] px-3 rounded-xl flex items-center gap-1.5 text-xs font-medium text-slate-800 dark:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]"
              >
                <Minus className="w-4 h-4" />
                <span>Divider</span>
              </button>
            </div>
          )}

          {activePopover === 'attach' && (
            <div className="max-w-sm mx-auto mb-2 p-1.5 rounded-2xl bg-white dark:bg-[#1C1C1E] border border-slate-200 dark:border-white/[0.1] shadow-2xl flex items-center justify-around gap-1">
              <button
                type="button"
                onClick={() => {
                  const timeStr = new Intl.DateTimeFormat('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                  }).format(new Date());
                  insertSnippet(`${timeStr} — `);
                  setActivePopover(null);
                }}
                className="min-h-[42px] px-3 rounded-xl flex items-center gap-1.5 text-xs font-medium text-slate-800 dark:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]"
              >
                <Clock className="w-4 h-4" />
                <span>Timestamp</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  handleShareOrCopy();
                  setActivePopover(null);
                }}
                className="min-h-[42px] px-3 rounded-xl flex items-center gap-1.5 text-xs font-medium text-slate-800 dark:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]"
              >
                <Copy className="w-4 h-4" />
                <span>Copy</span>
              </button>
              <button
                type="button"
                onClick={handleDownloadMarkdown}
                className="min-h-[42px] px-3 rounded-xl flex items-center gap-1.5 text-xs font-medium text-slate-800 dark:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]"
              >
                <Download className="w-4 h-4" />
                <span>Export .md</span>
              </button>
            </div>
          )}

          {activePopover === 'tint' && (
            <div className="max-w-sm mx-auto mb-2 px-3.5 py-2.5 rounded-2xl bg-white dark:bg-[#1C1C1E] border border-slate-200 dark:border-white/[0.1] shadow-2xl flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-zinc-400">Tint</span>
              <div className="flex items-center gap-2">
                {NOTE_COLORS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      updateNote({ color: c.id as NoteColor });
                      setActivePopover(null);
                    }}
                    aria-label={c.label}
                    className={`w-8 h-8 rounded-full border flex items-center justify-center transition-transform active:scale-95 ${c.swatchClass}`}
                  >
                    {note.color === c.id && (
                      <Check className="w-3.5 h-3.5 text-slate-800 dark:text-white" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Formatting Pill matching Screenshot 3: Aa | Checklist | Table | Paperclip | Tint */}
          <div className="max-w-md mx-auto h-12 rounded-full bg-white/95 dark:bg-[#1C1C1E]/95 backdrop-blur-xl border border-slate-200/80 dark:border-white/[0.1] shadow-lg px-2 flex items-center justify-around">
            <button
              type="button"
              onClick={() => setActivePopover((p) => (p === 'aa' ? null : 'aa'))}
              aria-label="Text formatting"
              className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full text-[16px] font-medium transition-colors ${
                activePopover === 'aa'
                  ? accentStyle.text
                  : 'text-slate-700 dark:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]'
              }`}
            >
              Aa
            </button>

            <button
              type="button"
              onClick={() => {
                setActivePopover(null);
                setShowChecklistInput(true);
                requestAnimationFrame(() => taskInputRef.current?.focus());
              }}
              aria-label="Add checklist item"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full text-slate-700 dark:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]"
            >
              <ListChecks className="w-[20px] h-[20px]" strokeWidth={1.85} />
            </button>

            <button
              type="button"
              onClick={() => {
                setActivePopover(null);
                insertSnippet('| Item | Notes |\n| --- | --- |\n|  |  |\n');
              }}
              aria-label="Insert table"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full text-slate-700 dark:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]"
            >
              <Table className="w-[19px] h-[19px]" strokeWidth={1.85} />
            </button>

            <button
              type="button"
              onClick={() => setActivePopover((p) => (p === 'attach' ? null : 'attach'))}
              aria-label="Insert or export"
              className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-colors ${
                activePopover === 'attach'
                  ? accentStyle.text
                  : 'text-slate-700 dark:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]'
              }`}
            >
              <Paperclip className="w-[19px] h-[19px]" strokeWidth={1.85} />
            </button>

            <button
              type="button"
              onClick={() => setActivePopover((p) => (p === 'tint' ? null : 'tint'))}
              aria-label="Paper tint"
              className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full transition-colors ${
                activePopover === 'tint'
                  ? accentStyle.text
                  : 'text-slate-700 dark:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06]'
              }`}
            >
              <Palette className="w-[19px] h-[19px]" strokeWidth={1.85} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
