export function calculatePendingPoints(elapsedSeconds: number, rate: number): number {
  if (elapsedSeconds <= 0 || rate <= 0) {
    return 0;
  }
  return Math.floor((elapsedSeconds * rate) / 3600);
}

export function pointsToAmt(points: number, pointsPerAmt: number): number {
  if (points <= 0 || pointsPerAmt <= 0) {
    return 0;
  }
  return Math.floor(points / pointsPerAmt);
}
