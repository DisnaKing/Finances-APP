import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { grandTotal, monthSummary, yearSummary, type MonthInput } from '../src/lib/calc.ts';

const empty: MonthInput = { incomes: [], bills: [], expenses: [], contributions: [] };

test('yearSummary: 12 filas numeradas y total = suma de columnas', () => {
  const months = Array.from({ length: 12 }, (_, i) =>
    monthSummary({
      ...empty,
      incomes: [{ amount: 1000 * (i + 1) }],
      expenses: [{ amount: 100 * (i + 1) }],
      contributions: [
        { kind: 'savings', amount: 10 },
        { kind: 'investment', amount: 20 },
        { kind: 'debt', amount: 30 },
      ],
    }),
  );
  const { rows, total } = yearSummary(months);
  assert.deepEqual(rows.map((r) => r.month), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(rows[2].income, 3000);
  assert.equal(rows[2].spent, 300);
  assert.equal(rows[2].remaining, 3000 - 300 - 10 - 20 - 30);
  assert.deepEqual(total, {
    income: 1000 * 78,
    spent: 100 * 78,
    saved: 120,
    invested: 240,
    debtPaid: 360,
    remaining: 900 * 78 - 720,
  });
});

test('yearSummary: año vacío', () => {
  const { rows, total } = yearSummary(Array.from({ length: 12 }, () => monthSummary(empty)));
  assert.equal(rows.length, 12);
  assert.deepEqual(Object.values(total), [0, 0, 0, 0, 0, 0]);
});

// --- Fixture del Excel (datos reales del usuario; gitignored). No imprimir su contenido. ---
const FIXTURE = new URL('./fixtures/excel.json', import.meta.url);

test('fixture Excel: el total anual es la suma de los meses esperados', { skip: !existsSync(FIXTURE) }, () => {
  const data = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const ms = Object.keys(data.months).map((m) => data.months[m]);
  const { total } = yearSummary(
    ms.map((x: any) =>
      monthSummary({
        incomes: x.income,
        bills: x.bills.map((b: any) => ({ amount: b.amount })),
        expenses: x.expenses.map((e: any) => ({ amount: e.amount })),
        contributions: [
          { kind: 'savings', amount: x.sheet_saved ?? 0 },
          { kind: 'investment', amount: x.sheet_invested ?? 0 },
          { kind: 'debt', amount: x.sheet_debt ?? 0 },
        ],
      }),
    ),
  );
  const sum = (f: (x: any) => number) => ms.reduce((a: number, x: any) => a + f(x), 0);
  const exp = {
    income: sum((x) => x.expected.income),
    remaining: sum((x) => x.expected.remaining),
    spent: sum((x) => x.expected.billsSpent + x.expected.expensesSpent),
  };
  for (const k of ['income', 'remaining', 'spent'] as const)
    assert.ok(total[k] === exp[k], `${k} diff=${total[k] - exp[k]}`);
});

test('grandTotal: suma los totales de cada año', () => {
  const y = (income: number, spent: number) => ({ income, spent, saved: 1, invested: 2, debtPaid: 3, remaining: income - spent - 6 });
  assert.deepEqual(grandTotal([y(100, 10), y(50, 5)]), { income: 150, spent: 15, saved: 2, invested: 4, debtPaid: 6, remaining: 150 - 15 - 12 });
  assert.deepEqual(grandTotal([]), { income: 0, spent: 0, saved: 0, invested: 0, debtPaid: 0, remaining: 0 });
});
