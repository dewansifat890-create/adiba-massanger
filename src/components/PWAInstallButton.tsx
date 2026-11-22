import { useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  compact?: boolean;
  isMobileFrame?: boolean;
}

export function PWAInstallButton({
  compact = false,
  isMobileFrame = false,
}: PWAInstallButtonProps) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className={
          compact
            ? 'min-h-[36px] px-3.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors'
            : 'w-full min-h-[46px] px-4 rounded-2xl bg-[#E5A91A] hover:bg-[#d49a12] text-black text-sm font-semibold flex items-center justify-center gap-2 transition-colors'
        }
      >
        <Download className="w-4 h-4" />
        <span>Install NotePad App</span>
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowGuide(true)}
        className={
          compact
            ? 'min-h-[36px] px-3.5 rounded-full bg-slate-100 dark:bg-zinc-800 text-slate-800 dark:text-white text-xs font-medium inline-flex items-center gap-1.5'
            : 'w-full min-h-[46px] px-4 rounded-2xl bg-slate-100 dark:bg-[#2C2C2E] text-slate-900 dark:text-white text-sm font-medium flex items-center justify-center gap-2 hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors'
        }
      >
        <Smartphone className="w-4 h-4 text-[#E5A91A]" />
        <span>{isIOS ? 'Install on iPhone (Home Screen)' : 'Install App on Phone'}</span>
      </button>

      {showGuide && (
        <div
          className={`${
            isMobileFrame ? 'absolute' : 'fixed'
          } inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-4`}
          onClick={() => setShowGuide(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Install NotePad App"
        >
          <div
            className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#1C1C1E] border border-slate-200 dark:border-white/[0.1] p-5 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {isIOS ? 'Install on iPhone / iPad' : 'Install NotePad App'}
              </h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close"
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-full text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {isIOS ? (
              <ol className="space-y-2.5 text-sm text-slate-600 dark:text-zinc-300">
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-amber-500/20 text-[#E5A91A] text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                    1
                  </span>
                  <span>
                    Open this page in <strong>Safari</strong> and tap the{' '}
                    <Share className="inline w-3.5 h-3.5 mx-0.5" /> <strong>Share</strong> button.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-amber-500/20 text-[#E5A91A] text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                    2
                  </span>
                  <span>
                    Scroll down and tap <strong>Add to Home Screen</strong>.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-amber-500/20 text-[#E5A91A] text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                    3
                  </span>
                  <span>
                    Launch <strong>NotePad</strong> from your Home Screen and allow notifications for background alerts.
                  </span>
                </li>
              </ol>
            ) : (
              <ol className="space-y-2.5 text-sm text-slate-600 dark:text-zinc-300">
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-amber-500/20 text-[#E5A91A] text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                    1
                  </span>
                  <span>
                    Open the browser menu (<strong>⋮</strong> in Chrome) and tap{' '}
                    <strong>Install app</strong> or <strong>Add to Home screen</strong>.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-amber-500/20 text-[#E5A91A] text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                    2
                  </span>
                  <span>
                    Allow notifications to receive background <strong>NotePad</strong> reminders.
                  </span>
                </li>
              </ol>
            )}

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full min-h-[44px] rounded-xl bg-slate-100 dark:bg-zinc-800 text-sm font-semibold text-slate-900 dark:text-white"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </>
  );
}
