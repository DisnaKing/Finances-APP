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
  investments: { name: string; initial: number; monthly: number; current_value: number; value_date: string | null }[]; // value_date null = sin valorar
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
/** Clave de comparación de categorías: sin acentos ni mayúsculas (NFD sin marcas). */
export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
// Mismas categorías "necesidades" que la semilla (schema.ts); el resto son deseos.
const NEEDS_CATS = new Set(['mercado', 'transporte', 'salud', 'hogar', 'educación', 'mascotas'].map(norm));
const KINDS: Record<string, K> = { necesidades: 'needs', deseos: 'wants', ahorros: 'savings' };
const SETTINGS_KEYS = ['currency', 'pct_needs', 'pct_wants', 'pct_savings']; // semilla de schema.ts
const lc = (s: string) => s.toLowerCase();

const str = (v: unknown) => (v == null ? '' : String(v).trim());
/** Número o texto con importe ("1.234,56 €", "5 %"); el último separador es el decimal. */
const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.replace(/[\s€$£¥%]/g, ''); // \s incluye NBSP
  if (!/^[+-]?[\d.,]+$/.test(s)) return null;
  const d = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  if (d >= 0) s = s.slice(0, d).replace(/[.,]/g, '') + '.' + s.slice(d + 1);
  return s !== '.' && Number.isFinite(Number(s)) ? Number(s) : null;
};
const cents = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.round(n * 100);
};
const ymd = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
    ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    : null;
};
/** Serie de Excel (>= 367; días desde 1899-12-30, o 1904 si `d1904`), Date, ISO o DD/MM/AAAA | D/M/AA -> YYYY-MM-DD. */
const iso = (v: unknown, d1904 = false): string | null => {
  if (typeof v === 'number') {
    if (!(v >= 367 && v < 100000)) return null; // series bajas: casi seguro un número, no una fecha
    return new Date((Math.floor(v) + (d1904 ? 1462 : 0) - 25569) * 86400000).toISOString().slice(0, 10);
  }
  if (v instanceof Date) return isNaN(+v) ? null : v.toISOString().slice(0, 10);
  if (typeof v !== 'string') return null;
  const t = v.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/.exec(t);
  return m ? ymd(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]) : null;
};
const isPaid = (v: unknown) => v === true || (typeof v === 'string' && /^(✓|✔|☑|✅|x|true|1)$/i.test(v.trim()));
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Convierte el libro en un plan de importación. Lanza NOT_BUDGET si falta una hoja o no hay meses con datos. */
export function parseWorkbook(wb: WorkBook, now: string = localToday()): ImportPlan {
  const sheets = new Map(wb.SheetNames.map((n) => [n.trim().toUpperCase(), wb.Sheets[n]]));
  const names = new Map<WorkSheet, string>();
  const get = (n: string) => {
    const s = sheets.get(n);
    if (!s) throw new Error(NOT_BUDGET);
    names.set(s, n);
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
  const warn = (s: string) => {
    if (!plan.warnings.includes(s)) plan.warnings.push(s);
  };
  const d1904 = !!wb.Workbook?.WBProps?.date1904;

  /** Valor de la celda; las celdas de error (#REF!, #DIV/0!...) se ignoran con aviso. */
  const cell = (ws: WorkSheet, a: string): unknown => {
    const c = ws[a];
    if (c?.t === 'e') {
      warn(`${names.get(ws)}!${a}: celda con error, ignorada`);
      return undefined;
    }
    return c?.v;
  };
  const money = (ws: WorkSheet, a: string, ctx: string) => {
    const v = cell(ws, a);
    const c = cents(v);
    if (c === null && str(v)) warn(`${ctx}: importe no válido en ${names.get(ws)}!${a}, ignorado`);
    return c;
  };
  const dateOf = (ws: WorkSheet, a: string) => iso(cell(ws, a), d1904);
  const dt = (ws: WorkSheet, a: string, ctx: string) => {
    const v = cell(ws, a);
    const d = iso(v, d1904);
    if (d === null && str(v)) warn(`${ctx}: fecha no válida en ${names.get(ws)}!${a}, ignorada`);
    return d;
  };

  const y = num(cell(debtWs, 'B4'));
  const valid = y !== null && Number.isInteger(y) && y >= 2000 && y <= 2100;
  if (!valid) warn(`Año no indicado o no válido (${DEBT}!B4), se usa 2026`);
  const year = valid ? y : 2026;
  const cur = cell(debtWs, 'B5');
  const curText = typeof cur === 'string' ? cur.trim() : '';
  if (curText.length > 4) warn(`Moneda "${curText}" no válida (1 a 4 caracteres), se usa €`);
  plan.currency = curText ? (curText.length > 4 ? '€' : curText) : null;

  // --- Meses ---
  type Group = { concept: string; kind: K; budget: number; first: string; last: string; lastI: number };
  const groups: Group[] = [];
  const open = new Map<string, Group>(); // última factura abierta de cada concepto
  const sheetTotals: { month: string; ws: WorkSheet; income: number; bills: number; expenses: number }[] = [];
  const cats = new Map<string, string>();

  monthWs.forEach((ws, i) => {
    const month = `${year}-${String(i + 1).padStart(2, '0')}`;
    const incomes: ImportPlan['incomes'] = [];
    for (let r = 5; r <= 9; r++) {
      const concept = str(cell(ws, `E${r}`));
      const ctx = `${month} ingreso "${concept}"`;
      if (concept) incomes.push({ month, concept, budget: money(ws, `F${r}`, ctx) ?? 0, amount: money(ws, `G${r}`, ctx) ?? 0 });
    }

    const seen = new Map<string, number>(); // repetidos del mismo concepto dentro del mes
    const bills: { key: string; concept: string; kind: K; budget: number; amount: number | null; date: string; paid: 0 | 1 }[] = [];
    for (let r = 26; r <= 41; r++) {
      const concept = str(cell(ws, `B${r}`));
      if (!concept) continue;
      const ctx = `${month} factura "${concept}"`;
      const kindText = str(cell(ws, `E${r}`));
      let kind: K = KINDS[lc(kindText)] ?? 'needs';
      if (kindText && !KINDS[lc(kindText)]) warn(`${month}: tipo de factura desconocido "${kindText}", se usa Necesidades`), (kind = 'needs');
      const n = (seen.get(lc(concept)) ?? 0) + 1;
      seen.set(lc(concept), n);
      const budget = money(ws, `C${r}`, ctx) ?? 0;
      const real = money(ws, `D${r}`, ctx);
      const paid = isPaid(cell(ws, `A${r}`)) ? 1 : 0;
      // Sin importe real solo hay pago si está marcada (como setBillPaid: importe = presupuesto); un 0 sin marcar no es un pago.
      const amount = real === null ? (paid ? budget : null) : real !== 0 || paid ? real : null;
      bills.push({ key: `${lc(concept)}#${n}`, concept, kind, budget, amount, date: dt(ws, `F${r}`, ctx) ?? `${month}-01`, paid });
    }

    const expenses: ImportPlan['expenses'] = [];
    for (let r = 26; r <= 45; r++) {
      const concept = str(cell(ws, `I${r}`));
      const amount = money(ws, `J${r}`, `${month} gasto (fila ${r})`);
      if (!amount) continue;
      if (!concept) {
        warn(`${month}: fila ${r} con importe pero sin concepto, ignorada`);
        continue;
      }
      let date = dt(ws, `L${r}`, `${month} gasto "${concept}"`) ?? `${month}-01`;
      if (date.slice(0, 7) !== month) {
        warn(`${month}: el gasto "${concept}" tiene fecha de otro mes (${date}), se pone el día 1`);
        date = `${month}-01`;
      }
      const category = str(cell(ws, `K${r}`)).normalize('NFC') || null;
      if (category && !cats.has(norm(category))) cats.set(norm(category), category);
      expenses.push({ date, concept, amount, category });
    }

    if (!incomes.some((x) => x.amount) && !bills.some((b) => b.amount !== null) && !expenses.length) return; // mes plantilla
    plan.months.push(month);
    plan.incomes.push(...incomes);
    plan.expenses.push(...expenses);
    for (const b of bills) {
      // Misma factura si el mes anterior tenía el concepto con igual tipo y presupuesto; si no, empieza otra.
      let g = open.get(b.key);
      if (g && g.lastI === i - 1 && g.kind === b.kind && g.budget === b.budget) Object.assign(g, { concept: b.concept, last: month, lastI: i });
      else {
        g = { concept: b.concept, kind: b.kind, budget: b.budget, first: month, last: month, lastI: i };
        groups.push(g);
        open.set(b.key, g);
      }
      if (b.amount !== null) plan.payments.push({ bill: groups.indexOf(g), month, amount: b.amount, date: b.date, paid: b.paid });
    }
    sheetTotals.push({ month, ws, income: sum(incomes.map((x) => x.amount)), bills: sum(bills.map((b) => b.amount ?? 0)), expenses: sum(expenses.map((e) => e.amount)) });
  });

  if (!plan.months.length) throw new Error(NOT_BUDGET);
  const lastMonth = plan.months[plan.months.length - 1];
  plan.bills = groups.map((g) => ({
    concept: g.concept, kind: g.kind, budget: g.budget, start_month: g.first, end_month: g.last === lastMonth ? null : g.last,
  }));
  plan.categoriesNeeded = [...cats.entries()].map(([k, name]) => ({ name, kind: NEEDS_CATS.has(k) ? 'needs' : 'wants' }));

  // --- Metas de ahorro ---
  const expectedGoal: (number | null)[] = [];
  for (let r = 9; r <= 18; r++) {
    const name = str(cell(goalWs, `A${r}`));
    if (!name) continue;
    const ctx = `Meta "${name}"`;
    plan.goals.push({ name, target: money(goalWs, `B${r}`, ctx) ?? 0, min_monthly: money(goalWs, `C${r}`, ctx) ?? 0, initial: money(goalWs, `D${r}`, ctx) ?? 0 });
    expectedGoal.push(cents(cell(goalWs, `E${r}`)));
  }

  // --- Inversiones ---
  const expectedInv: (number | null)[] = [];
  for (let r = 11; r <= 20; r++) {
    const name = str(cell(invWs, `A${r}`));
    if (!name) continue;
    const ctx = `Inversión "${name}"`;
    const value = money(invWs, `E${r}`, ctx);
    plan.investments.push({
      name, initial: money(invWs, `B${r}`, ctx) ?? 0, monthly: money(invWs, `C${r}`, ctx) ?? 0,
      current_value: value ?? 0, value_date: value === null ? null : now, // sin valor actual = «Sin valorar»
    });
    expectedInv.push(cents(cell(invWs, `D${r}`)));
  }

  // --- Registros de aportaciones ---
  const register = (ws: WorkSheet, from: number, to: number, [cd, cn, ca]: string[], kind: 'savings' | 'investment', targets: { name: string }[]) => {
    const label = kind === 'savings' ? 'Ahorro' : 'Inversión';
    const byName = new Map(targets.map((t, i) => [norm(t.name), i]));
    for (let r = from; r <= to; r++) {
      const name = str(cell(ws, `${cn}${r}`));
      const amount = money(ws, `${ca}${r}`, label);
      if (!amount) continue;
      const date = dateOf(ws, `${cd}${r}`);
      const target = byName.get(norm(name));
      if (target === undefined) warn(`${label}: "${name || '(sin nombre)'}" no coincide con ninguna ${kind === 'savings' ? 'meta' : 'inversión'}, aportación ignorada`);
      else if (!date) warn(`${label}: aportación a "${name}" sin fecha válida, ignorada`);
      else plan.contributions.push({ date, kind, target, amount });
    }
  };
  register(goalWs, 9, 38, ['L', 'M', 'N'], 'savings', plan.goals);
  register(invWs, 11, 40, ['I', 'J', 'K'], 'investment', plan.investments);

  const outside = plan.contributions.filter((c) => !plan.months.includes(c.date.slice(0, 7))).length;
  if (outside) warn(`${outside} aportaciones con fecha fuera de los meses importados (se importan igualmente)`);

  // La valoración nunca es anterior a su última aportación.
  plan.contributions.filter((c) => c.kind === 'investment').forEach((c) => {
    const inv = plan.investments[c.target];
    if (inv.value_date !== null && c.date > inv.value_date) inv.value_date = c.date;
  });

  // --- Deudas (puede estar vacía) ---
  for (let r = 14; r <= 23; r++) {
    const name = str(cell(debtWs, `A${r}`));
    if (!name) continue;
    const ctx = `Deuda "${name}"`;
    const rv = cell(debtWs, `D${r}`);
    const rate = num(rv);
    if (rate === null && str(rv)) warn(`${ctx}: tasa no válida en ${DEBT}!D${r}, se usa 0`);
    plan.debts.push({
      name, principal: money(debtWs, `B${r}`, ctx) ?? 0, min_payment: money(debtWs, `C${r}`, ctx) ?? 0,
      annual_rate: String(debtWs[`D${r}`]?.z ?? '').includes('%') ? (rate ?? 0) * 100 : rate ?? 0, // 5% se guarda como 0,05
      start_date: dt(debtWs, `E${r}`, ctx) ?? `${plan.months[0]}-01`,
    });
  }
  // ponytail: heurística; las columnas F+ de las filas de deudas no están documentadas.
  const paidByMonth = Object.keys(debtWs).some((a) => {
    const m = /^([A-Z]+)(\d+)$/.exec(a);
    return !!m && (m[1].length > 1 || m[1] > 'E') && +m[2] >= 14 && +m[2] <= 23 && debtWs[a]?.t === 'n' && debtWs[a].v !== 0;
  });
  if (paidByMonth) warn('La hoja de deudas tiene pagos reales por mes: no se importan, la app usa el pago mínimo');

  // --- Discrepancias: lo calculado con el plan frente a los totales del Excel (si el Excel los tiene) ---
  const diff = (month: string, field: string, calc: number, sheet: number | null) => {
    if (sheet !== null && sheet !== calc) plan.discrepancies.push({ month, field, diff: calc - sheet });
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
        // La clave acaba en una sentencia SQL: solo identificadores. Importes en céntimos = enteros (annual_rate es el único REAL).
        const okNum = typeof v === 'number' && Number.isFinite(v) && (k === 'annual_rate' || Number.isInteger(v));
        if (!/^\w+$/.test(k) || !(v === null || typeof v === 'string' || okNum)) throw new Error(`Dato inválido en "${t}"`);
      }
    }
  }
  if (tables.includes('settings')) {
    const have = new Set((j.tables.settings as { key?: unknown }[]).map((r) => r.key));
    for (const k of SETTINGS_KEYS) if (!have.has(k)) throw new Error(`Falta el ajuste "${k}" en la copia`);
  }
  return j as BackupFile;
}
