import { calculatePendingPoints, pointsToAmt } from '../lib/accrualLogic';

describe('Accrual Logic Calculations', () => {
  describe('calculatePendingPoints', () => {
    it('returns 0 when elapsed time is 0 or negative', () => {
      expect(calculatePendingPoints(0, 100)).toBe(0);
      expect(calculatePendingPoints(-50, 100)).toBe(0);
    });

    it('returns 0 when rate is 0 or negative', () => {
      expect(calculatePendingPoints(3600, 0)).toBe(0);
      expect(calculatePendingPoints(3600, -10)).toBe(0);
    });

    it('calculates exact hourly points correctly', () => {
      expect(calculatePendingPoints(3600, 100)).toBe(100);
      expect(calculatePendingPoints(7200, 50)).toBe(100);
      expect(calculatePendingPoints(1800, 100)).toBe(50);
    });
  });

  describe('pointsToAmt', () => {
    it('returns 0 when points are insufficient', () => {
      expect(pointsToAmt(50, 100)).toBe(0);
      expect(pointsToAmt(0, 100)).toBe(0);
    });

    it('converts points to AMT tokens accurately', () => {
      expect(pointsToAmt(100, 100)).toBe(1);
      expect(pointsToAmt(250, 100)).toBe(2);
    });
  });
});
