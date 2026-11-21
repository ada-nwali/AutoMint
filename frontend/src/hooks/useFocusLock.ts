'use client';
import { useEffect, type RefObject } from 'react';

export function useFocusLock(
  _ref: RefObject<HTMLElement>,
  onEscape: () => void
) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onEscape();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onEscape]);
}
