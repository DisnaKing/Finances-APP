// Cálculos puros en céntimos (SPEC "Reglas de cálculo"). Sin imports: corre bajo `node --test`.

export type Kind = 'needs' | 'wants' | 'savings';
export type Pct = { needs: number; wants: number; savings: number };
type BA = { budget: number; actual: number };

export type MonthInput = {
  incomes: { budget: number; amount: number }[];
  bills: { budget: number; kind: Kind; amount: number | null }[];
  expenses: { amount: number; kind: 'needs' | 'wants' | null }[];
  contributions: { kind: 'savings' | 'investment' | 'debt'; amount: number }[];
  pct: Pct;
  plan?: { savings: number; investment: number; debt: number };
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function monthSummary(d: MonthInput) {
  const income = sum(d.incomes.map((i) => i.amount));
  const incomeBudget = sum(d.incomes.map((i) => i.budget));
  const billsBudget = sum(d.bills.map((b) => b.budget));
  const billsSpent = sum(d.bills.map((b) => b.amount ?? 0));
  const expensesSpent = sum(d.expenses.map((e) => e.amount));
  const byKind = (k: string) => sum(d.contributions.filter((c) => c.kind === k).map((c) => c.amount));
  const saved = byKind('savings');
  const invested = byKind('investment');
  const debtPaid = byKind('debt');
  const spent = billsSpent + expensesSpent;
  const remaining = income - spent - saved - invested - debtPaid;

  const billsOf = (k: Kind) => sum(d.bills.filter((b) => b.kind === k).map((b) => b.amount ?? 0));
  const expOf = (k: 'needs' | 'wants' | null) => sum(d.expenses.filter((e) => e.kind === k).map((e) => e.amount));
  const budget = (k: Kind) => Math.round((income * d.pct[k]) / 100);

  const split: Record<Kind, BA> = {
    needs: { budget: budget('needs'), actual: billsOf('needs') + expOf('needs') + debtPaid },
    wants: { budget: budget('wants'), actual: billsOf('wants') + expOf('wants') + expOf(null) },
    savings: { budget: budget('savings'), actual: billsOf('savings') + saved + invested },
  };

  const fixedNW = sum(d.bills.filter((b) => b.kind !== 'savings').map((b) => b.budget));
  const plan = d.plan ?? { savings: 0, investment: 0, debt: 0 };
  const rows: Record<'bills' | 'expenses' | 'savings' | 'investment' | 'debt', BA> = {
    bills: { budget: billsBudget, actual: billsSpent },
    expenses: { budget: Math.max(split.needs.budget + split.wants.budget - fixedNW, 0), actual: expensesSpent },
    savings: { budget: plan.savings, actual: saved },
    investment: { budget: plan.investment, actual: invested },
    debt: { budget: plan.debt, actual: debtPaid },
  };

  return { income, incomeBudget, billsBudget, billsSpent, expensesSpent, spent, saved, invested, debtPaid, remaining, split, rows };
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

/** Meses para liquidar `principal` pagando `payment` al mes (redondeado arriba). null = nunca (pago ≤ interés). */
export function nper(r: number, payment: number, principal: number): number | null {
  if (principal <= 0) return 0;
  if (payment <= 0) return null;
  if (r === 0) return Math.ceil(principal / payment);
  if (payment <= principal * r) return null;
  return Math.ceil(-Math.log(1 - (r * principal) / payment) / Math.log(1 + r) - 1e-9);
}

/** Cuadro de amortización desde el mes de start_date. Mes con aportaciones reales → su suma; si no, min_payment. Máx. 600 filas. */
export function debtSchedule(d: DebtInput, paidByMonth: Record<string, number>, untilMonth?: string): DebtRow[] {
  const r = d.annual_rate / 100 / 12;
  const rows: DebtRow[] = [];
  let balance = Math.max(d.principal, 0);
  let month = d.start_date.slice(0, 7);
  while (balance > 0 && rows.length < 600 && (untilMonth === undefined || month <= untilMonth)) {
    const interest = Math.round(balance * r);
    const owed = balance + interest;
    const payment = Math.min(paidByMonth[month] ?? d.min_payment, owed);
    balance = Math.max(owed - payment, 0);
    rows.push({ month, payment, interest, balance });
    month = addM(month, 1);
  }
  return rows;
}

/** Saldo al cierre de `currentMonth`, % pagado, meses restantes (desde el saldo actual con min_payment) y mes libre de deuda. */
export function debtStats(d: DebtInput, paidByMonth: Record<string, number>, currentMonth: string) {
  const rows = debtSchedule(d, paidByMonth, currentMonth);
  const currentBalance = rows.length ? rows[rows.length - 1].balance : Math.max(d.principal, 0);
  const paidTotal = sum(Object.values(paidByMonth));
  const paidPct = d.principal > 0 ? Math.min(paidTotal / d.principal, 1) : 0;
  const monthsLeft = nper(d.annual_rate / 100 / 12, d.min_payment, currentBalance);
  const freeMonth = monthsLeft === null ? null : addM(currentMonth, monthsLeft);
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
