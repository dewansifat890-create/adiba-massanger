import { Component, ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

interface ErrorBoundaryState {
  hasError: boolean;
}

class AppErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('App error boundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-[#f2f2f7] dark:bg-black text-slate-900 dark:text-white p-6 text-center">
          <h1 className="text-lg font-bold">NotePad</h1>
          <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1.5 max-w-xs">
            Something interrupted the view. Tap below to restore your notes.
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false })}
            className="mt-4 min-h-[44px] px-5 rounded-full bg-amber-500 text-black text-sm font-semibold"
          >
            Resume NotePad
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

if ('serviceWorker' in navigator) {
  if (import.meta.env.DEV) {
    // Unregister stale Vite dev-sw at root scope so mobile browsers never hit reload loops or white screens
    void navigator.serviceWorker
      .getRegistrations()
      .then((regs) => {
        for (const reg of regs) {
          if (!reg.scope.includes('firebase-cloud-messaging-push-scope')) {
            void reg.unregister();
          }
        }
      })
      .catch(() => {});
  } else {
    registerSW({ immediate: false });
  }
}

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);
