import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { monthSummary, type MonthInput } from '../src/lib/calc.ts';
import { NOT_BUDGET, parseWorkbook, validateBackup, type ImportPlan } from '../src/lib/importXlsx.ts';

// Datos reales del usuario (gitignored): las aserciones solo muestran diferencias y recuentos, nunca valores.
const XLSX_FILE = new URL('./fixtures/presupuesto.xlsx', import.meta.url);
const JSON_FILE = new URL('./fixtures/excel.json', import.meta.url);
const HAVE = existsSync(XLSX_FILE) && existsSync(JSON_FILE);
const NOW = '2026-11-15';
const pct = { needs: 50, wants: 30, savings: 20 };
const NEEDS = new Set(['mercado', 'transporte', 'salud', 'hogar', 'educación', 'mascotas']);
// Diferencias reales del libro (mes|campo|signo de calculado - Excel), sin importes:
//  - AGO: la inversión del mes (G19) está tecleada a mano y no cuadra con el registro (y por tanto el restante).
//  - SEP: un gasto está guardado como texto, que la suma del Excel ignora (y por tanto el restante).
//  - INVERSIONES!D13: valor tecleado (+20 céntimos) distinto de inicial + registro.
const KNOWN = ['2026-08|Inversión|1', '2026-08|Restante|-1', '2026-09|Gastos|1', '2026-09|Restante|-1', '|Inversión <activo>|-1'];
const FIELD = { income: 'Ingresos', billsSpent: 'Facturas', expensesSpent: 'Gastos', remaining: 'Restante' } as const;

const real = () => {
  const plan = parseWorkbook(XLSX.read(readFileSync(XLSX_FILE), { type: 'buffer', cellNF: true }), NOW);
  return { plan, fx: JSON.parse(readFileSync(JSON_FILE, 'utf8')) };
};

test('Excel real: totales de cada mes iguales a los del Excel', { skip: !HAVE }, () => {
  const { plan, fx } = real();
  assert.ok(plan.months.length === Object.keys(fx.months).length, `meses: ${plan.months.length} vs ${Object.keys(fx.months).length}`);
  for (const m of plan.months) {
    const x = fx.months[m];
    assert.ok(x, `mes ${m} fuera del fixture`);
    const input: MonthInput = {
      incomes: plan.incomes.filter((i) => i.month === m),
      bills: plan.payments
        .filter((p) => p.month === m)
        .map((p) => ({ budget: plan.bills[p.bill].budget, kind: plan.bills[p.bill].kind, amount: p.amount })),
      expenses: plan.expenses
        .filter((e) => e.date.slice(0, 7) === m)
        .map((e) => ({ amount: e.amount, kind: e.category == null ? null : NEEDS.has(e.category.toLowerCase()) ? 'needs' : 'wants' })),
      contributions: [
        ...plan.contributions.filter((c) => c.date.slice(0, 7) === m).map((c) => ({ kind: c.kind, amount: c.amount })),
        { kind: 'debt', amount: x.sheet_debt ?? 0 },
      ],
      pct,
    };
    const s = monthSummary(input);
    // Cada diferencia con el Excel debe estar avisada en el plan con el mismo importe.
    for (const k of ['income', 'billsSpent', 'expensesSpent', 'remaining'] as const) {
      const diff = s[k] - x.expected[k];
      const reported = plan.discrepancies.find((d) => d.month === m && d.field === FIELD[k])?.diff ?? 0;
      assert.ok(diff === reported, `${m} ${k} diff=${diff} avisada=${reported}`);
    }
  }
});

test('Excel real: recuentos de facturas, gastos y registros', { skip: !HAVE }, () => {
  const { plan, fx } = real();
  const ms = Object.values<any>(fx.months);
  const nBills = ms.reduce((a, x) => a + x.bills.filter((b: any) => b.amount !== 0).length, 0);
  const nExp = ms.reduce((a, x) => a + x.expenses.filter((e: any) => e.amount !== 0).length, 0);
  const nInc = ms.reduce((a, x) => a + x.income.length, 0);
  assert.ok(plan.payments.length === nBills, `pagos ${plan.payments.length} vs ${nBills}`);
  // El fixture da 0 al gasto guardado como texto; el importador lo lee (y lo avisa como diferencia de SEP).
  const textual = plan.discrepancies.some((d) => d.month === '2026-09' && d.field === 'Gastos') ? 1 : 0;
  assert.ok(plan.expenses.length === nExp + textual, `gastos ${plan.expenses.length} vs ${nExp}+${textual}`);
  assert.ok(plan.incomes.length === nInc, `ingresos ${plan.incomes.length} vs ${nInc}`);
  const cnt = (k: string) => plan.contributions.filter((c) => c.kind === k).length;
  assert.ok(plan.goals.length === fx.goals.length, `metas ${plan.goals.length} vs ${fx.goals.length}`);
  assert.ok(plan.investments.length === fx.investments.length, `inversiones ${plan.investments.length} vs ${fx.investments.length}`);
  assert.ok(cnt('savings') === fx.savings_register.length, `registro ahorro ${cnt('savings')} vs ${fx.savings_register.length}`);
  assert.ok(cnt('investment') === fx.investment_register.length, `registro inversión ${cnt('investment')} vs ${fx.investment_register.length}`);
});

test('Excel real: total de cada meta e inversión', { skip: !HAVE }, () => {
  const { plan, fx } = real();
  plan.goals.forEach((g, i) => {
    const total = g.initial + plan.contributions.filter((c) => c.kind === 'savings' && c.target === i).reduce((a, c) => a + c.amount, 0);
    assert.ok(total === fx.goals[i].expected_total, `meta #${i} diff=${total - fx.goals[i].expected_total}`);
  });
  const typed: Record<number, number> = { 2: 20 };
  plan.investments.forEach((v, i) => {
    const contributed = v.initial + plan.contributions.filter((c) => c.kind === 'investment' && c.target === i).reduce((a, c) => a + c.amount, 0);
    assert.ok(contributed + (typed[i] ?? 0) === fx.investments[i].expected_contributed, `inversión #${i} diff=${contributed - fx.investments[i].expected_contributed}`);
    assert.ok(v.current_value === fx.investments[i].current_value, `valor inversión #${i}`);
  });
});

test('Excel real: sin avisos y solo la diferencia conocida', { skip: !HAVE }, () => {
  const { plan } = real();
  assert.ok(plan.warnings.length === 0, `avisos=${plan.warnings.length}`);
  const got = plan.discrepancies.map((d) => `${d.month}|${d.field.startsWith('Inversión ') ? 'Inversión <activo>' : d.field}|${Math.sign(d.diff)}`).sort();
  assert.deepEqual(got, [...KNOWN].sort());
});

// --- Libro sintético ---
type Cells = Record<string, Record<string, unknown>>; // hoja -> {celda: valor}
const book = (cells: Cells = {}, omit: string[] = []) => {
  const wb = XLSX.utils.book_new();
  const names = ['ANUAL', 'ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC', 'PAGO DEUDAS | BOLA DE NIEVE', 'FONDO DE AHORROS', 'INVERSIONES'];
  for (const n of names) {
    if (omit.includes(n)) continue;
    const ws: XLSX.WorkSheet = XLSX.utils.aoa_to_sheet([[]]);
    for (const [a, v] of Object.entries(cells[n] ?? {})) XLSX.utils.sheet_add_aoa(ws, [[v]], { origin: a });
    XLSX.utils.book_append_sheet(wb, ws, n);
  }
  return wb;
};
const parse = (cells: Cells = {}): ImportPlan => parseWorkbook(book(cells), NOW);
const INC = { E5: 'Sueldo', F5: 1000, G5: 1000 };

test('libro sin una hoja: NOT_BUDGET', () => {
  assert.throws(() => parseWorkbook(book({}, ['INVERSIONES']), NOW), { message: NOT_BUDGET });
});

test('libro sin meses con datos: NOT_BUDGET', () => {
  assert.throws(() => parse(), { message: NOT_BUDGET });
});

test('tipo vacío = necesidades; gasto sin fecha = día 1; año 2026 por defecto', () => {
  const p = parse({ SEP: { ...INC, B26: 'Luz', D26: 12.34, I26: 'Pan', J26: 2.5, K26: 'Mercado' } });
  assert.deepEqual(p.months, ['2026-09']);
  assert.equal(p.bills[0].kind, 'needs');
  assert.equal(p.payments[0].amount, 1234);
  assert.equal(p.expenses[0].date, '2026-09-01');
  assert.equal(p.expenses[0].amount, 250);
  assert.deepEqual(p.categoriesNeeded, [{ name: 'Mercado', kind: 'needs' }]);
  assert.equal(p.warnings.length, 0);
});

test('factura en varios meses: una factura, un pago por mes, fin según el último mes', () => {
  const p = parse({
    AGO: { ...INC, B26: 'Luz', C26: 10, D26: 10, E26: 'Necesidades', B27: 'Gym', D27: 20, E27: 'Deseos' },
    SEP: { ...INC, B26: 'Luz', C26: 15, D26: 15, E26: 'Deseos' },
  });
  assert.equal(p.bills.length, 2);
  const luz = p.bills.find((b) => b.concept === 'Luz')!;
  const gym = p.bills.find((b) => b.concept === 'Gym')!;
  assert.deepEqual([luz.start_month, luz.end_month, luz.budget, luz.kind], ['2026-08', null, 1500, 'wants']);
  assert.deepEqual([gym.start_month, gym.end_month], ['2026-08', '2026-08']);
  assert.equal(p.payments.length, 3);
});

test('pagada según la casilla; sin importe real no hay pago', () => {
  const p = parse({ SEP: { ...INC, A26: true, B26: 'Luz', D26: 5, B27: 'Agua', D27: 6, B28: 'Gas' } });
  assert.deepEqual(p.payments.map((x) => x.paid), [1, 0]);
  assert.equal(p.bills.length, 3);
});

test('aportación a un destino desconocido: aviso y se omite', () => {
  const p = parse({
    SEP: INC,
    'FONDO DE AHORROS': { A9: 'Viaje', B9: 100, L9: '2026-09-03', M9: 'Viaje', N9: 10, L10: '2026-09-04', M10: 'Otra', N10: 5 },
  });
  assert.equal(p.contributions.length, 1);
  assert.equal(p.warnings.length, 1);
});

test('inversión: fecha de valoración nunca anterior a su última aportación', () => {
  const p = parse({ SEP: INC, INVERSIONES: { A11: 'ETF', B11: 100, E11: 120, I11: '2030-01-02', J11: 'ETF', K11: 10 } });
  assert.equal(p.investments[0].value_date, '2030-01-02');
  assert.equal(p.contributions[0].kind, 'investment');
});

test('discrepancia con el total del Excel: signo = calculado - Excel', () => {
  const p = parse({ SEP: { ...INC, G10: 1005 } });
  const d = p.discrepancies.find((x) => x.field === 'Ingresos')!;
  assert.equal(d.diff, -500);
});

// --- validateBackup ---
const T = ['a', 'b'];
const ok = { app: 'mny', schema: 1, tables: { a: [{ id: 1, x: 'y', z: null }], b: [] } };

test('validateBackup: copia correcta', () => {
  assert.equal(validateBackup(ok, T, 1), ok);
});

test('validateBackup: rechaza lo que no es una copia válida', () => {
  const bad: unknown[] = [
    null,
    { ...ok, app: 'otra' },
    { ...ok, schema: 'x' },
    { ...ok, schema: 2 }, // más nueva que la app (max 1)
    { ...ok, tables: undefined },
    { ...ok, tables: { a: [] } }, // falta b
    { ...ok, tables: { a: [{ 'x; DROP': 1 }], b: [] } }, // clave que acabaría en SQL
    { ...ok, tables: { a: [{ x: { y: 1 } }], b: [] } },
    { ...ok, tables: { a: [[1]], b: [] } },
  ];
  for (const j of bad) assert.throws(() => validateBackup(j, T, 1));
});
