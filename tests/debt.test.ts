import test from 'node:test';
import assert from 'node:assert/strict';
import { debtSchedule, debtStats, debtSummary, monthSummary, nper } from '../src/lib/calc.ts';

const d = (o: Partial<{ principal: number; min_payment: number; annual_rate: number; start_date: string }> = {}) => ({
  principal: 100000, min_payment: 20000, annual_rate: 0, start_date: '2026-01-15', ...o,
});

test('nper: Excel NPER(1%, -100, 5000) = 69,66 → 70', () => {
  assert.equal(nper(0.01, 10000, 500000), 70);
});
test('nper: r=0, pago ≤ interés → null, principal 0', () => {
  assert.equal(nper(0, 30000, 100000), 4);
  assert.equal(nper(0, 25000, 100000), 4);
  assert.equal(nper(0.01, 1000, 100000), null); // pago = interés
  assert.equal(nper(0.01, 500, 100000), null);
  assert.equal(nper(0.01, 1000, 0), 0);
  assert.equal(nper(0, 0, 100), null);
});

test('schedule sin pagos reales: usa min_payment, para en 0 y capa el último pago', () => {
  const rows = debtSchedule(d({ min_payment: 30000 }), {});
  assert.deepEqual(rows.map((r) => r.month), ['2026-01', '2026-02', '2026-03', '2026-04']);
  assert.deepEqual(rows.map((r) => r.payment), [30000, 30000, 30000, 10000]);
  assert.equal(rows[3].balance, 0);
  assert.ok(rows.every((r) => r.balance >= 0));
});
test('schedule con interés y pagos reales', () => {
  const rows = debtSchedule(d({ annual_rate: 12 }), { '2026-01': 50000, '2026-03': 5000 });
  assert.equal(rows[0].interest, 1000);
  assert.equal(rows[0].payment, 50000);
  assert.equal(rows[0].balance, 51000);
  assert.equal(rows[1].payment, 20000); // sin pago real → mínimo
  assert.equal(rows[2].payment, 5000); // real, aunque menor al mínimo
  assert.ok(rows.every((r) => r.balance >= 0));
  assert.equal(rows[rows.length - 1].balance, 0);
});
test('schedule: pago real mayor que lo debido se capa; untilMonth corta', () => {
  const rows = debtSchedule(d({ annual_rate: 12 }), { '2026-01': 999999 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payment, 101000);
  assert.equal(debtSchedule(d(), {}, '2026-02').length, 2);
  assert.equal(debtSchedule(d(), {}, '2025-12').length, 0);
});
test('schedule: tope de 600 filas si el pago no cubre el interés', () => {
  assert.equal(debtSchedule(d({ annual_rate: 24, min_payment: 100 }), {}).length, 600);
});

test('debtStats: saldo, paidPct y monthsLeft', () => {
  const s = debtStats(d(), { '2026-01': 30000 }, '2026-02');
  assert.equal(s.currentBalance, 50000); // 100000-30000-20000(mín)
  assert.equal(s.paidTotal, 30000);
  assert.equal(s.paidPct, 0.3);
  assert.equal(s.monthsLeft, 3);
  assert.equal(s.freeMonth, '2026-05');
});
test('debtStats: antes del inicio, liquidada y pago ≤ interés', () => {
  const before = debtStats(d(), {}, '2025-12');
  assert.equal(before.currentBalance, 100000);
  assert.equal(before.monthsLeft, 5);
  const done = debtStats(d(), { '2026-01': 100000 }, '2026-06');
  assert.equal(done.currentBalance, 0);
  assert.equal(done.monthsLeft, 0);
  assert.equal(done.paidPct, 1);
  const never = debtStats(d({ annual_rate: 24, min_payment: 100 }), {}, '2026-01');
  assert.equal(never.monthsLeft, null);
  assert.equal(never.freeMonth, null);
  assert.equal(debtStats(d({ principal: 0 }), {}, '2026-01').paidPct, 0);
});

test('debtSummary: orden bola de nieve, totales y freeMonth', () => {
  const s = debtSummary([
    { id: 1, min_payment: 100, currentBalance: 5000, freeMonth: '2027-01' },
    { id: 2, min_payment: 50, currentBalance: 0, freeMonth: '2026-01' },
    { id: 3, min_payment: 70, currentBalance: 2000, freeMonth: '2028-03' },
    { id: 4, min_payment: 10, currentBalance: 2000, freeMonth: '2026-09' },
  ]);
  assert.deepEqual(s.order, [3, 4, 1, 2]);
  assert.equal(s.totalBalance, 9000);
  assert.equal(s.totalMin, 180); // la liquidada no cuenta
  assert.equal(s.freeMonth, '2028-03');
  const never = debtSummary([
    { id: 1, min_payment: 1, currentBalance: 10, freeMonth: null },
    { id: 2, min_payment: 1, currentBalance: 10, freeMonth: '2027-01' },
  ]);
  assert.equal(never.freeMonth, null);
  assert.equal(debtSummary([{ id: 1, min_payment: 1, currentBalance: 0, freeMonth: '2026-01' }]).freeMonth, '2026-01');
  assert.equal(debtSummary([]).freeMonth, null);
});

test('monthSummary: aportación kind debt cuenta como debtPaid y en necesidades', () => {
  const base = {
    incomes: [{ budget: 200000, amount: 200000 }], bills: [], expenses: [],
    pct: { needs: 50, wants: 30, savings: 20 }, plan: { savings: 0, investment: 0, debt: 15000 },
  };
  const a = monthSummary({ ...base, contributions: [] });
  const b = monthSummary({ ...base, contributions: [{ kind: 'debt', amount: 15000 }] });
  assert.equal(b.split.needs.actual - a.split.needs.actual, 15000);
  assert.equal(a.remaining - b.remaining, 15000);
  assert.deepEqual(b.rows.debt, { budget: 15000, actual: 15000 });
});
