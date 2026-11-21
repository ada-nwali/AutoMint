export function pollWhenVisible(interval = 30_000): number | false {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return false;
  }
  return interval;
}
