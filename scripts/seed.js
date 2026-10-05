import { loadEnv } from '../lib/env.js';
import { getPool, closePool } from '../lib/db.js';
import { runMigrations } from '../lib/schema.js';
import { generateSchedule } from '../lib/schedule.js';
import { recordPayment } from '../lib/repository.js';
import { AppError } from '../lib/errors.js';
import { addMonths, todayISO, parseISODate } from '../lib/months.js';

loadEnv();

const pool = getPool();
await runMigrations(pool);

function addDays(isoDate, days) {
  const { year, month, day } = parseISODate(isoDate);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function seedLoan({ id, principal, annualInterestRate, tenureMonths, disbursementDate }) {
  const principalPaise = Math.round(principal * 100);
  const { emiPaise, instalments } = generateSchedule({
    principalPaise,
    annualRatePercent: annualInterestRate,
    tenureMonths,
    disbursementDate,
  });
  await pool.query(
    `INSERT INTO loans (id, principal_paise, annual_rate_bps, tenure_months, disbursement_date, emi_paise)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO NOTHING`,
    [id, principalPaise, Math.round(annualInterestRate * 100), tenureMonths, disbursementDate, emiPaise]
  );
  for (const inst of instalments) {
    await pool.query(
      `INSERT INTO instalments (loan_id, installment_number, due_date, principal_paise, interest_paise, total_due_paise)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (loan_id, installment_number) DO NOTHING`,
      [id, inst.installmentNumber, inst.dueDate, inst.principalPaise, inst.interestPaise, inst.totalDuePaise]
    );
  }
  return { id, disbursementDate, emiPaise, instalments };
}

async function safePay(loanId, amount, date, clientReference) {
  try {
    await recordPayment(pool, { loanId, amount, date, clientReference });
    return true;
  } catch (error) {
    if (error instanceof AppError && error.code === 'duplicate_payment') {
      return false;
    }
    throw error;
  }
}

const today = todayISO();

// Loan 1: overdue working-capital loan with late and partial payments.
const loan1 = await seedLoan({
  id: 'a1000000-0000-4000-8000-000000000001',
  principal: 500000,
  annualInterestRate: 14,
  tenureMonths: 18,
  disbursementDate: addMonths(today, -10),
});
for (let k = 1; k <= 6; k += 1) {
  const inst = loan1.instalments[k - 1];
  await safePay(
    loan1.id,
    inst.totalDuePaise / 100,
    inst.dueDate,
    `seed-loan1-inst${k}`
  );
}
// Instalment 7 paid 11 days late.
{
  const inst = loan1.instalments[6];
  await safePay(loan1.id, inst.totalDuePaise / 100, addDays(inst.dueDate, 11), 'seed-loan1-inst7-late');
}
// Instalment 8 underpaid: half of the EMI received.
{
  const inst = loan1.instalments[7];
  const half = Math.floor(inst.totalDuePaise / 2);
  await safePay(loan1.id, half / 100, inst.dueDate, 'seed-loan1-inst8-partial');
}

// Loan 2: fresh reference loan (₹2,00,000 at 18% over 24 months, EMI ≈ ₹9,986).
await seedLoan({
  id: 'a1000000-0000-4000-8000-000000000002',
  principal: 200000,
  annualInterestRate: 18,
  tenureMonths: 24,
  disbursementDate: `${today.slice(0, 8)}01`,
});

// Loan 3: small loan already fully repaid.
const loan3 = await seedLoan({
  id: 'a1000000-0000-4000-8000-000000000003',
  principal: 50000,
  annualInterestRate: 12,
  tenureMonths: 3,
  disbursementDate: addMonths(today, -4),
});
const totalRemaining = loan3.instalments.reduce((acc, inst) => acc + inst.totalDuePaise, 0);
await safePay(loan3.id, totalRemaining / 100, today, 'seed-loan3-full');

console.log('Seed complete.');
console.log('  Overdue loan : a1000000-0000-4000-8000-000000000001');
console.log('  Fresh loan   : a1000000-0000-4000-8000-000000000002');
console.log('  Paid loan    : a1000000-0000-4000-8000-000000000003');

await closePool();
