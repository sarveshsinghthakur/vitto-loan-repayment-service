import { addMonths } from './months.js';

export function computeEmiPaise(principalPaise, annualRatePercent, tenureMonths) {
  const r = annualRatePercent / 12 / 100;
  if (r === 0) {
    return Math.round(principalPaise / tenureMonths);
  }
  const growth = Math.pow(1 + r, tenureMonths);
  return Math.round((principalPaise * r * growth) / (growth - 1));
}

export function generateSchedule({ principalPaise, annualRatePercent, tenureMonths, disbursementDate }) {
  if (!Number.isInteger(principalPaise) || principalPaise <= 0) {
    throw new Error('principalPaise must be a positive integer');
  }
  if (!Number.isInteger(tenureMonths) || tenureMonths < 1) {
    throw new Error('tenureMonths must be a positive integer');
  }
  const r = annualRatePercent / 12 / 100;
  const emiPaise = computeEmiPaise(principalPaise, annualRatePercent, tenureMonths);

  const instalments = [];
  let outstanding = principalPaise;

  for (let i = 1; i <= tenureMonths; i += 1) {
    const dueDate = addMonths(disbursementDate, i);
    const interest = Math.round(outstanding * r);
    let principalComponent;
    if (i === tenureMonths) {
      principalComponent = outstanding;
    } else {
      principalComponent = emiPaise - interest;
      if (principalComponent < 0) principalComponent = 0;
      if (principalComponent > outstanding) principalComponent = outstanding;
    }
    const totalDue = principalComponent + interest;
    outstanding -= principalComponent;
    instalments.push({
      installmentNumber: i,
      dueDate,
      principalPaise: principalComponent,
      interestPaise: interest,
      totalDuePaise: totalDue,
      amountPaidPaise: 0,
    });
  }

  return { emiPaise, instalments };
}
