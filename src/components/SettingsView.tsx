import { ChangeEvent, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  Download,
  RotateCcw,
  Smartphone,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  AccentColor,
  AppSettings,
  DesktopLayoutMode,
  FolderId,
  FontSize,
  FontStyle,
  Note,
  NoteFolder,
  SortOption,
  ThemeMode,
  ViewMode,
} from '../types/notes';
import { getAccentClasses } from '../utils/noteHelpers';
import { PWAInstallButton } from './PWAInstallButton';

interface SettingsViewProps {
  settings: AppSettings;
  folders: NoteFolder[];
  notes: Note[];
  onBack: () => void;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onExportBackup: () => void;
  onImportBackup: (notes: Note[]) => void;
  onEmptyTrash: () => void;
  onResetSamples: () => void;
  onShowToast: (message: string) => void;
}

function ToggleSwitch({
  checked,
  onChange,
  accent,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  accent: AccentColor;
  label: string;
}) {
  const accentStyle = getAccentClasses(accent);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
        checked ? accentStyle.bg : 'bg-slate-300 dark:bg-zinc-700'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-sm transition-transform duration-150 ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

export function SettingsView({
  settings,
  folders,
  notes,
  onBack,
  onUpdateSettings,
  onExportBackup,
  onImportBackup,
  onEmptyTrash,
  onResetSamples,
  onShowToast,
}: SettingsViewProps) {
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const accentStyle = getAccentClasses(settings.accent);

  const activeCount = notes.filter((n) => !n.trashed && !n.archived).length;
  const archivedCount = notes.filter((n) => n.archived && !n.trashed).length;
  const trashedCount = notes.filter((n) => n.trashed).length;
  const storageKb = (new Blob([JSON.stringify(notes)]).size / 1024).toFixed(1);

  const accentSwatches: { id: AccentColor; label: string; dotClass: string }[] = [
    { id: 'amber', label: 'Gold', dotClass: 'bg-[#E5A91A]' },
    { id: 'cobalt', label: 'Blue', dotClass: 'bg-blue-600' },
    { id: 'emerald', label: 'Green', dotClass: 'bg-emerald-600' },
    { id: 'rose', label: 'Rose', dotClass: 'bg-rose-600' },
  ];

  const handleFileImport = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const importedArray = Array.isArray(parsed) ? parsed : parsed?.notes;
        if (!Array.isArray(importedArray)) {
          onShowToast('Invalid backup file format');
          return;
        }
        const validNotes: Note[] = importedArray
          .filter((item) => item && typeof item === 'object' && typeof item.id === 'string')
          .map((item) => ({
            id: String(item.id),
            title: typeof item.title === 'string' ? item.title : '',
            body: typeof item.body === 'string' ? item.body : '',
            checklist: Array.isArray(item.checklist)
              ? item.checklist.map((c: { id?: string; text?: string; done?: boolean }) => ({
                  id: String(c.id || Math.random().toString(36).slice(2)),
                  text: String(c.text || ''),
                  done: Boolean(c.done),
                }))
              : [],
            folder: (typeof item.folder === 'string' && item.folder
              ? item.folder
              : 'notes') as FolderId,
            color: (['default', 'sky', 'sage', 'amber', 'rose', 'violet'].includes(item.color)
              ? item.color
              : 'default') as Note['color'],
            pinned: Boolean(item.pinned),
            archived: Boolean(item.archived),
            trashed: Boolean(item.trashed),
            createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
            updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
          }));

        if (validNotes.length === 0) {
          onShowToast('No valid notes found in file');
          return;
        }
        onImportBackup(validNotes);
        onShowToast(`Imported ${validNotes.length} notes`);
      } catch {
        onShowToast('Could not read JSON backup');
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex-1 flex flex-col">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 h-[56px] px-3 flex items-center justify-between bg-[#f2f2f7]/90 dark:bg-black/90 backdrop-blur-xl">
        <button
          type="button"
          onClick={onBack}
          className={`min-h-[44px] pr-2 flex items-center gap-0.5 text-[16px] font-medium ${accentStyle.text}`}
        >
          <ChevronLeft className="w-5 h-5" strokeWidth={2.25} />
          <span>Folders</span>
        </button>
      </header>

      <div className="px-4 pt-1 pb-10 space-y-6">
        <div>
          <h1 className="text-[32px] font-bold tracking-tight text-slate-900 dark:text-white leading-tight">
            Settings
          </h1>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1 tabular-nums">
            {activeCount} active · {archivedCount} archived · {trashedCount} deleted · {storageKb} KB local
          </p>
        </div>

        {/* Appearance */}
        <section className="space-y-2">
          <h2 className="px-1 text-xs font-semibold text-slate-500 dark:text-zinc-400">
            Appearance
          </h2>
          <div className="rounded-[22px] border border-slate-200/80 dark:border-white/[0.06] bg-white dark:bg-[#1C1C1E] divide-y divide-slate-100 dark:divide-white/[0.07]">
            <div className="p-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-[15px] font-medium text-slate-900 dark:text-white">Theme</div>
                <div className="text-xs text-slate-500 dark:text-zinc-400">Light, Dark, or System</div>
              </div>
              <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-black/60">
                {(['dark', 'light', 'system'] as ThemeMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onUpdateSettings({ theme: mode })}
                    className={`min-h-[34px] px-2.5 rounded-lg text-xs font-medium capitalize transition-colors whitespace-nowrap shrink-0 ${
                      settings.theme === mode
                        ? 'bg-white dark:bg-[#2C2C2E] text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-zinc-400'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-[15px] font-medium text-slate-900 dark:text-white">Accent</div>
                <div className="text-xs text-slate-500 dark:text-zinc-400">Folders and controls</div>
              </div>
              <div className="flex items-center gap-2">
                {accentSwatches.map((swatch) => (
                  <button
                    key={swatch.id}
                    type="button"
                    onClick={() => onUpdateSettings({ accent: swatch.id })}
                    aria-label={swatch.label}
                    className={`w-8 h-8 rounded-full ${swatch.dotClass} flex items-center justify-center text-white transition-transform active:scale-95`}
                  >
                    {settings.accent === swatch.id && <Check className="w-4 h-4" strokeWidth={2.5} />}
                  </button>
                ))}
              </div>
            </div>

            <div className="hidden md:flex p-4 items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <Smartphone className="w-4 h-4 text-slate-500 dark:text-zinc-400 mt-0.5 shrink-0" />
                <div>
                  <div className="text-[15px] font-medium text-slate-900 dark:text-white">
                    Screen Size
                  </div>
                  <div className="text-xs text-slate-500 dark:text-zinc-400">
                    Mobile phone frame or full width
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-black/60 shrink-0">
                {(
                  [
                    { id: 'mobile-frame', label: 'Mobile' },
                    { id: 'responsive', label: 'Wide' },
                  ] as { id: DesktopLayoutMode; label: string }[]
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onUpdateSettings({ desktopLayout: opt.id })}
                    className={`min-h-[34px] px-3 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      settings.desktopLayout === opt.id
                        ? 'bg-white dark:bg-[#2C2C2E] text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-zinc-400'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-4 space-y-2.5">
              <div>
                <div className="text-[15px] font-medium text-slate-900 dark:text-white">
                  Install NotePad App
                </div>
                <div className="text-xs text-slate-500 dark:text-zinc-400">
                  Add to home screen on iPhone or Android for offline use &amp; reminders
                </div>
              </div>
              <PWAInstallButton />
            </div>
          </div>
        </section>

        {/* Typography & Display */}
        <section className="space-y-2">
          <h2 className="px-1 text-xs font-semibold text-slate-500 dark:text-zinc-400">
            Typography & View
          </h2>
          <div className="rounded-[22px] border border-slate-200/80 dark:border-white/[0.06] bg-white dark:bg-[#1C1C1E] divide-y divide-slate-100 dark:divide-white/[0.07]">
            <div className="p-4 flex items-center justify-between gap-3">
              <div className="text-[15px] font-medium text-slate-900 dark:text-white">Font</div>
              <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-black/60">
                {(
                  [
                    { id: 'sans', label: 'Sans' },
                    { id: 'serif', label: 'Serif' },
                    { id: 'mono', label: 'Mono' },
                  ] as { id: FontStyle; label: string }[]
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => onUpdateSettings({ fontStyle: f.id })}
                    className={`min-h-[34px] px-3 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      settings.fontStyle === f.id
                        ? 'bg-white dark:bg-[#2C2C2E] text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-zinc-400'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-4 flex items-center justify-between gap-3">
              <div className="text-[15px] font-medium text-slate-900 dark:text-white">
                Text Size
              </div>
              <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-black/60">
                {(['small', 'medium', 'large'] as FontSize[]).map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => onUpdateSettings({ fontSize: sz })}
                    className={`min-h-[34px] px-3 rounded-lg text-xs font-medium capitalize transition-colors whitespace-nowrap shrink-0 ${
                      settings.fontSize === sz
                        ? 'bg-white dark:bg-[#2C2C2E] text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-zinc-400'
                    }`}
                  >
                    {sz}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-4 flex items-center justify-between gap-3">
              <div className="text-[15px] font-medium text-slate-900 dark:text-white">
                Notes Layout
              </div>
              <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-black/60">
                {(['list', 'grid'] as ViewMode[]).map((vm) => (
                  <button
                    key={vm}
                    type="button"
                    onClick={() => onUpdateSettings({ viewMode: vm })}
                    className={`min-h-[34px] px-3 rounded-lg text-xs font-medium capitalize transition-colors whitespace-nowrap shrink-0 ${
                      settings.viewMode === vm
                        ? 'bg-white dark:bg-[#2C2C2E] text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-zinc-400'
                    }`}
                  >
                    {vm}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-4 flex items-center justify-between gap-3 min-h-[58px]">
              <div>
                <div className="text-[15px] font-medium text-slate-900 dark:text-white">
                  Note Previews
                </div>
                <div className="text-xs text-slate-500 dark:text-zinc-400">
                  Show excerpt and tasks in folder view
                </div>
              </div>
              <ToggleSwitch
                checked={settings.showPreviews}
                onChange={(val) => onUpdateSettings({ showPreviews: val })}
                accent={settings.accent}
                label="Toggle note previews"
              />
            </div>

            <div className="p-4 flex items-center justify-between gap-3 min-h-[58px]">
              <div>
                <div className="text-[15px] font-medium text-slate-900 dark:text-white">
                  Word Count & Read Time
                </div>
                <div className="text-xs text-slate-500 dark:text-zinc-400">
                  Display live writing statistics
                </div>
              </div>
              <ToggleSwitch
                checked={settings.showStats}
                onChange={(val) => onUpdateSettings({ showStats: val })}
                accent={settings.accent}
                label="Toggle word count"
              />
            </div>
          </div>
        </section>

        {/* Smart Behavior */}
        <section className="space-y-2">
          <h2 className="px-1 text-xs font-semibold text-slate-500 dark:text-zinc-400">
            Smart Behavior
          </h2>
          <div className="rounded-[22px] border border-slate-200/80 dark:border-white/[0.06] bg-white dark:bg-[#1C1C1E] divide-y divide-slate-100 dark:divide-white/[0.07]">
            <div className="p-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-[15px] font-medium text-slate-900 dark:text-white">
                  Chat Display Name
                </div>
                <div className="text-xs text-slate-500 dark:text-zinc-400">
                  Shown inside hidden folder chats
                </div>
              </div>
              <input
                type="text"
                value={settings.chatDisplayName}
                onChange={(e) => onUpdateSettings({ chatDisplayName: e.target.value })}
                placeholder="Me"
                aria-label="Chat display name"
                className="w-32 min-h-[38px] px-3 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-slate-50 dark:bg-black/60 text-sm text-slate-800 dark:text-white focus:outline-none"
              />
            </div>

            <div className="p-4 flex items-center justify-between gap-3">
              <div className="text-[15px] font-medium text-slate-900 dark:text-white">
                Default Folder
              </div>
              <select
                value={settings.defaultFolder}
                onChange={(e) => onUpdateSettings({ defaultFolder: e.target.value })}
                aria-label="Default folder"
                className="min-h-[38px] px-3 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-slate-50 dark:bg-black/60 text-sm text-slate-800 dark:text-white focus:outline-none"
              >
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="p-4 flex items-center justify-between gap-3">
              <div className="text-[15px] font-medium text-slate-900 dark:text-white">
                Sort Notes By
              </div>
              <select
                value={settings.sortBy}
                onChange={(e) => onUpdateSettings({ sortBy: e.target.value as SortOption })}
                aria-label="Sort order"
                className="min-h-[38px] px-3 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-slate-50 dark:bg-black/60 text-sm text-slate-800 dark:text-white focus:outline-none"
              >
                <option value="updatedAt">Date Edited</option>
                <option value="createdAt">Date Created</option>
                <option value="title">Title (A–Z)</option>
              </select>
            </div>

            <div className="p-4 flex items-center justify-between gap-3 min-h-[58px]">
              <div>
                <div className="text-[15px] font-medium text-slate-900 dark:text-white">
                  Smart Checklist Shortcut
                </div>
                <div className="text-xs text-slate-500 dark:text-zinc-400">
                  Convert &ldquo;- [ ] &rdquo; into live task items
                </div>
              </div>
              <ToggleSwitch
                checked={settings.smartChecklistSyntax}
                onChange={(val) => onUpdateSettings({ smartChecklistSyntax: val })}
                accent={settings.accent}
                label="Toggle smart checklist shortcut"
              />
            </div>

            <div className="p-4 flex items-center justify-between gap-3 min-h-[58px]">
              <div>
                <div className="text-[15px] font-medium text-slate-900 dark:text-white">
                  Move Checked Items Down
                </div>
                <div className="text-xs text-slate-500 dark:text-zinc-400">
                  Sort completed tasks to bottom
                </div>
              </div>
              <ToggleSwitch
                checked={settings.moveCheckedToBottom}
                onChange={(val) => onUpdateSettings({ moveCheckedToBottom: val })}
                accent={settings.accent}
                label="Toggle move checked items down"
              />
            </div>

            <div className="p-4 flex items-center justify-between gap-3 min-h-[58px]">
              <div>
                <div className="text-[15px] font-medium text-slate-900 dark:text-white">
                  Confirm Permanent Delete
                </div>
                <div className="text-xs text-slate-500 dark:text-zinc-400">
                  Prompt before erasing notes forever
                </div>
              </div>
              <ToggleSwitch
                checked={settings.confirmDelete}
                onChange={(val) => onUpdateSettings({ confirmDelete: val })}
                accent={settings.accent}
                label="Toggle confirm permanent delete"
              />
            </div>
          </div>
        </section>

        {/* Backup & Storage */}
        <section className="space-y-2">
          <h2 className="px-1 text-xs font-semibold text-slate-500 dark:text-zinc-400">
            Backup & Storage
          </h2>
          <div className="rounded-[22px] border border-slate-200/80 dark:border-white/[0.06] bg-white dark:bg-[#1C1C1E] divide-y divide-slate-100 dark:divide-white/[0.07]">
            <button
              type="button"
              onClick={onExportBackup}
              className="w-full p-4 min-h-[56px] flex items-center gap-3 text-left hover:bg-slate-50 dark:hover:bg-white/[0.03] rounded-t-[22px]"
            >
              <Download className={`w-4 h-4 ${accentStyle.text}`} />
              <div>
                <div className="text-[15px] font-medium text-slate-900 dark:text-white">
                  Export All Notes (.json)
                </div>
                <div className="text-xs text-slate-500 dark:text-zinc-400">
                  Download an offline backup file
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full p-4 min-h-[56px] flex items-center gap-3 text-left hover:bg-slate-50 dark:hover:bg-white/[0.03]"
            >
              <Upload className={`w-4 h-4 ${accentStyle.text}`} />
              <div>
                <div className="text-[15px] font-medium text-slate-900 dark:text-white">
                  Import Backup (.json)
                </div>
                <div className="text-xs text-slate-500 dark:text-zinc-400">
                  Restore notes from a JSON file
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleFileImport}
                className="hidden"
              />
            </button>

            <div className="p-4 min-h-[56px] flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <RotateCcw className="w-4 h-4 text-slate-500 dark:text-zinc-400" />
                <div>
                  <div className="text-[15px] font-medium text-slate-900 dark:text-white">
                    Restore Starter Notes
                  </div>
                  <div className="text-xs text-slate-500 dark:text-zinc-400">
                    Re-add sample notes
                  </div>
                </div>
              </div>
              {confirmReset ? (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setConfirmReset(false)}
                    className="min-h-[34px] px-2.5 rounded-lg text-xs text-slate-500"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onResetSamples();
                      setConfirmReset(false);
                    }}
                    className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold text-white dark:text-black ${accentStyle.bg}`}
                  >
                    Add
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmReset(true)}
                  className="min-h-[34px] px-3 rounded-xl bg-slate-100 dark:bg-zinc-800 text-xs font-medium text-slate-700 dark:text-zinc-200"
                >
                  Restore
                </button>
              )}
            </div>

            <div className="p-4 min-h-[56px] flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Trash2 className="w-4 h-4 text-rose-500" />
                <div>
                  <div className="text-[15px] font-medium text-rose-500">Empty Recently Deleted</div>
                  <div className="text-xs text-slate-500 dark:text-zinc-400 tabular-nums">
                    {trashedCount === 0
                      ? 'Trash is empty'
                      : `${trashedCount} ${trashedCount === 1 ? 'note' : 'notes'} in Trash`}
                  </div>
                </div>
              </div>
              {trashedCount > 0 &&
                (confirmEmptyTrash ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setConfirmEmptyTrash(false)}
                      className="min-h-[34px] px-2.5 rounded-lg text-xs text-slate-500"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onEmptyTrash();
                        setConfirmEmptyTrash(false);
                      }}
                      className="min-h-[34px] px-3 rounded-lg bg-rose-600 text-white text-xs font-semibold"
                    >
                      Erase
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmEmptyTrash(true)}
                    className="min-h-[34px] px-3 rounded-xl bg-rose-500/15 text-xs font-medium text-rose-500"
                  >
                    Empty
                  </button>
                ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
