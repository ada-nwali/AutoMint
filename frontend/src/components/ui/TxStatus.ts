export function newTxId(action: string): string {
  return `${action}-${Date.now()}`;
}

export function trackStatus(
  _txId: string,
  _label: string,
  status: { stage: string; hash?: string; error?: string }
) {
  if (typeof window === 'undefined') return;
  if (status.stage === 'error' && status.error) console.error(status.error);
}
