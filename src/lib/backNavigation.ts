import { useEffect, useRef } from 'react';

type BackHandler = () => boolean | void;

interface BackEntry {
  id: number;
  handler: BackHandler;
}

const backStack: BackEntry[] = [];
let nextEntryId = 1;

/**
 * Pushes a back-button handler onto the LIFO modal/drawer stack.
 * Returns a cleanup callback that removes this specific entry.
 */
export function registerBackHandler(handler: BackHandler): () => void {
  const id = nextEntryId++;
  backStack.push({ id, handler });
  return () => {
    const idx = backStack.findIndex((entry) => entry.id === id);
    if (idx !== -1) {
      backStack.splice(idx, 1);
    }
  };
}

/**
 * Consumes the topmost registered modal/drawer handler when Android hardware back is pressed.
 * Returns true if a UI layer handled the back event.
 */
export function consumeTopBackHandler(): boolean {
  for (let i = backStack.length - 1; i >= 0; i -= 1) {
    const entry = backStack[i];
    try {
      const result = entry.handler();
      if (result !== false) {
        return true;
      }
    } catch {
      return true;
    }
  }
  return false;
}

/**
 * Registers an open modal/drawer/overlay on the Android hardware back-button stack.
 * While `active && enabled` is true, pressing hardware back invokes `onClose`.
 */
export function useModalBackHandler(
  active: boolean,
  onClose: () => void,
  enabled = true
): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active || !enabled) return;
    return registerBackHandler(() => {
      onCloseRef.current();
      return true;
    });
  }, [active, enabled]);
}
