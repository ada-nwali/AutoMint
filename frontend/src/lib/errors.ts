export function toastContractError(error: unknown, _context: string) {
  if (typeof window === 'undefined') return;
  console.error(error);
}
