export function toPaise(rupees) {
  if (typeof rupees !== 'number' || !Number.isFinite(rupees)) {
    return null;
  }
  const paise = rupees * 100;
  if (Math.abs(paise - Math.round(paise)) > 1e-6) {
    return null;
  }
  return Math.round(paise);
}

export function toRupees(paise) {
  return paise / 100;
}

export function formatINR(paise) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(paise / 100);
}

export function sum(items, key) {
  return items.reduce((acc, item) => acc + item[key], 0);
}
