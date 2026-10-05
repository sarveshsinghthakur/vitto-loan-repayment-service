import { parseISODate } from './months.js';

const MIN_PRINCIPAL_RUPEES = 50000;
const MAX_PRINCIPAL_RUPEES = 1000000;
const MIN_TENURE_MONTHS = 3;
const MAX_TENURE_MONTHS = 36;
const MAX_ANNUAL_RATE_PERCENT = 100;

function isMoney(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  const paise = value * 100;
  return Math.abs(paise - Math.round(paise)) <= 1e-6;
}

export function validateCreateLoan(body) {
  const details = [];
  const { principal, annualInterestRate, tenureMonths, disbursementDate } = body || {};

  let principalOk = isMoney(principal) && principal > 0;
  if (principalOk && (principal < MIN_PRINCIPAL_RUPEES || principal > MAX_PRINCIPAL_RUPEES)) {
    principalOk = false;
    details.push(`principal must be between ${MIN_PRINCIPAL_RUPEES} and ${MAX_PRINCIPAL_RUPEES} rupees`);
  }
  if (!principalOk && !details.some((d) => d.startsWith('principal'))) {
    details.push('principal must be a positive amount in rupees');
  }

  const rateOk =
    typeof annualInterestRate === 'number' &&
    Number.isFinite(annualInterestRate) &&
    annualInterestRate >= 0 &&
    annualInterestRate <= MAX_ANNUAL_RATE_PERCENT;
  if (!rateOk) {
    details.push(`annualInterestRate must be a number between 0 and ${MAX_ANNUAL_RATE_PERCENT}`);
  }

  const tenureOk =
    Number.isInteger(tenureMonths) &&
    tenureMonths >= MIN_TENURE_MONTHS &&
    tenureMonths <= MAX_TENURE_MONTHS;
  if (!tenureOk) {
    details.push(`tenureMonths must be an integer between ${MIN_TENURE_MONTHS} and ${MAX_TENURE_MONTHS}`);
  }

  const dateOk = parseISODate(disbursementDate) !== null;
  if (!dateOk) {
    details.push('disbursementDate must be a valid date in YYYY-MM-DD format');
  }

  return details.length === 0
    ? {
        ok: true,
        value: {
          principal,
          annualInterestRate: Math.round(annualInterestRate * 100) / 100,
          tenureMonths,
          disbursementDate,
        },
      }
    : { ok: false, details };
}

export function validatePayment(body) {
  const details = [];
  const { amount, date, clientReference } = body || {};

  const amountOk = isMoney(amount) && amount > 0;
  if (!amountOk) {
    details.push('amount must be a positive number of rupees');
  }

  const dateOk = parseISODate(date) !== null;
  if (!dateOk) {
    details.push('date must be a valid date in YYYY-MM-DD format');
  }

  let referenceOk = true;
  if (clientReference !== undefined) {
    referenceOk =
      typeof clientReference === 'string' && clientReference.length > 0 && clientReference.length <= 100;
    if (!referenceOk) {
      details.push('clientReference must be a string of 1 to 100 characters');
    }
  }

  if (details.length > 0 || !referenceOk) {
    return { ok: false, details };
  }
  return { ok: true, value: { amount, date, clientReference } };
}

export function isValidUuid(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}
