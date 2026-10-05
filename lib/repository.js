import { generateSchedule } from './schedule.js';
import {
  allocatePayment,
  computePosition,
  paymentIdempotencyKey,
  totalRemainingObligation,
  sortByDueDate,
  remainingOnInstalment,
} from './allocation.js';
import { AppError } from './errors.js';
import { toPaise } from './money.js';
import { todayISO } from './months.js';

const LOAN_COLUMNS = 'id, principal_paise, annual_rate_bps, tenure_months, disbursement_date, emi_paise, created_at';

function mapLoan(row) {
  return {
    id: row.id,
    principalPaise: Number(row.principal_paise),
    annualInterestRate: row.annual_rate_bps / 100,
    tenureMonths: row.tenure_months,
    disbursementDate: row.disbursement_date instanceof Date
      ? row.disbursement_date.toISOString().slice(0, 10)
      : String(row.disbursement_date).slice(0, 10),
    emiPaise: Number(row.emi_paise),
    createdAt: row.created_at,
  };
}

function mapInstalment(row) {
  return {
    id: row.id,
    installmentNumber: row.installment_number,
    dueDate: row.due_date instanceof Date
      ? row.due_date.toISOString().slice(0, 10)
      : String(row.due_date).slice(0, 10),
    principalPaise: Number(row.principal_paise),
    interestPaise: Number(row.interest_paise),
    totalDuePaise: Number(row.total_due_paise),
    amountPaidPaise: Number(row.amount_paid_paise),
  };
}

function toLoanDto(loan, instalments) {
  const today = todayISO();
  const position = computePosition({
    principalPaise: loan.principalPaise,
    instalments,
    today,
  });
  return {
    loan: {
      id: loan.id,
      principal: loan.principalPaise / 100,
      annualInterestRate: loan.annualInterestRate,
      tenureMonths: loan.tenureMonths,
      disbursementDate: loan.disbursementDate,
      emi: loan.emiPaise / 100,
      createdAt: loan.createdAt,
    },
    schedule: sortByDueDate(instalments).map((inst) => ({
      installmentNumber: inst.installmentNumber,
      dueDate: inst.dueDate,
      principal: inst.principalPaise / 100,
      interest: inst.interestPaise / 100,
      totalDue: inst.totalDuePaise / 100,
      amountPaid: inst.amountPaidPaise / 100,
      balance: remainingOnInstalment(inst) / 100,
    })),
    position: {
      outstandingPrincipal: position.outstandingPrincipalPaise / 100,
      nextDueDate: position.nextDueDate,
      nextDueAmount: position.nextDueAmountPaise / 100,
      overdueAmount: position.overdueAmountPaise / 100,
      status: position.status,
      asOf: today,
    },
  };
}

export async function createLoan(pool, input) {
  const principalPaise = toPaise(input.principal);
  if (principalPaise === null) {
    throw new AppError(400, 'invalid_input', 'principal must be a valid amount in rupees');
  }
  const rateBps = Math.round(input.annualInterestRate * 100);
  const { emiPaise, instalments } = generateSchedule({
    principalPaise,
    annualRatePercent: input.annualInterestRate,
    tenureMonths: input.tenureMonths,
    disbursementDate: input.disbursementDate,
  });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const loanResult = await client.query(
      `INSERT INTO loans (principal_paise, annual_rate_bps, tenure_months, disbursement_date, emi_paise)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${LOAN_COLUMNS}`,
      [principalPaise, rateBps, input.tenureMonths, input.disbursementDate, emiPaise]
    );
    const loan = mapLoan(loanResult.rows[0]);
    for (const inst of instalments) {
      await client.query(
        `INSERT INTO instalments (loan_id, installment_number, due_date, principal_paise, interest_paise, total_due_paise)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [loan.id, inst.installmentNumber, inst.dueDate, inst.principalPaise, inst.interestPaise, inst.totalDuePaise]
      );
    }
    await client.query('COMMIT');
    return loan;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function fetchLoanWithInstalments(pool, loanId) {
  const loanResult = await pool.query(`SELECT ${LOAN_COLUMNS} FROM loans WHERE id = $1`, [loanId]);
  if (loanResult.rowCount === 0) {
    return null;
  }
  const instalmentResult = await pool.query(
    `SELECT id, installment_number, due_date, principal_paise, interest_paise, total_due_paise, amount_paid_paise
     FROM instalments WHERE loan_id = $1 ORDER BY due_date, installment_number`,
    [loanId]
  );
  return {
    loan: mapLoan(loanResult.rows[0]),
    instalments: instalmentResult.rows.map(mapInstalment),
  };
}

export async function getLoan(pool, loanId) {
  const data = await fetchLoanWithInstalments(pool, loanId);
  if (!data) {
    throw new AppError(404, 'loan_not_found', `No loan exists with id ${loanId}`);
  }
  return toLoanDto(data.loan, data.instalments);
}

export async function listLoans(pool) {
  const result = await pool.query(
    `SELECT ${LOAN_COLUMNS} FROM loans ORDER BY created_at DESC, id`
  );
  return result.rows.map((row) => {
    const loan = mapLoan(row);
    return {
      id: loan.id,
      principal: loan.principalPaise / 100,
      annualInterestRate: loan.annualInterestRate,
      tenureMonths: loan.tenureMonths,
      disbursementDate: loan.disbursementDate,
      emi: loan.emiPaise / 100,
    };
  });
}

export async function recordPayment(pool, { loanId, amount, date, clientReference }) {
  const amountPaise = toPaise(amount);
  if (amountPaise === null || amountPaise <= 0) {
    throw new AppError(400, 'invalid_input', 'amount must be a positive number of rupees');
  }
  const idempotencyKey = paymentIdempotencyKey({ loanId, amountPaise, date, clientReference });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const loanResult = await client.query(`SELECT ${LOAN_COLUMNS} FROM loans WHERE id = $1 FOR UPDATE`, [loanId]);
    if (loanResult.rowCount === 0) {
      throw new AppError(404, 'loan_not_found', `No loan exists with id ${loanId}`);
    }

    const paymentResult = await client.query(
      `INSERT INTO payments (loan_id, amount_paise, payment_date, idempotency_key)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (loan_id, idempotency_key) DO NOTHING
       RETURNING id, amount_paise, payment_date, created_at`,
      [loanId, amountPaise, date, idempotencyKey]
    );
    if (paymentResult.rowCount === 0) {
      throw new AppError(
        409,
        'duplicate_payment',
        'An identical payment for this loan, amount and date has already been recorded. Provide a distinct clientReference to record it deliberately.'
      );
    }

    const instalmentResult = await client.query(
      `SELECT id, installment_number, due_date, principal_paise, interest_paise, total_due_paise, amount_paid_paise
       FROM instalments WHERE loan_id = $1 ORDER BY due_date, installment_number FOR UPDATE`,
      [loanId]
    );
    const instalments = instalmentResult.rows.map(mapInstalment);

    const remaining = totalRemainingObligation(instalments);
    if (amountPaise > remaining) {
      throw new AppError(
        400,
        'amount_exceeds_obligation',
        `amount exceeds the remaining scheduled obligation of ${(remaining / 100).toFixed(2)} rupees`
      );
    }

    const paymentRow = paymentResult.rows[0];
    const { allocations, unallocatedPaise } = allocatePayment(instalments, amountPaise);
    if (unallocatedPaise > 0) {
      throw new AppError(400, 'amount_exceeds_obligation', 'amount exceeds the remaining scheduled obligation');
    }

    for (const allocation of allocations) {
      const inst = instalments.find((i) => i.installmentNumber === allocation.installmentNumber);
      await client.query(
        `UPDATE instalments SET amount_paid_paise = amount_paid_paise + $1 WHERE id = $2`,
        [allocation.amountPaise, inst.id]
      );
      await client.query(
        `INSERT INTO payment_allocations (payment_id, installment_id, amount_paise, interest_paise, principal_paise)
         VALUES ($1, $2, $3, $4, $5)`,
        [paymentRow.id, inst.id, allocation.amountPaise, allocation.interestPaise, allocation.principalPaise]
      );
    }

    await client.query('COMMIT');

    const refreshed = await fetchLoanWithInstalments(pool, loanId);
    return {
      payment: {
        id: paymentRow.id,
        amount: amountPaise / 100,
        date,
        allocations: allocations.map((a) => ({
          installmentNumber: a.installmentNumber,
          amount: a.amountPaise / 100,
          interest: a.interestPaise / 100,
          principal: a.principalPaise / 100,
        })),
      },
      ...toLoanDto(refreshed.loan, refreshed.instalments),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
