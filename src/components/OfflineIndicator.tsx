import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-20 md:bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl glass-popover hf-toast-enter border-accent-strong/40 px-3.5 py-2 text-xs font-medium text-accent-soft"
    >
      <WifiOff className="w-3.5 h-3.5 text-accent-strong shrink-0" />
      <span>Offline Mode — Viewing cached content</span>
    </div>
  );
};
