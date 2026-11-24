import { useEffect, useState } from 'react';
import { getInitials } from '../utils/formatters';

interface AvatarProps {
  src?: string;
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: 'w-7 h-7 text-[11px]',
  sm: 'w-9 h-9 text-xs',
  md: 'w-11 h-11 text-sm',
  lg: 'w-16 h-16 text-lg',
  xl: 'w-24 h-24 text-2xl',
};

export function Avatar({ src, name, size = 'md', className = '' }: AvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [src]);

  if (src && !imgFailed) {
    return (
      <img
        src={src}
        alt={name}
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
        className={`${SIZE_CLASSES[size]} rounded-full object-cover border border-hairline bg-surface-2 shrink-0 ${className}`}
      />
    );
  }

  return (
    <div
      aria-label={name}
      className={`${SIZE_CLASSES[size]} rounded-full flex items-center justify-center font-display font-semibold tracking-tight bg-gradient-to-br from-surface-hover to-surface-2 text-accent-strong border border-accent-strong/25 shrink-0 ${className}`}
    >
      {getInitials(name)}
    </div>
  );
}
