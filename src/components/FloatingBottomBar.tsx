import { useState } from 'react';
import { Mic, Search, SquarePen, X } from 'lucide-react';
import { AccentColor } from '../types/notes';
import { getAccentClasses } from '../utils/noteHelpers';

interface FloatingBottomBarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onCompose: () => void;
  onVoiceError: (message: string) => void;
  accent: AccentColor;
  isMobileFrame: boolean;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export function FloatingBottomBar({
  searchQuery,
  onSearchChange,
  onCompose,
  onVoiceError,
  accent,
  isMobileFrame,
}: FloatingBottomBarProps) {
  const [listening, setListening] = useState(false);
  const accentStyle = getAccentClasses(accent);

  const handleVoiceSearch = () => {
    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRec) {
      onVoiceError('Voice search is not supported in this browser');
      return;
    }

    try {
      const recognition = new SpeechRec();
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      setListening(true);

      recognition.onresult = (event) => {
        const transcript = event.results?.[0]?.[0]?.transcript ?? '';
        if (transcript) {
          onSearchChange(transcript);
        }
      };
      recognition.onerror = () => {
        setListening(false);
        onVoiceError('Could not capture voice input');
      };
      recognition.onend = () => {
        setListening(false);
      };
      recognition.start();
    } catch {
      setListening(false);
      onVoiceError('Unable to start voice search');
    }
  };

  return (
    <div
      className={`${
        isMobileFrame ? 'sticky bottom-0' : 'fixed bottom-0 left-0 right-0'
      } z-30 pointer-events-none px-4 pb-4 pt-2 bg-gradient-to-t from-[#f2f2f7] via-[#f2f2f7]/90 to-transparent dark:from-black dark:via-black/90`}
    >
      <div
        className={`mx-auto flex items-center gap-2.5 pointer-events-auto ${
          isMobileFrame ? 'w-full' : 'max-w-3xl'
        }`}
      >
        {/* Floating Pill Search Bar */}
        <div className="flex-1 h-12 rounded-full bg-white/95 dark:bg-[#1C1C1E]/95 backdrop-blur-xl border border-slate-200/90 dark:border-white/[0.1] shadow-lg shadow-black/5 dark:shadow-black/50 flex items-center px-3.5 gap-2">
          <Search className="w-[18px] h-[18px] text-slate-400 dark:text-zinc-400 shrink-0" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search"
            aria-label="Search notes"
            className="flex-1 min-w-0 bg-transparent text-[15px] text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-500 focus:outline-none"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="Clear search"
              className="min-h-[36px] min-w-[36px] -mr-1.5 flex items-center justify-center rounded-full text-slate-400 dark:text-zinc-400 hover:text-slate-700 dark:hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleVoiceSearch}
              aria-label="Voice search"
              className={`min-h-[36px] min-w-[36px] -mr-1.5 flex items-center justify-center rounded-full transition-colors ${
                listening
                  ? accentStyle.text
                  : 'text-slate-500 dark:text-zinc-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Mic className="w-[18px] h-[18px]" />
            </button>
          )}
        </div>

        {/* Circular Compose Button */}
        <button
          type="button"
          onClick={onCompose}
          aria-label="New note"
          className={`w-12 h-12 rounded-full bg-white/95 dark:bg-[#1C1C1E]/95 backdrop-blur-xl border border-slate-200/90 dark:border-white/[0.1] shadow-lg shadow-black/5 dark:shadow-black/50 flex items-center justify-center shrink-0 transition-transform duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 ${accentStyle.ring} text-slate-800 dark:text-white`}
        >
          <SquarePen className="w-[20px] h-[20px]" strokeWidth={1.9} />
        </button>
      </div>
    </div>
  );
}
