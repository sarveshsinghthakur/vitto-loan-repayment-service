import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(() => ({ name: 'test-app' })),
  getApps: vi.fn(() => []),
  cert: vi.fn((value) => value),
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => ({
    verifyIdToken: async (token) => {
      if (token === 'valid-test-token') {
        return { uid: 'test-user' };
      }
      throw new Error('invalid token');
    },
  })),
}));

import { loadEnv } from '../../lib/env.js';
import { getPool, closePool } from '../../lib/db.js';
import { runMigrations } from '../../lib/schema.js';
import { POST as createLoan, GET as listLoans } from '../../app/api/loans/route.js';
import { GET as getLoan } from '../../app/api/loans/[id]/route.js';
import { POST as postPayment } from '../../app/api/loans/[id]/payments/route.js';

loadEnv();

const AUTH = { Authorization: 'Bearer valid-test-token' };
const NO_AUTH = {};

let pool;

function jsonRequest(url, { method = 'GET', body, headers = AUTH } = {}) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function createTestLoan(overrides = {}) {
  const response = await createLoan(
    jsonRequest('http://test/api/loans', {
      method: 'POST',
      body: {
        principal: 200000,
        annualInterestRate: 18,
        tenureMonths: 24,
        disbursementDate: '2026-01-15',
        ...overrides,
      },
    })
  );
  const data = await response.json();
  return { response, data };
}

beforeAll(async () => {
  if (!process.env.DATABASE_URL && !process.env.TEST_DATABASE_URL) {
    throw new Error(
      'Integration tests need a real database. Set DATABASE_URL (or TEST_DATABASE_URL) to a PostgreSQL connection string.'
    );
  }
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  }
  pool = getPool();
  await runMigrations(pool);
  await pool.query('DELETE FROM payments');
  await pool.query('DELETE FROM loans');
});

afterAll(async () => {
  await closePool();
});

beforeEach(async () => {
  await pool.query('DELETE FROM payments');
  await pool.query('DELETE FROM loans');
});

describe('POST /api/loans then GET /api/loans/[id] then POST payments', () => {
  it('creates a loan, returns the schedule and position, and records a payment end to end', async () => {
    const { response: createResponse, data: created } = await createTestLoan();
    expect(createResponse.status).toBe(201);
    expect(created.loanId).toMatch(/^[0-9a-f-]{36}$/);

    const getResponse = await getLoan(
      jsonRequest(`http://test/api/loans/${created.loanId}`),
      { params: { id: created.loanId } }
    );
    expect(getResponse.status).toBe(200);
    const loanView = await getResponse.json();
    expect(loanView.schedule).toHaveLength(24);
    expect(Math.abs(loanView.loan.emi - 9986)).toBeLessThanOrEqual(2);
    expect(loanView.position.outstandingPrincipal).toBe(200000);
    const expectedOverdue = loanView.schedule
      .filter((inst) => inst.dueDate < loanView.position.asOf)
      .reduce((acc, inst) => acc + inst.balance, 0);
    expect(loanView.position.overdueAmount).toBeCloseTo(expectedOverdue, 2);
    expect(loanView.schedule[0].amountPaid).toBe(0);

    const payResponse = await postPayment(
      jsonRequest(`http://test/api/loans/${created.loanId}/payments`, {
        method: 'POST',
        body: { amount: 5000, date: '2026-02-20' },
      }),
      { params: { id: created.loanId } }
    );
    expect(payResponse.status).toBe(201);
    const payView = await payResponse.json();
    expect(payView.payment.amount).toBe(5000);
    expect(payView.payment.allocations[0].installmentNumber).toBe(1);
    expect(payView.schedule[0].amountPaid).toBe(5000);

    const refreshed = await getLoan(
      jsonRequest(`http://test/api/loans/${created.loanId}`),
      { params: { id: created.loanId } }
    );
    const refreshedView = await refreshed.json();
    expect(refreshedView.schedule[0].amountPaid).toBe(5000);

    const listResponse = await listLoans(jsonRequest('http://test/api/loans'));
    expect(listResponse.status).toBe(200);
    const list = await listResponse.json();
    expect(list.loans.some((loan) => loan.id === created.loanId)).toBe(true);
  });

  it('rejects invalid input, unknown loans and duplicate payments with consistent errors', async () => {
    const badLoan = await createTestLoan({ tenureMonths: 0 });
    expect(badLoan.response.status).toBe(400);
    expect(badLoan.data.error.code).toBe('invalid_input');
    expect(Array.isArray(badLoan.data.error.details)).toBe(true);

    const { data: created } = await createTestLoan();
    const unknownId = '00000000-0000-4000-8000-000000000099';
    const unknownResponse = await postPayment(
      jsonRequest(`http://test/api/loans/${unknownId}/payments`, {
        method: 'POST',
        body: { amount: 1000, date: '2026-02-20' },
      }),
      { params: { id: unknownId } }
    );
    expect(unknownResponse.status).toBe(404);
    expect((await unknownResponse.json()).error.code).toBe('loan_not_found');

    const paymentBody = { amount: -500, date: '2026-02-20' };
    const negative = await postPayment(
      jsonRequest(`http://test/api/loans/${created.loanId}/payments`, {
        method: 'POST',
        body: paymentBody,
      }),
      { params: { id: created.loanId } }
    );
    expect(negative.status).toBe(400);
    expect((await negative.json()).error.code).toBe('invalid_input');

    const first = await postPayment(
      jsonRequest(`http://test/api/loans/${created.loanId}/payments`, {
        method: 'POST',
        body: { amount: 5000, date: '2026-02-20' },
      }),
      { params: { id: created.loanId } }
    );
    expect(first.status).toBe(201);
    const duplicate = await postPayment(
      jsonRequest(`http://test/api/loans/${created.loanId}/payments`, {
        method: 'POST',
        body: { amount: 5000, date: '2026-02-20' },
      }),
      { params: { id: created.loanId } }
    );
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error.code).toBe('duplicate_payment');

    const view = await (
      await getLoan(jsonRequest(`http://test/api/loans/${created.loanId}`), {
        params: { id: created.loanId },
      })
    ).json();
    expect(view.schedule[0].amountPaid).toBe(5000);
  });

  it('rejects unauthenticated requests on all three required endpoints', async () => {
    const createResponse = await createLoan(
      jsonRequest('http://test/api/loans', {
        method: 'POST',
        headers: NO_AUTH,
        body: { principal: 200000, annualInterestRate: 18, tenureMonths: 24, disbursementDate: '2026-01-15' },
      })
    );
    expect(createResponse.status).toBe(401);
    expect((await createResponse.json()).error.code).toBe('unauthenticated');

    const listResponse = await listLoans(jsonRequest('http://test/api/loans', { headers: NO_AUTH }));
    expect(listResponse.status).toBe(401);

    const loanId = '00000000-0000-4000-8000-000000000099';
    const getResponse = await getLoan(
      jsonRequest(`http://test/api/loans/${loanId}`, { headers: NO_AUTH }),
      { params: { id: loanId } }
    );
    expect(getResponse.status).toBe(401);

    const paymentResponse = await postPayment(
      jsonRequest(`http://test/api/loans/${loanId}/payments`, {
        method: 'POST',
        headers: NO_AUTH,
        body: { amount: 5000, date: '2026-02-20' },
      }),
      { params: { id: loanId } }
    );
    expect(paymentResponse.status).toBe(401);

    const badToken = await listLoans(
      jsonRequest('http://test/api/loans', { headers: { Authorization: 'Bearer expired-or-invalid' } })
    );
    expect(badToken.status).toBe(401);
    expect((await badToken.json()).error.code).toBe('invalid_token');
  });
});
