export const schemaSql = `
CREATE TABLE IF NOT EXISTS loans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_paise BIGINT NOT NULL CHECK (principal_paise > 0),
  annual_rate_bps INTEGER NOT NULL CHECK (annual_rate_bps >= 0),
  tenure_months INTEGER NOT NULL CHECK (tenure_months >= 1),
  disbursement_date DATE NOT NULL,
  emi_paise BIGINT NOT NULL CHECK (emi_paise > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS instalments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  installment_number INTEGER NOT NULL CHECK (installment_number >= 1),
  due_date DATE NOT NULL,
  principal_paise BIGINT NOT NULL CHECK (principal_paise >= 0),
  interest_paise BIGINT NOT NULL CHECK (interest_paise >= 0),
  total_due_paise BIGINT NOT NULL CHECK (total_due_paise >= 0),
  amount_paid_paise BIGINT NOT NULL DEFAULT 0 CHECK (amount_paid_paise >= 0),
  UNIQUE (loan_id, installment_number)
);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  payment_date DATE NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (loan_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  installment_id UUID NOT NULL REFERENCES instalments(id) ON DELETE CASCADE,
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  interest_paise BIGINT NOT NULL CHECK (interest_paise >= 0),
  principal_paise BIGINT NOT NULL CHECK (principal_paise >= 0),
  CHECK (amount_paise = interest_paise + principal_paise)
);

CREATE INDEX IF NOT EXISTS idx_instalments_loan_due ON instalments (loan_id, due_date);
CREATE INDEX IF NOT EXISTS idx_payments_loan ON payments (loan_id);
CREATE INDEX IF NOT EXISTS idx_allocations_payment ON payment_allocations (payment_id);
`;

export async function runMigrations(pool) {
  await pool.query(schemaSql);
}
