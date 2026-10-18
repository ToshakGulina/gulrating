const CURRENCY_ALIASES = new Map([
  ['RUR', 'RUB'],
  ['₽', 'RUB'],
  ['РУБ', 'RUB'],
  ['РУБЛЬ', 'RUB'],
  ['РУБЛИ', 'RUB'],
  ['$', 'USD'],
  ['€', 'EUR'],
  ['£', 'GBP'],
  ['¥', 'JPY'],
  ['ЮАНЬ', 'CNY'],
]);

export function normalizeCurrencyCode(currency) {
  const raw = typeof currency === 'string'
    ? currency
    : currency?.code || currency?.iso_code || currency?.isoCode || currency?.name || currency?.symbol || '';
  const value = String(raw).trim().toUpperCase();
  if (!value) return null;
  if (CURRENCY_ALIASES.has(value)) return CURRENCY_ALIASES.get(value);
  if (value.includes('РУБ') || value.includes('₽')) return 'RUB';
  if (/^[A-Z]{3}$/.test(value)) return value;
  return null;
}

export function moneyValue(entry) {
  const amount = Number(entry && typeof entry === 'object' ? entry.value : entry);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return {
    amount,
    currency: entry && typeof entry === 'object' ? normalizeCurrencyCode(entry.currency) : null,
  };
}

export function formatCompactMoney(amount, currency) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return '';
  const options = { notation: 'compact', maximumFractionDigits: 1 };
  const code = normalizeCurrencyCode(currency);
  if (code) {
    try {
      return new Intl.NumberFormat('ru-RU', {
        ...options,
        style: 'currency',
        currency: code,
      }).format(value);
    } catch (error) {
      // Unknown/unsupported currency codes are shown explicitly below.
    }
  }
  const compact = new Intl.NumberFormat('ru-RU', options).format(value);
  return `${compact} (валюта не указана)`;
}
