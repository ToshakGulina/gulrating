#!/usr/bin/env node
import assert from 'node:assert/strict';
import { formatCompactMoney, moneyValue, normalizeCurrencyCode } from '../src/lib/money.js';

assert.deepEqual(moneyValue({ value: 1000000000, currency: { code: 'RUB' } }), {
  amount: 1000000000,
  currency: 'RUB',
});
assert.equal(normalizeCurrencyCode('Российский рубль'), 'RUB');
assert.equal(formatCompactMoney(1000000000, 'RUB'), '1,0 млрд ₽');
assert.equal(formatCompactMoney(1000000000, 'USD'), '1,0 млрд $');
assert.match(formatCompactMoney(1000000000, null), /валюта не указана/);
console.log('Money display preserves source currency instead of assuming dollars: OK');
