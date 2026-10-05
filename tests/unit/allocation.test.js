import { describe, expect, it } from 'vitest';
import { generateSchedule } from '../../lib/schedule.js';
import {
  allocatePayment,
  computePosition,
  paymentIdempotencyKey,
} from '../../lib/allocation.js';

function buildSchedule() {
  const { emiPaise, instalments } = generateSchedule({
    principalPaise: 20000000,
    annualRatePercent: 18,
    tenureMonths: 24,
    disbursementDate: '2026-01-15',
  });
  return { emiPaise, instalments };
}

function applyPayment(instalments, amountPaise) {
  const { allocations, unallocatedPaise } = allocatePayment(instalments, amountPaise);
  for (const allocation of allocations) {
    const inst = instalments.find((i) => i.installmentNumber === allocation.installmentNumber);
    inst.amountPaidPaise += allocation.amountPaise;
  }
  return { allocations, unallocatedPaise };
}

describe('payment allocation', () => {
  it('applies an underpayment to the earliest unpaid instalment', () => {
    const { instalments } = buildSchedule();
    const first = instalments[0];
    const { allocations, unallocatedPaise } = applyPayment(instalments, 500000);
    expect(unallocatedPaise).toBe(0);
    expect(allocations).toHaveLength(1);
    expect(allocations[0].installmentNumber).toBe(1);
    expect(first.amountPaidPaise).toBe(500000);
    const remaining = first.totalDuePaise - first.amountPaidPaise;
    expect(remaining).toBeGreaterThan(0);

    const position = computePosition({ principalPaise: 20000000, instalments, today: '2026-03-01' });
    expect(position.status).toBe('overdue');
    expect(position.overdueAmountPaise).toBe(remaining);
    expect(position.outstandingPrincipalPaise).toBe(
      20000000 - Math.max(0, first.amountPaidPaise - first.interestPaise)
    );
  });

  it('settles the following instalment when twice the instalment is paid', () => {
    const { emiPaise, instalments } = buildSchedule();
    const amount = instalments[0].totalDuePaise * 2;
    applyPayment(instalments, amount);
    expect(instalments[0].amountPaidPaise).toBe(instalments[0].totalDuePaise);
    expect(instalments[1].amountPaidPaise).toBe(emiPaise);
    expect(instalments[2].amountPaidPaise).toBe(0);
  });

  it('allocates interest before principal inside each instalment', () => {
    const { instalments } = buildSchedule();
    const { allocations } = applyPayment(instalments, 500000);
    const first = instalments[0];
    expect(allocations[0].interestPaise).toBe(first.interestPaise);
    expect(allocations[0].principalPaise).toBe(500000 - first.interestPaise);
    expect(allocations[0].interestPaise + allocations[0].principalPaise).toBe(500000);
  });

  it('clears the overdue amount once a late payment settles the overdue instalment', () => {
    const { instalments } = buildSchedule();
    const firstDue = instalments[0].dueDate;
    const lateDate = '2026-02-26';
    expect(lateDate > firstDue).toBe(true);

    applyPayment(instalments, instalments[0].totalDuePaise);
    const position = computePosition({ principalPaise: 20000000, instalments, today: lateDate });
    expect(position.overdueAmountPaise).toBe(0);
    expect(position.nextDueDate).toBe(instalments[1].dueDate);

    const unpaid = buildSchedule().instalments;
    const stillOverdue = computePosition({ principalPaise: 20000000, instalments: unpaid, today: lateDate });
    expect(stillOverdue.overdueAmountPaise).toBe(unpaid[0].totalDuePaise);
    expect(stillOverdue.status).toBe('overdue');
  });

  it('rejects amounts beyond the remaining schedule and deduplicates identical submissions', () => {
    const { instalments } = buildSchedule();
    const totalObligation = instalments.reduce((acc, inst) => acc + inst.totalDuePaise, 0);
    const { unallocatedPaise } = allocatePayment(instalments, totalObligation + 100);
    expect(unallocatedPaise).toBeGreaterThan(0);

    const loanId = 'a1000000-0000-4000-8000-000000000001';
    const base = { loanId, amountPaise: 500000, date: '2026-02-15' };
    const key1 = paymentIdempotencyKey(base);
    const key2 = paymentIdempotencyKey({ ...base });
    expect(key1).toBe(key2);
    expect(paymentIdempotencyKey({ ...base, amountPaise: 500001 })).not.toBe(key1);
    expect(paymentIdempotencyKey({ ...base, date: '2026-02-16' })).not.toBe(key1);
    expect(
      paymentIdempotencyKey({ ...base, clientReference: 'txn-123' })
    ).toBe('ref:txn-123');
  });
});
