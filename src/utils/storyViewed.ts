import { Timestamp } from 'firebase/firestore';

const STORAGE_KEY_PREFIX = 'hostel_friend_viewed_stories_v1_';
const MAX_STORED_IDS = 300;

export function loadViewedStoryIds(uid?: string | null): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(`${STORAGE_KEY_PREFIX}${uid || 'guest'}`);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === 'string'));
  } catch {
    return new Set();
  }
}

export function saveViewedStoryIds(
  ids: Set<string>,
  uid?: string | null,
  activeIds?: Set<string>
): void {
  if (typeof window === 'undefined') return;
  try {
    let list = Array.from(ids);
    if (activeIds && activeIds.size > 0) {
      list = list.filter((id) => activeIds.has(id));
    }
    if (list.length > MAX_STORED_IDS) {
      list = list.slice(list.length - MAX_STORED_IDS);
    }
    window.localStorage.setItem(`${STORAGE_KEY_PREFIX}${uid || 'guest'}`, JSON.stringify(list));
  } catch {
    // Ignore storage quota or private mode failures
  }
}

export function formatStoryExpiryRemaining(
  expiresAt: Timestamp | null,
  nowMs: number = Date.now()
): string | null {
  if (!expiresAt) return null;
  const diffMs = expiresAt.toMillis() - nowMs;
  if (diffMs <= 0) return 'Expired';
  const totalMinutes = Math.floor(diffMs / 60_000);
  if (totalMinutes < 1) return '<1m left';
  if (totalMinutes < 60) return `${totalMinutes}m left`;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}h left`;
}
