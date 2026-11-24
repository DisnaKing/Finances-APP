import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { accruedInterest, avgBuyPrice, unitsFor, yearlyInterest, goalStats, investmentStats, investmentTotals, investmentValue } from '../src/lib/calc.ts';

test('goalStats: caso normal', () => {
  const s = goalStats({ target: 100000, min_monthly: 30000, initial: 10000 }, 20000);
  assert.deepEqual(s, { total: 30000, left: 70000, progress: 0.3, monthsLeft: 3 }); // ceil(70000/30000)
});

test('goalStats: meta 0 -> sin progreso ni falta', () => {
  const s = goalStats({ target: 0, min_monthly: 100, initial: 500 }, 0);
  assert.equal(s.left, 0);
  assert.equal(s.progress, 0);
  assert.equal(s.monthsLeft, null);
});

test('goalStats: contribución mínima 0 -> monthsLeft null', () => {
  const s = goalStats({ target: 1000, min_monthly: 0, initial: 0 }, 100);
  assert.equal(s.left, 900);
  assert.equal(s.monthsLeft, null);
});

test('goalStats: superada -> falta 0, progreso 1, monthsLeft null', () => {
  const s = goalStats({ target: 1000, min_monthly: 100, initial: 800 }, 700);
  assert.equal(s.total, 1500);
  assert.equal(s.left, 0);
  assert.equal(s.progress, 1);
  assert.equal(s.monthsLeft, null);
});

test('investmentStats: ganancia y pérdida', () => {
  assert.deepEqual(investmentStats({ initial: 1000, current_value: 1500 }, 1000), { contributed: 2000, gain: -500, gainPct: -0.25 });
  assert.deepEqual(investmentStats({ initial: 1000, current_value: 3000 }, 1000), { contributed: 2000, gain: 1000, gainPct: 0.5 });
});

test('investmentStats: sin aportado -> % 0', () => {
  assert.deepEqual(investmentStats({ initial: 0, current_value: 500 }, 0), { contributed: 0, gain: 500, gainPct: 0 });
});

test('investmentTotals suma activos', () => {
  const t = investmentTotals([{ contributed: 1000, value: 1200 }, { contributed: 1000, value: 800 }]);
  assert.deepEqual(t, { contributed: 2000, value: 2000, gain: 0, gainPct: 0 });
});

// --- Fixture del Excel (datos reales del usuario; gitignored). No imprimir su contenido. ---
const FIXTURE = new URL('./fixtures/excel.json', import.meta.url);
const load = () => JSON.parse(readFileSync(FIXTURE, 'utf8'));
// En el Excel, INVERSIONES!D13 es un número tecleado (no la fórmula B+SUMIF del resto de filas) y
// supera en 20 céntimos a inicial + registro. La app usa la fórmula; se documenta la diferencia.
const EXCEL_TYPED: Record<number, number> = { 2: 20 };
const sumBy = (rows: any[], key: string, name: string) =>
  rows.filter((r) => r[key] === name).reduce((a, r) => a + r.amount, 0);

test('fixture Excel: total de cada meta', { skip: !existsSync(FIXTURE) }, () => {
  const d = load();
  d.goals.forEach((g: any, i: number) => {
    const s = goalStats(g, sumBy(d.savings_register, 'goal', g.name));
    assert.ok(s.total === g.expected_total, `meta #${i} diff=${s.total - g.expected_total}`);
  });
});

test('fixture Excel: aportado de cada inversión', { skip: !existsSync(FIXTURE) }, () => {
  const d = load();
  d.investments.forEach((v: any, i: number) => {
    const s = investmentStats(v, sumBy(d.investment_register, 'asset', v.name));
    assert.ok(s.contributed + (EXCEL_TYPED[i] ?? 0) === v.expected_contributed, `inversión #${i} diff=${s.contributed - v.expected_contributed}`);
  });
});

test('fixture Excel: totales de ahorro e inversión', { skip: !existsSync(FIXTURE) }, () => {
  const d = load();
  const e = d.expected_totals;
  const gs = d.goals.map((g: any) => goalStats(g, sumBy(d.savings_register, 'goal', g.name)));
  const saved = gs.reduce((a: number, s: any) => a + s.total, 0);
  const left = gs.reduce((a: number, s: any) => a + s.left, 0);
  assert.ok(saved === e.saved_total, `saved_total diff=${saved - e.saved_total}`);
  assert.ok(left === e.left_total, `left_total diff=${left - e.left_total}`);
  const t = investmentTotals(
    d.investments.map((v: any) => ({
      contributed: investmentStats(v, sumBy(d.investment_register, 'asset', v.name)).contributed,
      // valorada a una fecha lejana: ninguna aportación posterior, el valor es el guardado
      value: investmentValue({ current_value: v.current_value, value_date: '9999-12-31' }, 0, 0),
    })),
  );
  const typed = Object.values(EXCEL_TYPED).reduce((a, x) => a + x, 0);
  assert.ok(t.contributed + typed === e.inv_contributed, `inv_contributed diff=${t.contributed - e.inv_contributed}`);
  assert.ok(t.value === e.inv_value, `inv_value diff=${t.value - e.inv_value}`);
});

test('investmentValue: sin valorar = aportado', () => {
  assert.equal(investmentValue({ current_value: 0, value_date: null }, 2500, 0), 2500);
});

test('investmentValue: valorada + aportación posterior', () => {
  assert.equal(investmentValue({ current_value: 3000, value_date: '2026-05-10' }, 2000, 500), 3500);
  const s = investmentStats({ initial: 1000, current_value: 3500 }, 1000);
  assert.deepEqual(s, { contributed: 2000, gain: 1500, gainPct: 0.75 });
});

test('investmentValue: aportación el mismo día ya está en el valor', () => {
  // contribAfter cuenta solo date > value_date; la del mismo día no se suma otra vez
  assert.equal(investmentValue({ current_value: 3000, value_date: '2026-05-10' }, 2500, 0), 3000);
});

const c = (date: string, amount: number) => ({ date, amount });

test('accruedInterest: tasa 0 o sin aportaciones -> 0', () => {
  assert.equal(accruedInterest(0, 100000, [c('2026-01-01', 100)], '2026-12-31'), 0);
  assert.equal(accruedInterest(3, 100000, [], '2026-12-31'), 0);
});

test('accruedInterest: TAE/12 cada mes sobre el saldo de ese mes, compuesto', () => {
  // 12 % anual = 1 % mensual; 12000,00 € presentes desde el día 1: enero 120,00 y febrero 121,20
  assert.equal(accruedInterest(12, 0, [c('2026-01-01', 1200000)], '2026-02-28'), 24120);
});

test('accruedInterest: el interés se abona el último día del mes', () => {
  const cs = [c('2026-01-01', 1200000)];
  assert.equal(accruedInterest(12, 0, cs, '2026-01-30'), 0); // aún no ha llegado el 31
  assert.equal(accruedInterest(12, 0, cs, '2026-01-31'), 12000);
});

test('accruedInterest: una aportación a mitad de mes solo rinde los días que lleva', () => {
  // febrero 2026 = 28 días; aportación el día 15 → 14 de 28 días = mitad del mes → 0,5 %
  assert.equal(accruedInterest(12, 0, [c('2026-02-15', 1200000)], '2026-02-28'), 6000);
});

test('accruedInterest: el saldo inicial cuenta desde el mes de la primera aportación', () => {
  assert.equal(accruedInterest(12, 1000000, [c('2026-01-01', 200000)], '2026-01-31'), 12000);
});

test('yearlyInterest: 12 meses sin aportaciones', () => {
  assert.equal(yearlyInterest(0, 100000), 0);
  const y = yearlyInterest(12, 1000000);
  assert.ok(y > 120000 && y < 130000, String(y)); // ≈ 12,68 %
});

test('unitsFor / avgBuyPrice: unidades y precio medio ponderado', () => {
  assert.equal(unitsFor(10000, 2500), 4);
  assert.equal(unitsFor(10000, null), null);
  assert.equal(unitsFor(10000, 0), null);
  // 100 € a 25 € (4 uds) + 100 € a 50 € (2 uds) → 200 € / 6 uds = 33,33 €
  assert.equal(avgBuyPrice([{ amount: 10000, price: 2500 }, { amount: 10000, price: 5000 }]), 3333);
  assert.equal(avgBuyPrice([{ amount: 10000, price: null }]), null);
  assert.equal(avgBuyPrice([]), null);
});
