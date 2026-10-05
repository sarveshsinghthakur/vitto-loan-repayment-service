import crypto from 'node:crypto';

export function paymentIdempotencyKey({ loanId, amountPaise, date, clientReference }) {
  if (clientReference) {
    return `ref:${clientReference}`;
  }
  const fingerprint = `${loanId}|${amountPaise}|${date}`;
  return `fp:${crypto.createHash('sha256').update(fingerprint).digest('hex')}`;
}

export function allocatedInterestPaid(instalment) {
  return Math.min(instalment.amountPaidPaise, instalment.interestPaise);
}

export function allocatedPrincipalPaid(instalment) {
  return Math.max(0, instalment.amountPaidPaise - instalment.interestPaise);
}

export function remainingOnInstalment(instalment) {
  return instalment.totalDuePaise - instalment.amountPaidPaise;
}

export function sortByDueDate(instalments) {
  return [...instalments].sort((a, b) => {
    if (a.dueDate === b.dueDate) return a.installmentNumber - b.installmentNumber;
    return a.dueDate < b.dueDate ? -1 : 1;
  });
}

export function totalRemainingObligation(instalments) {
  return instalments.reduce((acc, inst) => acc + remainingOnInstalment(inst), 0);
}

export function allocatePayment(instalments, amountPaise) {
  const ordered = sortByDueDate(instalments);
  let remaining = amountPaise;
  const allocations = [];

  for (const inst of ordered) {
    if (remaining <= 0) break;
    const outstanding = remainingOnInstalment(inst);
    if (outstanding <= 0) continue;
    const applied = Math.min(remaining, outstanding);
    const interestPart = Math.min(inst.interestPaise - allocatedInterestPaid(inst), applied);
    const principalPart = applied - interestPart;
    allocations.push({
      installmentNumber: inst.installmentNumber,
      dueDate: inst.dueDate,
      amountPaise: applied,
      interestPaise: interestPart,
      principalPaise: principalPart,
    });
    remaining -= applied;
  }

  return { allocations, unallocatedPaise: remaining };
}

export function computePosition({ principalPaise, instalments, today }) {
  const ordered = sortByDueDate(instalments);
  const principalRepaid = ordered.reduce((acc, inst) => acc + allocatedPrincipalPaid(inst), 0);
  const outstandingPrincipalPaise = Math.max(0, principalPaise - principalRepaid);

  const nextInstalment = ordered.find((inst) => remainingOnInstalment(inst) > 0);

  let overdueAmountPaise = 0;
  for (const inst of ordered) {
    if (inst.dueDate < today) {
      overdueAmountPaise += remainingOnInstalment(inst);
    }
  }

  let status = 'active';
  if (!nextInstalment) {
    status = 'paid';
  } else if (overdueAmountPaise > 0) {
    status = 'overdue';
  }

  return {
    outstandingPrincipalPaise,
    nextDueDate: nextInstalment ? nextInstalment.dueDate : null,
    nextDueAmountPaise: nextInstalment ? remainingOnInstalment(nextInstalment) : 0,
    overdueAmountPaise,
    status,
  };
}
