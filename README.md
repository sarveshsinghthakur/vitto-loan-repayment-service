# Vitto Loan Repayment Service

A Next.js (JavaScript) application that generates loan repayment schedules, records payments
against them, and reports the current position of a loan for MSME lending.

## Deployed link

- **App:** https://vitto-loan-repayment.vercel.app (Vercel, production)
- **Test account:** `test@vitto.money` / `Vitto#Test1234` (also provided in the submission email)

### Seeded loans

| Loan ID | Terms | State |
|---|---|---|
| `a1000000-0000-4000-8000-000000000001` | ₹5,00,000 · 14% · 18 months | **Overdue** — instalments 1–6 paid, instalment 7 paid 11 days late, instalment 8 partially paid (underpayment); overdue amount ≈ ₹46,436 |
| `a1000000-0000-4000-8000-000000000002` | ₹2,00,000 · 18% · 24 months | **Active** — EMI ₹9,984.82 (reference case), first instalment not yet due |
| `a1000000-0000-4000-8000-000000000003` | ₹50,000 · 12% · 3 months | **Paid** — closed with a single final payment |

## Setup

Prerequisites: Node.js 20+, PostgreSQL 14+ (or a hosted instance).

```bash
npm install
cp .env.example .env        # then fill in DATABASE_URL and Firebase values
npm run db:migrate          # creates the schema
npm run db:seed             # optional: loads the three seeded loans
npm run dev                 # http://localhost:3000
```

## Database and host

- **Database:** PostgreSQL. The schema is created by `npm run db:migrate` (source: `lib/schema.js`) — never by hand. CI runs the same script before the tests.
- **Host:** Vercel (US East `iad1`) serving the Next.js app; **Neon** serverless Postgres (`aws-ap-southeast-1`) as the database. Any host that runs Next.js route handlers works (Vercel, Render or equivalent).
- Firebase credentials are never committed; all required variables are listed in `.env.example`.

## Tests

```bash
npm test
```

Single command, runs the whole suite (9 unit tests + 3 integration tests = 12):

- **Unit:** schedule generation (reference EMI, exact principal reconciliation, date handling, zero-rate loans) and payment allocation (underpayment, overpayment, interest/principal split, late-payment position, idempotency keys).
- **Integration:** real PostgreSQL (not mocks) exercised through the route handlers — one success path (create → get → record payment → verify), one failure path (invalid input, unknown loan, duplicate payment), and one confirming every endpoint rejects unauthenticated requests. Firebase token *verification* is stubbed in these tests because no real Firebase project exists in CI; the token-parsing/401 behaviour under test is the application's own code.

CI (`.github/workflows/ci.yml`) runs `npm run db:migrate`, `npm test` and `npm run build` on **every push** against a `postgres:16` service container, so results are checkable from the Actions tab with no local setup.

## Endpoint reference

All endpoints require `Authorization: Bearer <Firebase ID token>`. Errors always use the shape
`{ "error": { "code": "...", "message": "...", "details": [...] } }`. Monetary values in requests and responses are rupees (numbers with at most two decimals).

| Method | Path | Body | Success |
|---|---|---|---|
| `POST` | `/api/loans` | `{ principal, annualInterestRate, tenureMonths, disbursementDate }` | `201` `{ loanId }` |
| `GET` | `/api/loans` | – | `200` `{ loans: [...] }` (convenience listing for the UI) |
| `GET` | `/api/loans/:id` | – | `200` `{ loan, schedule, position }` — schedule rows carry `dueDate, principal, interest, totalDue, amountPaid, balance`; position carries `outstandingPrincipal, nextDueDate, nextDueAmount, overdueAmount, status, asOf` |
| `POST` | `/api/loans/:id/payments` | `{ amount, date, clientReference? }` | `201` `{ payment, schedule, position }` (updated schedule so the UI refreshes without a page reload) |

Error codes: `400 invalid_input / invalid_json / amount_exceeds_obligation`, `401 unauthenticated / invalid_token`, `404 loan_not_found`, `409 duplicate_payment`.

Validation: principal ₹50,000–₹10,00,000, tenure 3–36 months, rate 0–100%, positive two-decimal amounts, `YYYY-MM-DD` dates, valid UUIDs.

## Money type

- **Storage:** `BIGINT` paise — never a floating-point type. Interest rate stored as integer basis points (`annual_rate_bps`). The public API speaks rupees; conversion happens at the boundary (`lib/money.js`).
- **Rounding:** EMI is rounded to the nearest paise once at schedule creation. Each month `interest = round(outstanding × r)` and `principal = EMI − interest`; the final instalment takes the remaining principal so the principal components sum **exactly** to the disbursed amount (the conventional remainder goes to the last instalment).

## Allocation and rounding decisions

1. **Allocation order:** payments settle the **earliest-due unpaid instalment first**; within an instalment the **interest component is settled before the principal component** (documented order, as permitted by the brief).
2. **Overpayment** (e.g., twice the instalment): because allocation walks the schedule in due order, the surplus **settles the following instalment**. A payment may not exceed the total remaining scheduled obligation — excess is rejected with `400 amount_exceeds_obligation` (prepayment closure is out of scope per the brief).
3. **Underpayment:** the received amount is applied to the earliest unpaid instalment; the unpaid remainder stays on that instalment and, once past its due date, appears in the overdue amount.
4. **Late payment:** recorded with the payment date that actually arrived. The position is recomputed as of today: `overdueAmount` = sum of remaining amounts on instalments whose due date is before today, so a late payment clears exactly the overdue it settles. No penalty interest (out of scope).
5. **Duplicate submission:** each payment carries a unique idempotency key per loan — by default `sha256(loanId|amount|date)`; pass a distinct `clientReference` to record a deliberate identical transaction. A repeat is rejected with `409 duplicate_payment` and is **never applied twice** (enforced by a unique constraint in the schema, not only in code).
6. **Invalid input** (negative amounts, zero-month tenure, non-numeric values) returns `400` with per-field details; an unknown loan id returns `404`.

## Repository notes

- JavaScript only — no TypeScript anywhere.
- Commit history is discrete (scaffold → domain logic → schema/data layer → API → UI → tests → CI → docs).
- Firebase credentials are provided out of band (`.env.example` documents the variable names; the test account is sent by email).
