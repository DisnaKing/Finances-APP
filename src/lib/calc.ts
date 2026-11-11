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
