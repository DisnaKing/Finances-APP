// Importación del Excel de presupuesto y validación de copias JSON. Puro: sin imports en runtime
// (corre bajo `node --test`; xlsx solo como tipos). Importes en céntimos, fechas ISO.
import type { WorkBook, WorkSheet } from 'xlsx';

export const NOT_BUDGET = 'No parece el Excel de presupuesto';

type K = 'needs' | 'wants' | 'savings';
export type ImportPlan = {
  currency: string | null;
  months: string[]; // YYYY-MM con datos
  bills: { concept: string; kind: K; budget: number; start_month: string; end_month: string | null }[];
  payments: { bill: number; month: string; amount: number; date: string; paid: 0 | 1 }[]; // bill = índice en `bills`
  incomes: { month: string; concept: string; budget: number; amount: number }[];
  expenses: { date: string; concept: string; amount: number; category: string | null }[];
  goals: { name: string; target: number; min_monthly: number; initial: number }[];
  investments: { name: string; initial: number; monthly: number; current_value: number; value_date: string }[];
  debts: { name: string; principal: number; min_payment: number; annual_rate: number; start_date: string }[];
  contributions: { date: string; kind: 'savings' | 'investment'; target: number; amount: number }[]; // target = índice en goals/investments
  categoriesNeeded: { name: string; kind: 'needs' | 'wants' }[];
  warnings: string[];
  discrepancies: { month: string; field: string; diff: number }[]; // diff = calculado - Excel, en céntimos
};

const MONTHS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
const DEBT = 'PAGO DEUDAS | BOLA DE NIEVE';
const GOAL = 'FONDO DE AHORROS';
const INV = 'INVERSIONES';
// Mismas categorías "necesidades" que la semilla (schema.ts); el resto son deseos.
const NEEDS_CATS = new Set(['mercado', 'transporte', 'salud', 'hogar', 'educación', 'mascotas']);
const KINDS: Record<string, K> = { necesidades: 'needs', deseos: 'wants', ahorros: 'savings' };

const cell = (ws: WorkSheet, a: string): unknown => ws[a]?.v;
const str = (v: unknown) => (v == null ? '' : String(v).trim());
const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = typeof v === 'string' ? v.trim().replace(',', '.') : '';
  return s && Number.isFinite(Number(s)) ? Number(s) : null;
};
const cents = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.round(n * 100);
};
/** Serie de Excel (días desde 1899-12-30), Date o texto ISO -> YYYY-MM-DD. */
const iso = (v: unknown): string | null => {
  if (typeof v === 'number' && v >= 1 && v < 100000) return new Date((Math.floor(v) - 25569) * 86400000).toISOString().slice(0, 10);
  if (v instanceof Date && !isNaN(+v)) return v.toISOString().slice(0, 10);
  const m = typeof v === 'string' ? /^(\d{4}-\d{2}-\d{2})/.exec(v.trim()) : null;
  return m ? m[1] : null;
};
const isPaid = (v: unknown) => v === true || (typeof v === 'string' && /^(✓|✔|☑|✅|x|true|1)$/i.test(v.trim()));
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const lc = (s: string) => s.toLowerCase();
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Convierte el libro en un plan de importación. Lanza NOT_BUDGET si falta una hoja o no hay meses con datos. */
export function parseWorkbook(wb: WorkBook, now: string = localToday()): ImportPlan {
  const sheets = new Map(wb.SheetNames.map((n) => [n.trim().toUpperCase(), wb.Sheets[n]]));
  const get = (n: string) => {
    const s = sheets.get(n);
    if (!s) throw new Error(NOT_BUDGET);
    return s;
  };
  get('ANUAL');
  const monthWs = MONTHS.map(get);
  const debtWs = get(DEBT);
  const goalWs = get(GOAL);
  const invWs = get(INV);

  const plan: ImportPlan = {
    currency: null, months: [], bills: [], payments: [], incomes: [], expenses: [], goals: [], investments: [],
    debts: [], contributions: [], categoriesNeeded: [], warnings: [], discrepancies: [],
  };
  const warn = (s: string) => plan.warnings.push(s);

  const y = num(cell(debtWs, 'B4'));
  const year = y !== null && Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : 2026;
  const cur = cell(debtWs, 'B5');
  plan.currency = typeof cur === 'string' && cur.trim() ? cur.trim() : null;

  // --- Meses ---
  type Group = { concept: string; kind: K; budget: number; first: string; last: string };
  const groups = new Map<string, Group>();
  const sheetTotals: { month: string; ws: WorkSheet; income: number; bills: number; expenses: number }[] = [];
  const cats = new Map<string, string>();

  monthWs.forEach((ws, i) => {
    const month = `${year}-${String(i + 1).padStart(2, '0')}`;
    const incomes: ImportPlan['incomes'] = [];
    for (let r = 5; r <= 9; r++) {
      const concept = str(cell(ws, `E${r}`));
      if (concept) incomes.push({ month, concept, budget: cents(cell(ws, `F${r}`)) ?? 0, amount: cents(cell(ws, `G${r}`)) ?? 0 });
    }

    const seen = new Map<string, number>(); // repetidos del mismo concepto dentro del mes
    const bills: { key: string; g: Group; amount: number | null; date: string; paid: 0 | 1 }[] = [];
    for (let r = 26; r <= 41; r++) {
      const concept = str(cell(ws, `B${r}`));
      if (!concept) continue;
      const kindText = str(cell(ws, `E${r}`));
      let kind: K = KINDS[lc(kindText)] ?? 'needs';
      if (kindText && !KINDS[lc(kindText)]) warn(`${month}: tipo de factura desconocido "${kindText}", se usa Necesidades`), (kind = 'needs');
      const n = (seen.get(lc(concept)) ?? 0) + 1;
      seen.set(lc(concept), n);
      bills.push({
        key: `${lc(concept)}#${n}`,
        g: { concept, kind, budget: cents(cell(ws, `C${r}`)) ?? 0, first: month, last: month },
        amount: cents(cell(ws, `D${r}`)),
        date: iso(cell(ws, `F${r}`)) ?? `${month}-01`,
        paid: isPaid(cell(ws, `A${r}`)) ? 1 : 0,
      });
    }

    const expenses: ImportPlan['expenses'] = [];
    for (let r = 26; r <= 45; r++) {
      const concept = str(cell(ws, `I${r}`));
      const amount = cents(cell(ws, `J${r}`));
      if (!amount) continue;
      if (!concept) {
        warn(`${month}: fila ${r} con importe pero sin concepto, ignorada`);
        continue;
      }
      let date = iso(cell(ws, `L${r}`)) ?? `${month}-01`;
      if (date.slice(0, 7) !== month) {
        warn(`${month}: el gasto "${concept}" tiene fecha de otro mes (${date}), se pone el día 1`);
        date = `${month}-01`;
      }
      const category = str(cell(ws, `K${r}`)) || null;
      if (category && !cats.has(lc(category))) cats.set(lc(category), category);
      expenses.push({ date, concept, amount, category });
    }

    if (!incomes.some((x) => x.amount) && !bills.length && !expenses.length) return; // mes plantilla
    plan.months.push(month);
    plan.incomes.push(...incomes);
    plan.expenses.push(...expenses);
    for (const b of bills) {
      let g = groups.get(b.key);
      if (g) Object.assign(g, { concept: b.g.concept, kind: b.g.kind, budget: b.g.budget, last: month }); // manda el último mes
      else groups.set(b.key, (g = b.g));
      if (b.amount !== null) plan.payments.push({ bill: [...groups.keys()].indexOf(b.key), month, amount: b.amount, date: b.date, paid: b.paid });
    }
    sheetTotals.push({ month, ws, income: sum(incomes.map((x) => x.amount)), bills: sum(bills.map((b) => b.amount ?? 0)), expenses: sum(expenses.map((e) => e.amount)) });
  });

  if (!plan.months.length) throw new Error(NOT_BUDGET);
  const lastMonth = plan.months[plan.months.length - 1];
  plan.bills = [...groups.values()].map((g) => ({
    concept: g.concept, kind: g.kind, budget: g.budget, start_month: g.first, end_month: g.last === lastMonth ? null : g.last,
  }));
  plan.categoriesNeeded = [...cats.entries()].map(([k, name]) => ({ name, kind: NEEDS_CATS.has(k) ? 'needs' : 'wants' }));

  // --- Metas de ahorro ---
  const expectedGoal: (number | null)[] = [];
  for (let r = 9; r <= 18; r++) {
    const name = str(cell(goalWs, `A${r}`));
    if (!name) continue;
    plan.goals.push({ name, target: cents(cell(goalWs, `B${r}`)) ?? 0, min_monthly: cents(cell(goalWs, `C${r}`)) ?? 0, initial: cents(cell(goalWs, `D${r}`)) ?? 0 });
    expectedGoal.push(cents(cell(goalWs, `E${r}`)));
  }

  // --- Inversiones ---
  const expectedInv: (number | null)[] = [];
  for (let r = 11; r <= 20; r++) {
    const name = str(cell(invWs, `A${r}`));
    if (!name) continue;
    plan.investments.push({
      name, initial: cents(cell(invWs, `B${r}`)) ?? 0, monthly: cents(cell(invWs, `C${r}`)) ?? 0,
      current_value: cents(cell(invWs, `E${r}`)) ?? 0, value_date: now,
    });
    expectedInv.push(cents(cell(invWs, `D${r}`)));
  }

  // --- Registros de aportaciones ---
  const register = (ws: WorkSheet, from: number, to: number, [cd, cn, ca]: string[], kind: 'savings' | 'investment', targets: { name: string }[]) => {
    const byName = new Map(targets.map((t, i) => [lc(t.name), i]));
    for (let r = from; r <= to; r++) {
      const name = str(cell(ws, `${cn}${r}`));
      const amount = cents(cell(ws, `${ca}${r}`));
      if (!amount) continue;
      const date = iso(cell(ws, `${cd}${r}`));
      const target = byName.get(lc(name));
      if (target === undefined) warn(`${kind === 'savings' ? 'Ahorro' : 'Inversión'}: "${name || '(sin nombre)'}" no coincide con ninguna ${kind === 'savings' ? 'meta' : 'inversión'}, aportación ignorada`);
      else if (!date) warn(`${kind === 'savings' ? 'Ahorro' : 'Inversión'}: aportación a "${name}" sin fecha válida, ignorada`);
      else plan.contributions.push({ date, kind, target, amount });
    }
  };
  register(goalWs, 9, 38, ['L', 'M', 'N'], 'savings', plan.goals);
  register(invWs, 11, 40, ['I', 'J', 'K'], 'investment', plan.investments);

  // La valoración nunca es anterior a su última aportación.
  plan.contributions.filter((c) => c.kind === 'investment').forEach((c) => {
    const inv = plan.investments[c.target];
    if (c.date > inv.value_date) inv.value_date = c.date;
  });

  // --- Deudas (puede estar vacía) ---
  for (let r = 14; r <= 23; r++) {
    const name = str(cell(debtWs, `A${r}`));
    if (!name) continue;
    const rate = num(cell(debtWs, `D${r}`)) ?? 0;
    plan.debts.push({
      name, principal: cents(cell(debtWs, `B${r}`)) ?? 0, min_payment: cents(cell(debtWs, `C${r}`)) ?? 0,
      annual_rate: String(debtWs[`D${r}`]?.z ?? '').includes('%') ? rate * 100 : rate, // 5% se guarda como 0,05
      start_date: iso(cell(debtWs, `E${r}`)) ?? `${plan.months[0]}-01`,
    });
  }

  // --- Discrepancias: lo calculado con el plan frente a los totales del Excel ---
  const diff = (month: string, field: string, calc: number, sheet: number | null) => {
    if ((sheet ?? 0) !== calc) plan.discrepancies.push({ month, field, diff: calc - (sheet ?? 0) });
  };
  const contrib = (kind: string, month: string) => sum(plan.contributions.filter((c) => c.kind === kind && c.date.slice(0, 7) === month).map((c) => c.amount));
  for (const t of sheetTotals) {
    const saved = contrib('savings', t.month);
    const invested = contrib('investment', t.month);
    diff(t.month, 'Ingresos', t.income, cents(cell(t.ws, 'G10')));
    diff(t.month, 'Facturas', t.bills, cents(cell(t.ws, 'G16')));
    diff(t.month, 'Gastos', t.expenses, cents(cell(t.ws, 'G17')));
    diff(t.month, 'Ahorro', saved, cents(cell(t.ws, 'G18')));
    diff(t.month, 'Inversión', invested, cents(cell(t.ws, 'G19')));
    diff(t.month, 'Deuda', 0, cents(cell(t.ws, 'G20')));
    diff(t.month, 'Restante', t.income - t.bills - t.expenses - saved - invested, cents(cell(t.ws, 'G21')));
  }
  plan.goals.forEach((g, i) => {
    const e = expectedGoal[i];
    if (e !== null) diff('', `Meta ${g.name}`, g.initial + sum(plan.contributions.filter((c) => c.kind === 'savings' && c.target === i).map((c) => c.amount)), e);
  });
  plan.investments.forEach((v, i) => {
    const e = expectedInv[i];
    if (e !== null) diff('', `Inversión ${v.name}`, v.initial + sum(plan.contributions.filter((c) => c.kind === 'investment' && c.target === i).map((c) => c.amount)), e);
  });

  return plan;
}

// --- Copia JSON ---

export type BackupFile = { app: 'mny'; schema: number; tables: Record<string, Record<string, string | number | null>[]> };

/** Valida una copia exportada por la app. `tables` = tablas esperadas; `maxSchema` = user_version actual. */
export function validateBackup(json: unknown, tables: readonly string[], maxSchema: number): BackupFile {
  const j = json as { app?: unknown; schema?: unknown; tables?: Record<string, unknown> } | null;
  if (!j || typeof j !== 'object' || j.app !== 'mny') throw new Error('No parece una copia de mny');
  if (typeof j.schema !== 'number' || !Number.isInteger(j.schema) || j.schema < 0) throw new Error('La copia no indica su versión');
  if (j.schema > maxSchema) throw new Error('La copia es de una versión más nueva de la app');
  if (!j.tables || typeof j.tables !== 'object') throw new Error('La copia no contiene tablas');
  for (const t of tables) {
    const rows = j.tables[t];
    if (!Array.isArray(rows)) throw new Error(`Falta la tabla "${t}" en la copia`);
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`Fila inválida en "${t}"`);
      for (const [k, v] of Object.entries(row)) {
        // La clave acaba en una sentencia SQL: solo identificadores.
        if (!/^\w+$/.test(k) || !(v === null || typeof v === 'string' || typeof v === 'number')) throw new Error(`Dato inválido en "${t}"`);
      }
    }
  }
  return j as BackupFile;
}
