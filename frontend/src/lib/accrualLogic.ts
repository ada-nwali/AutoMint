// `leftover` is the sub-hour remainder carried from the previous claim (#1314).
export function calculatePendingPoints(
  elapsedSeconds: number,
  rate: number,
  leftover = 0,
): number {
  if (elapsedSeconds <= 0 || rate <= 0) {
    return 0;
  }
  return Math.floor((elapsedSeconds * rate + leftover) / 3600);
}

export function pointsToAmt(points: number, pointsPerAmt: number): number {
  if (points <= 0 || pointsPerAmt <= 0) {
    return 0;
  }
  return Math.floor(points / pointsPerAmt);
}
