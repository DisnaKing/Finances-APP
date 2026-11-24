import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoCurrency, normalizeQuote, parseChart, quoteInCents, type Fetcher } from '../src/lib/quotes.ts';
import { autoValue } from '../src/lib/calc.ts';

test('isoCurrency: símbolo de la app → código ISO', () => {
  assert.equal(isoCurrency('€'), 'EUR');
  assert.equal(isoCurrency('$'), 'USD');
  assert.equal(isoCurrency('CHF'), 'CHF');
  assert.equal(isoCurrency('zł'), 'EUR'); // desconocida
});

test('parseChart: lee precio y moneda; rechaza formatos raros', () => {
  const ok = { chart: { result: [{ meta: { regularMarketPrice: 123.45, currency: 'USD' } }] } };
  assert.deepEqual(parseChart(ok), { price: 123.45, currency: 'USD' });
  assert.equal(parseChart({ chart: { result: null, error: { code: 'Not Found' } } }), null);
  assert.equal(parseChart({ chart: { result: [{ meta: { regularMarketPrice: 0, currency: 'USD' } }] } }), null);
  assert.equal(parseChart(null), null);
});

test('normalizeQuote: peniques → libras', () => {
  assert.deepEqual(normalizeQuote({ price: 8050, currency: 'GBp' }), { price: 80.5, currency: 'GBP' });
  assert.deepEqual(normalizeQuote({ price: 10, currency: 'EUR' }), { price: 10, currency: 'EUR' });
});

test('quoteInCents: misma moneda no convierte; otra moneda usa el par APP+XXX=X', async () => {
  const calls: string[] = [];
  const f: Fetcher = async (s) => {
    calls.push(s);
    return s === 'EURUSD=X' ? { price: 1.25, currency: 'USD' } : s === 'ASML.AS' ? { price: 700.126, currency: 'EUR' } : { price: 125, currency: 'USD' };
  };
  assert.equal(await quoteInCents('ASML.AS', '€', f), 70013);
  assert.deepEqual(calls, ['ASML.AS']);
  assert.equal(await quoteInCents('NVDA', '€', f), 10000); // 125 USD / 1,25 = 100 €
  assert.deepEqual(calls, ['ASML.AS', 'NVDA', 'EURUSD=X']);
});

test('autoValue: unidades × precio + lo no valorado a coste', () => {
  // 4 uds a 50 € = 200 € + inicial 10 € + 5 € sin precio
  assert.equal(autoValue({ initial: 1000, unpriced: 500, units: 4 }, 5000), 20000 + 1500);
  assert.equal(autoValue({ initial: 0, unpriced: 0, units: 0 }, 5000), 0);
});
