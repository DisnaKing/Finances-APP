// Cálculos puros en céntimos (SPEC "Reglas de cálculo"). Sin imports: corre bajo `node --test`.

export type MonthInput = {
  incomes: { amount: number }[];
  bills: { amount: number | null }[];
  expenses: { amount: number }[];
  contributions: { kind: 'savings' | 'investment' | 'debt'; amount: number }[];
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function monthSummary(d: MonthInput) {
  const income = sum(d.incomes.map((i) => i.amount));
  const billsSpent = sum(d.bills.map((b) => b.amount ?? 0));
  const expensesSpent = sum(d.expenses.map((e) => e.amount));
  const byKind = (k: string) => sum(d.contributions.filter((c) => c.kind === k).map((c) => c.amount));
  const saved = byKind('savings');
  const invested = byKind('investment');
  const debtPaid = byKind('debt');
  const spent = billsSpent + expensesSpent;
  const remaining = income - spent - saved - invested - debtPaid;

  return { income, billsSpent, expensesSpent, spent, saved, invested, debtPaid, remaining };
}

/** Factura visible en el mes: dentro de [start, end] o con pago ese mes. */
export function billVisible(
  b: { start_month: string; end_month: string | null },
  month: string,
  hasPayment: boolean,
): boolean {
  return hasPayment || (b.start_month <= month && (b.end_month === null || b.end_month >= month));
}

// --- Ahorro e inversión ---

/** Meta de ahorro: total = inicial + aportaciones; `monthsLeft` null si no hay aportación mínima o ya se alcanzó. */
export function goalStats(g: { target: number; min_monthly: number; initial: number }, contribSum: number) {
  const total = g.initial + contribSum;
  const left = Math.max(g.target - total, 0);
  const progress = g.target > 0 ? Math.min(total / g.target, 1) : 0;
  const monthsLeft = g.min_monthly > 0 && left > 0 ? Math.ceil(left / g.min_monthly) : null;
  return { total, left, progress, monthsLeft };
}

/**
 * Cuenta remunerada. Cada mes se aplica TAE/12 sobre el saldo de ESE mes (no sobre el total ni anual de golpe):
 * interés del mes = round(TAE/100/12 · saldo medio del mes), donde el saldo medio pondera cada aportación por los días
 * que lleva en la cuenta (una aportación el día d cuenta desde ese día). El interés se abona el ÚLTIMO día del mes:
 * solo se cuenta si ese día ya ha llegado (≤ `untilDate`) y entra en el saldo del mes siguiente (compuesto).
 * Empieza en el mes de la primera aportación, con `initial` ya en la cuenta. `untilDate`: 'YYYY-MM-DD' (hoy).
 */
export type DatedAmount = { date: string; amount: number };
export function accruedInterest(rate: number, initial: number, contribs: DatedAmount[], untilDate: string): number {
  if (!(rate > 0) || contribs.length === 0) return 0;
  const cs = [...contribs].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  const r = rate / 100 / 12;
  let balance = initial;
  let interest = 0;
  let i = 0;
  for (let m = cs[0].date.slice(0, 7); ; m = addM(m, 1)) {
    const days = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();
    if (`${m}-${String(days).padStart(2, '0')}` > untilDate) break; // el abono del último día aún no ha llegado
    let bal = balance;
    let sum = 0;
    for (let d = 1; d <= days; d++) {
      while (i < cs.length && cs[i].date.slice(0, 7) === m && Number(cs[i].date.slice(8, 10)) <= d) bal += cs[i++].amount;
      sum += bal;
    }
    const x = sum > 0 ? Math.round((r * sum) / days) : 0;
    interest += x;
    balance = bal + x;
  }
  return interest;
}

/** Interés estimado de los próximos 12 meses sobre un saldo, sin nuevas aportaciones. */
export const yearlyInterest = (rate: number, balance: number): number => {
  const r = rate / 100 / 12;
  let b = balance;
  let t = 0;
  for (let i = 0; i < 12; i++) {
    const x = Math.round(b * r);
    t += x;
    b += x;
  }
  return t;
};

/** Inversión: aportado = inicial + aportaciones; rendimiento = valor actual − aportado. */
export function investmentStats(i: { initial: number; current_value: number }, contribSum: number) {
  const contributed = i.initial + contribSum;
  const gain = i.current_value - contributed;
  return { contributed, gain, gainPct: contributed > 0 ? gain / contributed : 0 };
}

/** Suma de inversiones ya calculadas (aportado/valor) y rendimiento total. */
export function investmentTotals(xs: { contributed: number; value: number }[]) {
  const contributed = sum(xs.map((x) => x.contributed));
  const value = sum(xs.map((x) => x.value));
  const gain = value - contributed;
  return { contributed, value, gain, gainPct: contributed > 0 ? gain / contributed : 0 };
}

/** Valor mostrado: sin valorar = lo aportado; valorado = valor a esa fecha + aportaciones posteriores (date > value_date). */
export function investmentValue(
  i: { current_value: number; value_date: string | null },
  contributed: number,
  contribAfter: number,
): number {
  return i.value_date === null ? contributed : i.current_value + contribAfter;
}

// --- Deudas (bola de nieve). r = interés mensual = annual_rate / 100 / 12 ---

export type DebtInput = { principal: number; min_payment: number; annual_rate: number; start_date: string };
export type DebtRow = { month: string; payment: number; interest: number; balance: number };

const addM = (m: string, n: number): string => {
  const [y, mo] = m.split('-').map(Number);
  const t = y * 12 + (mo - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

/** Reactivar una factura terminada: si acabó el mes actual o el anterior se reabre; si es más antigua, se copia (el hueco no se rellena). */
export const reactivationPlan = (endMonth: string, current: string): 'reopen' | 'copy' => (endMonth >= addM(current, -1) ? 'reopen' : 'copy');

/** Meses para liquidar `principal` pagando `payment` al mes (redondeado arriba). null = nunca (pago ≤ interés, redondeado como en el cuadro). */
export function nper(r: number, payment: number, principal: number): number | null {
  if (principal <= 0) return 0;
  if (payment <= 0) return null;
  if (r === 0) return Math.ceil(principal / payment);
  if (payment <= Math.round(principal * r)) return null;
  return Math.ceil(-Math.log(1 - (r * principal) / payment) / Math.log(1 + r) - 1e-9);
}

/** Pagos reales por mes; los anteriores al mes de inicio se imputan al primer mes. */
export function foldPaid(d: DebtInput, paid: Record<string, number>): Record<string, number> {
  const start = d.start_date.slice(0, 7);
  const out: Record<string, number> = {};
  for (const [m, v] of Object.entries(paid)) {
    const k = m < start ? start : m;
    out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

/** Cuadro de amortización desde el mes de start_date. Mes con aportaciones reales → su suma; si no, min_payment. Máx. 600 filas. */
export function debtSchedule(d: DebtInput, paidByMonth: Record<string, number>, untilMonth?: string): DebtRow[] {
  const r = d.annual_rate / 100 / 12;
  const paid = foldPaid(d, paidByMonth);
  const rows: DebtRow[] = [];
  let balance = Math.max(d.principal, 0);
  let month = d.start_date.slice(0, 7);
  while (balance > 0 && rows.length < 600 && (untilMonth === undefined || month <= untilMonth)) {
    const interest = Math.round(balance * r);
    const owed = balance + interest;
    const payment = Math.min(paid[month] ?? d.min_payment, owed);
    balance = Math.max(owed - payment, 0);
    rows.push({ month, payment, interest, balance });
    month = addM(month, 1);
  }
  return rows;
}

/** ¿La deuda aporta su pago mínimo al plan del mes `month`? Sí si el cuadro tiene fila en ese mes. */
export const debtActiveIn = (d: DebtInput, paidByMonth: Record<string, number>, month: string) =>
  debtSchedule(d, paidByMonth, month).some((x) => x.month === month);

/**
 * Estado a `cur`. Meses anteriores: pago real o, si no, mínimo (como el Excel). Mes en curso: solo cuentan pagos REALES.
 * currentBalance = saldo a fin del mes anterior (o principal) + interés de este mes − pagos reales de este mes (mín. 0);
 * antes del inicio = principal. Abierta ⇔ currentBalance > 0. monthsLeft cuenta desde este mes si aún no hay pago real, si no desde el siguiente.
 */
export function debtStats(d: DebtInput, paidByMonth: Record<string, number>, cur: string) {
  const r = d.annual_rate / 100 / 12;
  const start = d.start_date.slice(0, 7);
  const principal = Math.max(d.principal, 0);
  const real = foldPaid(d, paidByMonth)[cur] ?? 0;
  let currentBalance = principal;
  let basis = principal; // saldo sobre el que corre NPER
  let base = start; // primer mes de pago restante
  if (cur >= start) {
    const rows = debtSchedule(d, paidByMonth, addM(cur, -1));
    const prev = rows.length ? rows[rows.length - 1].balance : principal;
    currentBalance = Math.max(prev + Math.round(prev * r) - real, 0);
    basis = real > 0 ? currentBalance : prev;
    base = real > 0 ? addM(cur, 1) : cur;
  }
  const paidTotal = sum(Object.values(paidByMonth));
  const paidPct = d.principal > 0 ? Math.min(paidTotal / d.principal, 1) : 0;
  const monthsLeft = nper(r, d.min_payment, basis);
  const freeMonth = monthsLeft === null || monthsLeft === 0 ? null : addM(base, monthsLeft - 1);
  return { currentBalance, paidTotal, paidPct, monthsLeft, freeMonth };
}

/** Totales + orden bola de nieve (menor saldo primero, empate por id, liquidadas al final). `order` = ids. */
export function debtSummary(items: { id: number; min_payment: number; currentBalance: number; freeMonth: string | null }[]) {
  const open = items.filter((x) => x.currentBalance > 0);
  const byBalance = (a: { id: number; currentBalance: number }, b: { id: number; currentBalance: number }) =>
    a.currentBalance - b.currentBalance || a.id - b.id;
  const freeMonth = open.some((x) => x.freeMonth === null)
    ? null
    : items.reduce<string | null>((m, x) => (x.freeMonth !== null && (m === null || x.freeMonth > m) ? x.freeMonth : m), null);
  return {
    totalBalance: sum(items.map((x) => x.currentBalance)),
    totalMin: sum(open.map((x) => x.min_payment)),
    freeMonth,
    order: [...open.sort(byBalance), ...items.filter((x) => x.currentBalance <= 0).sort(byBalance)].map((x) => x.id),
  };
}

export type MonthSummary = ReturnType<typeof monthSummary>;
export type YearRow = { month: number; income: number; spent: number; saved: number; invested: number; debtPaid: number; remaining: number };

/** Resumen anual: una fila por mes (`month` = 1..12 según el orden recibido) y, aparte, la fila de totales. `spent` excluye inversión. */
export function yearSummary(months: MonthSummary[]): { rows: YearRow[]; total: Omit<YearRow, 'month'> } {
  const rows = months.map((s, i) => ({
    month: i + 1,
    income: s.income,
    spent: s.spent,
    saved: s.saved,
    invested: s.invested,
    debtPaid: s.debtPaid,
    remaining: s.remaining,
  }));
  const t = (k: Exclude<keyof YearRow, 'month'>) => sum(rows.map((r) => r[k]));
  return { rows, total: { income: t('income'), spent: t('spent'), saved: t('saved'), invested: t('invested'), debtPaid: t('debtPaid'), remaining: t('remaining') } };
}

export type Totals = Omit<YearRow, 'month'>;

/** Total de todos los años: suma de las filas de total de cada año. */
export function grandTotal(years: Totals[]): Totals {
  const t = (k: keyof Totals) => sum(years.map((y) => y[k]));
  return { income: t('income'), spent: t('spent'), saved: t('saved'), invested: t('invested'), debtPaid: t('debtPaid'), remaining: t('remaining') };
}
