import { describe, expect, it } from 'vitest';
import { generateSchedule, computeEmiPaise } from '../../lib/schedule.js';
import { parseISODate } from '../../lib/months.js';

const principalPaise = 20000000;
const annualRate = 18;
const tenure = 24;
const disbursement = '2026-01-15';

describe('schedule generation', () => {
  it('matches the reference EMI of approximately Rs 9,986 for 2,00,000 at 18% over 24 months', () => {
    const { emiPaise } = generateSchedule({
      principalPaise,
      annualRatePercent: annualRate,
      tenureMonths: tenure,
      disbursementDate: disbursement,
    });
    expect(Math.abs(emiPaise / 100 - 9986)).toBeLessThanOrEqual(2);
  });

  it('produces principal components that sum exactly to the disbursed principal', () => {
    const { instalments } = generateSchedule({
      principalPaise,
      annualRatePercent: annualRate,
      tenureMonths: tenure,
      disbursementDate: disbursement,
    });
    expect(instalments).toHaveLength(tenure);
    const principalSum = instalments.reduce((acc, inst) => acc + inst.principalPaise, 0);
    expect(principalSum).toBe(principalPaise);
    const totalSum = instalments.reduce((acc, inst) => acc + inst.totalDuePaise, 0);
    const interestSum = instalments.reduce((acc, inst) => acc + inst.interestPaise, 0);
    expect(totalSum).toBe(principalPaise + interestSum);
  });

  it('places the rounding remainder on the final instalment and schedules due dates monthly', () => {
    const { emiPaise, instalments } = generateSchedule({
      principalPaise,
      annualRatePercent: annualRate,
      tenureMonths: tenure,
      disbursementDate: '2026-01-31',
    });
    const nonFinal = instalments.slice(0, -1);
    for (const inst of nonFinal) {
      expect(inst.totalDuePaise).toBe(emiPaise);
    }
    const last = instalments[instalments.length - 1];
    expect(last.totalDuePaise).not.toBe(emiPaise);

    expect(instalments[0].dueDate).toBe('2026-02-28');
    expect(instalments[1].dueDate).toBe('2026-03-31');
    for (let i = 1; i < instalments.length; i += 1) {
      const prev = parseISODate(instalments[i - 1].dueDate);
      const curr = parseISODate(instalments[i].dueDate);
      const monthGap = (curr.year * 12 + curr.month) - (prev.year * 12 + prev.month);
      expect(monthGap).toBe(1);
    }
  });

  it('handles a zero-percent loan without interest and a final instalment remainder', () => {
    const { emiPaise, instalments } = generateSchedule({
      principalPaise: 10000000,
      annualRatePercent: 0,
      tenureMonths: 10,
      disbursementDate: '2026-03-01',
    });
    expect(emiPaise).toBe(1000000);
    for (const inst of instalments) {
      expect(inst.interestPaise).toBe(0);
      expect(inst.totalDuePaise).toBe(inst.principalPaise);
    }
    const principalSum = instalments.reduce((acc, inst) => acc + inst.principalPaise, 0);
    expect(principalSum).toBe(10000000);
    expect(computeEmiPaise(10000000, 0, 10)).toBe(1000000);
  });
});
