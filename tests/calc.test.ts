import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { billVisible, monthSummary, reactivationPlan, type MonthInput } from '../src/lib/calc.ts';

const base: MonthInput = { incomes: [], bills: [], expenses: [], contributions: [] };

test('totales y restante', () => {
  const s = monthSummary({
    ...base,
    incomes: [{ budget: 150000, amount: 100000 }, { budget: 0, amount: 5000 }],
    bills: [{ budget: 30000, amount: 31000 }, { budget: 2000, amount: null }],
    expenses: [{ amount: 4000 }, { amount: 1000 }],
    contributions: [
      { kind: 'savings', amount: 1000 },
      { kind: 'investment', amount: 2000 },
      { kind: 'debt', amount: 500 },
      { kind: 'savings', amount: 100 },
    ],
  });
  assert.equal(s.income, 105000);
  assert.equal(s.incomeBudget, 150000);
  assert.equal(s.billsBudget, 32000);
  assert.equal(s.billsSpent, 31000); // sin pago = 0
  assert.equal(s.expensesSpent, 5000);
  assert.equal(s.spent, 36000); // sin inversión
  assert.equal(s.saved, 1100);
  assert.equal(s.invested, 2000);
  assert.equal(s.debtPaid, 500);
  assert.equal(s.remaining, 105000 - 36000 - 1100 - 2000 - 500);
});

test('filas presupuesto vs actual', () => {
  const s = monthSummary({
    ...base,
    incomes: [{ budget: 100000, amount: 100000 }],
    bills: [
      { budget: 20000, amount: 21000 },
      { budget: 10000, amount: null },
    ],
    expenses: [{ amount: 700 }],
    contributions: [{ kind: 'savings', amount: 50 }, { kind: 'investment', amount: 60 }, { kind: 'debt', amount: 70 }],
    plan: { savings: 1, investment: 2, debt: 3 },
  });
  assert.deepEqual(s.rows, {
    bills: { budget: 30000, actual: 21000 },
    expenses: { budget: 100000 - 30000 - 1 - 2 - 3, actual: 700 },
    savings: { budget: 1, actual: 50 },
    investment: { budget: 2, actual: 60 },
    debt: { budget: 3, actual: 70 },
  });
});

test('presupuesto de gastos nunca negativo; plan por defecto 0', () => {
  const s = monthSummary({ ...base, incomes: [{ budget: 0, amount: 1000 }], bills: [{ budget: 99999, amount: 0 }] });
  assert.equal(s.rows.expenses.budget, 0);
  assert.deepEqual([s.rows.savings.budget, s.rows.investment.budget, s.rows.debt.budget], [0, 0, 0]);
});

test('billVisible', () => {
  const b = { start_month: '2026-05', end_month: '2026-08' as string | null };
  assert.equal(billVisible(b, '2026-05', false), true); // start = M
  assert.equal(billVisible(b, '2026-08', false), true); // end = M
  assert.equal(billVisible(b, '2026-09', false), false); // end < M
  assert.equal(billVisible(b, '2026-09', true), true); // end < M con pago
  assert.equal(billVisible(b, '2026-04', false), false); // start > M
  assert.equal(billVisible(b, '2026-04', true), true);
  assert.equal(billVisible({ ...b, end_month: null }, '2030-01', false), true);
});

// --- Fixture del Excel (datos reales del usuario; gitignored). No imprimir su contenido. ---
const FIXTURE = new URL('./fixtures/excel.json', import.meta.url);

test('fixture Excel: resumen de cada mes', { skip: !existsSync(FIXTURE) }, () => {
  const data = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const months = Object.keys(data.months);
  for (const m of months) {
    const x = data.months[m];
    const s = monthSummary({
      incomes: x.income,
      bills: x.bills.map((b: any) => ({ budget: b.budget ?? 0, amount: b.amount })),
      expenses: x.expenses.map((e: any) => ({ amount: e.amount })),
      contributions: [
        { kind: 'savings', amount: x.sheet_saved ?? 0 },
        { kind: 'investment', amount: x.sheet_invested ?? 0 },
        { kind: 'debt', amount: x.sheet_debt ?? 0 },
      ],
    });
    for (const k of ['income', 'billsSpent', 'expensesSpent', 'spent', 'remaining'] as const)
      assert.equal(s[k], x.expected[k], `${m} ${k}`);
  }
  const rem = Object.fromEntries(months.map((m) => [m, data.months[m].expected.remaining]));
  assert.deepEqual(rem, { '2026-08': 18367, '2026-09': 3033, '2026-10': 5445, '2026-11': 35248 });
});

test('reactivationPlan: terminada este mes o el anterior se reabre; más antigua se copia', () => {
  assert.equal(reactivationPlan('2026-11', '2026-11'), 'reopen');
  assert.equal(reactivationPlan('2026-10', '2026-11'), 'reopen');
  assert.equal(reactivationPlan('2026-09', '2026-11'), 'copy');
  assert.equal(reactivationPlan('2025-12', '2026-01'), 'reopen');
  assert.equal(reactivationPlan('2025-11', '2026-01'), 'copy');
});
