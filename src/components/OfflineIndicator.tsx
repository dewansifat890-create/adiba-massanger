import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/usePWAInstall';

export function OfflineIndicator({ isMobileFrame = false }: { isMobileFrame?: boolean }) {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      className={`${
        isMobileFrame ? 'sticky top-2 mx-3' : 'fixed bottom-4 left-4'
      } z-50 inline-flex items-center gap-2 rounded-full bg-amber-500 px-3.5 py-1.5 text-xs font-semibold text-black shadow-lg`}
    >
      <WifiOff className="w-3.5 h-3.5" />
      <span>Offline Mode — Notes saved locally</span>
    </div>
  );
}
