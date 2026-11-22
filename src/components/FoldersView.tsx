import { useState } from 'react';
import {
  Archive,
  Check,
  ChevronRight,
  Folder,
  FolderPlus,
  MinusCircle,
  Pencil,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import { AccentColor, Note, NoteFolder } from '../types/notes';
import { getAccentClasses } from '../utils/noteHelpers';

interface FoldersViewProps {
  folders: NoteFolder[];
  notes: Note[];
  accent: AccentColor;
  isMobileFrame: boolean;
  onOpenFolder: (folderId: 'all' | 'tasks' | 'archive' | 'trash' | string) => void;
  onOpenMessenger: () => void;
  onOpenSettings: () => void;
  onCreateFolder: (label: string) => void;
  onRenameFolder: (id: string, label: string) => void;
  onDeleteFolder: (id: string) => void;
}

export function FoldersView({
  folders,
  notes,
  accent,
  isMobileFrame,
  onOpenFolder,
  onOpenMessenger,
  onOpenSettings,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
}: FoldersViewProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [showNewFolderSheet, setShowNewFolderSheet] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const accentStyle = getAccentClasses(accent);

  const activeNotes = notes.filter((n) => !n.trashed && !n.archived);
  const allCount = activeNotes.length;
  const archiveCount = notes.filter((n) => n.archived && !n.trashed).length;
  const trashCount = notes.filter((n) => n.trashed).length;

  const getFolderCount = (folderId: string) =>
    activeNotes.filter((n) => n.folder === folderId).length;

  const handleSubmitNewFolder = () => {
    const clean = newFolderName.trim();
    if (!clean) return;
    onCreateFolder(clean);
    setNewFolderName('');
    setShowNewFolderSheet(false);
  };

  const handleSaveRename = (id: string) => {
    const clean = renameValue.trim();
    if (clean) {
      onRenameFolder(id, clean);
    }
    setRenamingId(null);
    setRenameValue('');
  };

  return (
    <div className="flex-1 flex flex-col">
      {/* Top Floating Circular Action Buttons */}
      <header className="px-4 pt-3 pb-1 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Open settings"
          className="h-11 w-11 rounded-full bg-white dark:bg-[#1C1C1E] border border-slate-200/80 dark:border-white/[0.1] flex items-center justify-center text-slate-700 dark:text-white shadow-xs transition-transform active:scale-95"
        >
          <Settings className="w-[19px] h-[19px]" strokeWidth={1.9} />
        </button>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowNewFolderSheet(true)}
            aria-label="New folder"
            className="h-11 w-11 rounded-full bg-white dark:bg-[#1C1C1E] border border-slate-200/80 dark:border-white/[0.1] flex items-center justify-center text-slate-700 dark:text-white shadow-xs transition-transform active:scale-95"
          >
            <FolderPlus className="w-[19px] h-[19px]" strokeWidth={1.9} />
          </button>

          <button
            type="button"
            onClick={() => {
              setIsEditing((v) => !v);
              setRenamingId(null);
            }}
            className="h-11 px-5 rounded-full bg-white dark:bg-[#1C1C1E] border border-slate-200/80 dark:border-white/[0.1] flex items-center justify-center text-[15px] font-medium text-slate-900 dark:text-white shadow-xs transition-transform active:scale-95 whitespace-nowrap shrink-0"
          >
            {isEditing ? 'Done' : 'Edit'}
          </button>
        </div>
      </header>

      {/* Large Title Header — tapping "Folders" opens the hidden Messenger window */}
      <div className="px-4 pt-3 pb-4">
        <button
          type="button"
          onClick={onOpenMessenger}
          className="text-left focus:outline-none select-none"
        >
          <h1 className="text-[32px] font-bold tracking-tight text-slate-900 dark:text-white leading-tight">
            Folders
          </h1>
        </button>
      </div>

      {/* Main Grouped Folders Section */}
      <div className="px-4 space-y-6 pb-24">
        <section className="space-y-2.5">
          <h2 className="px-1 text-[17px] font-bold text-slate-900 dark:text-white">
            On My Phone
          </h2>

          <div className="rounded-[22px] bg-white dark:bg-[#1C1C1E] border border-slate-200/70 dark:border-white/[0.06] overflow-hidden">
            {/* All Notes Row */}
            <button
              type="button"
              disabled={isEditing}
              onClick={() => onOpenFolder('all')}
              className="w-full min-h-[54px] pl-4 pr-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-white/[0.03] active:bg-slate-100 dark:active:bg-white/[0.06] transition-colors disabled:opacity-60"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <Folder className={`w-[20px] h-[20px] shrink-0 ${accentStyle.text}`} strokeWidth={1.9} />
                <span className="text-[16px] font-normal text-slate-900 dark:text-white truncate">
                  All Notes
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[15px] text-slate-400 dark:text-zinc-400 tabular-nums">
                  {allCount}
                </span>
                <ChevronRight className="w-4 h-4 text-slate-300 dark:text-zinc-600" />
              </div>
            </button>

            {/* Notes, Personal Notes, and user-created folders */}
            {folders.map((folder) => {
              const count = getFolderCount(folder.id);
              const isRenaming = renamingId === folder.id;

              return (
                <div key={folder.id} className="relative">
                  <div className="ml-[50px] border-t border-slate-200/70 dark:border-white/[0.07]" />
                  {isRenaming ? (
                    <div className="min-h-[54px] pl-4 pr-2.5 flex items-center gap-2">
                      <Folder
                        className={`w-[20px] h-[20px] shrink-0 ${accentStyle.text}`}
                        strokeWidth={1.9}
                      />
                      <input
                        type="text"
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveRename(folder.id);
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        className="flex-1 min-w-0 bg-slate-100 dark:bg-zinc-800 rounded-lg px-2.5 py-1.5 text-[15px] text-slate-900 dark:text-white focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveRename(folder.id)}
                        aria-label="Save folder name"
                        className={`min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl ${accentStyle.text}`}
                      >
                        <Check className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="min-h-[54px] pl-4 pr-3.5 flex items-center justify-between gap-2">
                      {isEditing && !folder.isSystem && (
                        <button
                          type="button"
                          onClick={() => onDeleteFolder(folder.id)}
                          aria-label={`Delete ${folder.label}`}
                          className="min-h-[40px] min-w-[36px] -ml-1.5 flex items-center justify-center text-rose-500"
                        >
                          <MinusCircle className="w-5 h-5" />
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={isEditing}
                        onClick={() => onOpenFolder(folder.id)}
                        className="flex-1 min-h-[54px] flex items-center justify-between gap-3 text-left disabled:cursor-default"
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          <Folder
                            className={`w-[20px] h-[20px] shrink-0 ${accentStyle.text}`}
                            strokeWidth={1.9}
                          />
                          <span className="text-[16px] font-normal text-slate-900 dark:text-white truncate">
                            {folder.label}
                          </span>
                        </div>

                        {!isEditing && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[15px] text-slate-400 dark:text-zinc-400 tabular-nums">
                              {count}
                            </span>
                            <ChevronRight className="w-4 h-4 text-slate-300 dark:text-zinc-600" />
                          </div>
                        )}
                      </button>

                      {isEditing && !folder.isSystem && (
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingId(folder.id);
                            setRenameValue(folder.label);
                          }}
                          aria-label={`Rename ${folder.label}`}
                          className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Archive & Recently Deleted appear cleanly only when items exist */}
        {(archiveCount > 0 || trashCount > 0) && (
          <section className="space-y-2.5">
            <div className="rounded-[22px] bg-white dark:bg-[#1C1C1E] border border-slate-200/70 dark:border-white/[0.06] overflow-hidden">
              {archiveCount > 0 && (
                <button
                  type="button"
                  onClick={() => onOpenFolder('archive')}
                  className="w-full min-h-[52px] pl-4 pr-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <Archive className={`w-[20px] h-[20px] shrink-0 ${accentStyle.text}`} strokeWidth={1.9} />
                    <span className="text-[16px] text-slate-900 dark:text-white truncate">
                      Archive
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[15px] text-slate-400 dark:text-zinc-400 tabular-nums">
                      {archiveCount}
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-300 dark:text-zinc-600" />
                  </div>
                </button>
              )}

              {archiveCount > 0 && trashCount > 0 && (
                <div className="ml-[50px] border-t border-slate-200/70 dark:border-white/[0.07]" />
              )}

              {trashCount > 0 && (
                <button
                  type="button"
                  onClick={() => onOpenFolder('trash')}
                  className="w-full min-h-[52px] pl-4 pr-3.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <Trash2 className={`w-[20px] h-[20px] shrink-0 ${accentStyle.text}`} strokeWidth={1.9} />
                    <span className="text-[16px] text-slate-900 dark:text-white truncate">
                      Recently Deleted
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[15px] text-slate-400 dark:text-zinc-400 tabular-nums">
                      {trashCount}
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-300 dark:text-zinc-600" />
                  </div>
                </button>
              )}
            </div>
          </section>
        )}
      </div>

      {/* New Folder Sheet / Modal */}
      {showNewFolderSheet && (
        <div
          className={`${
            isMobileFrame ? 'absolute' : 'fixed'
          } inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-4`}
          onClick={() => setShowNewFolderSheet(false)}
          role="dialog"
          aria-modal="true"
          aria-label="New folder"
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#1C1C1E] border border-slate-200 dark:border-white/[0.1] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                New Folder
              </h2>
              <button
                type="button"
                onClick={() => setShowNewFolderSheet(false)}
                aria-label="Close"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full text-slate-400 hover:text-slate-800 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <input
              type="text"
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmitNewFolder();
              }}
              placeholder="Folder name"
              className="w-full h-11 px-3.5 rounded-xl bg-slate-100 dark:bg-black/60 border border-slate-200 dark:border-white/[0.1] text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            />
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setShowNewFolderSheet(false)}
                className="min-h-[44px] rounded-xl bg-slate-100 dark:bg-zinc-800 text-sm font-medium text-slate-700 dark:text-zinc-200"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!newFolderName.trim()}
                onClick={handleSubmitNewFolder}
                className={`min-h-[44px] rounded-xl text-sm font-semibold text-white dark:text-black disabled:opacity-40 ${accentStyle.bg}`}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
