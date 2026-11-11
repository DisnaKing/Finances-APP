import type { SQLiteDatabase } from 'expo-sqlite';
import { billVisible, type Kind, type MonthInput, type Pct } from '@/src/lib/calc';
import { addMonths, currentMonth, monthOf, monthRange, today } from '@/src/lib/month';

// Solo runAsync/getAllAsync/withTransactionAsync: withExclusiveTransactionAsync usa otra conexión
// con foreign_keys OFF y no dispararía las cascadas.

// BEGIN/COMMIT sobre una única conexión: dos transacciones solapadas se pisan (la 2ª BEGIN falla y hace ROLLBACK
// de la 1ª). Se serializan en cola.
let queue: Promise<unknown> = Promise.resolve();
const tx = (db: SQLiteDatabase, fn: () => Promise<void>) => {
  const p = queue.then(() => db.withTransactionAsync(fn));
  queue = p.catch(() => {});
  return p;
};

/** Fecha de un pago nuevo: hoy si cae en `month`, si no el día 1. */
const paymentDate = (month: string) => (monthOf(today()) === month ? today() : `${month}-01`);

export type Category = { id: number; name: string; kind: 'needs' | 'wants' };
export type Income = { id: number; month: string; concept: string; budget: number; amount: number };
export type Bill = {
  id: number;
  concept: string;
  kind: Kind;
  budget: number;
  start_month: string;
  end_month: string | null;
  payment_amount: number | null; // null = sin pago este mes
  paid: number; // 0 | 1
};
export type Expense = {
  id: number;
  date: string;
  concept: string;
  amount: number;
  category_id: number | null;
  category_name: string | null;
  category_kind: 'needs' | 'wants' | null;
};

// --- Ajustes y categorías ---

export async function getSettings(db: SQLiteDatabase): Promise<{ pct: Pct; currency: string }> {
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings');
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    pct: { needs: Number(s.pct_needs), wants: Number(s.pct_wants), savings: Number(s.pct_savings) },
    currency: s.currency ?? '€',
  };
}

export const listCategories = (db: SQLiteDatabase) =>
  db.getAllAsync<Category>('SELECT id, name, kind FROM category ORDER BY sort, id');

// --- Ingresos ---

export const incomes = (db: SQLiteDatabase, month: string) =>
  db.getAllAsync<Income>('SELECT * FROM income WHERE month = ? ORDER BY id', month);

/**
 * Meses futuros: nada. Si el mes (<= actual) no tiene ingresos, copia concepto+presupuesto (importe 0) del último
 * mes anterior con ingresos; si no hay ninguno, crea Sueldo/Ingresos extra/Otros a 0. Ambas sentencias son
 * idempotentes (NOT EXISTS) y van en una transacción serializada.
 */
export async function ensureIncomes(db: SQLiteDatabase, month: string): Promise<void> {
  if (month > currentMonth()) return;
  await tx(db, async () => {
    await db.runAsync(
      `INSERT INTO income (month, concept, budget, amount)
       SELECT ?, concept, budget, 0 FROM income
       WHERE month = (SELECT MAX(month) FROM income WHERE month < ?)
         AND NOT EXISTS (SELECT 1 FROM income WHERE month = ?)
       ORDER BY id`,
      month,
      month,
      month,
    );
    await db.runAsync(
      `INSERT INTO income (month, concept, budget, amount)
       SELECT ?, c, 0, 0 FROM (SELECT 'Sueldo' AS c UNION ALL SELECT 'Ingresos extra' UNION ALL SELECT 'Otros')
       WHERE NOT EXISTS (SELECT 1 FROM income WHERE month = ?)`,
      month,
      month,
    );
  });
}

export const addIncome = (db: SQLiteDatabase, month: string, concept: string, budget: number, amount: number) =>
  db.runAsync('INSERT INTO income (month, concept, budget, amount) VALUES (?, ?, ?, ?)', month, concept, budget, amount);

export const updateIncome = (db: SQLiteDatabase, id: number, concept: string, budget: number, amount: number) =>
  db.runAsync('UPDATE income SET concept = ?, budget = ?, amount = ? WHERE id = ?', concept, budget, amount, id);

export const deleteIncome = (db: SQLiteDatabase, id: number) => db.runAsync('DELETE FROM income WHERE id = ?', id);

// --- Facturas ---

export async function listBillsForMonth(db: SQLiteDatabase, month: string): Promise<Bill[]> {
  const rows = await db.getAllAsync<Bill>(
    `SELECT b.id, b.concept, b.kind, b.budget, b.start_month, b.end_month,
            p.amount AS payment_amount, COALESCE(p.paid, 0) AS paid
     FROM bill b LEFT JOIN bill_payment p ON p.bill_id = b.id AND p.month = ?
     ORDER BY b.id`,
    month,
  );
  return rows.filter((b) => billVisible(b, month, b.payment_amount !== null));
}

export const addBill = (db: SQLiteDatabase, concept: string, kind: Kind, budget: number, start_month: string) =>
  db.runAsync('INSERT INTO bill (concept, kind, budget, start_month) VALUES (?, ?, ?, ?)', concept, kind, budget, start_month);

export const updateBill = (db: SQLiteDatabase, id: number, concept: string, kind: Kind, budget: number) =>
  db.runAsync('UPDATE bill SET concept = ?, kind = ?, budget = ? WHERE id = ?', concept, kind, budget, id);

/**
 * "Dejar de repetir desde este mes": borra los pagos de `month` en adelante y fija end_month = mes anterior
 * (nunca lo alarga); si queda antes del inicio y sin pagos, se borra la factura.
 */
export const endBill = (db: SQLiteDatabase, id: number, month: string) =>
  tx(db, async () => {
    const end = addMonths(month, -1);
    await db.runAsync('DELETE FROM bill_payment WHERE bill_id = ? AND month >= ?', id, month);
    await db.runAsync('UPDATE bill SET end_month = MIN(COALESCE(end_month, ?), ?) WHERE id = ?', end, end, id);
    await db.runAsync(
      'DELETE FROM bill WHERE id = ? AND end_month < start_month AND NOT EXISTS (SELECT 1 FROM bill_payment WHERE bill_id = ?)',
      id,
      id,
    );
  });

export const deleteBill = (db: SQLiteDatabase, id: number) => db.runAsync('DELETE FROM bill WHERE id = ?', id); // cascada a bill_payment

/** Marca/desmarca pagada. Sin pago previo, lo crea con importe = presupuesto de la factura (una sola sentencia). */
export const setBillPaid = (db: SQLiteDatabase, billId: number, month: string, paid: boolean) =>
  db.runAsync(
    `INSERT INTO bill_payment (bill_id, month, amount, date, paid) SELECT id, ?, budget, ?, ? FROM bill WHERE id = ?
     ON CONFLICT (bill_id, month) DO UPDATE SET paid = excluded.paid`,
    month,
    paymentDate(month),
    paid ? 1 : 0,
    billId,
  );

/** Upsert del importe real del mes; conserva `paid`. */
export const setPaymentAmount = (db: SQLiteDatabase, billId: number, month: string, amount: number) =>
  db.runAsync(
    `INSERT INTO bill_payment (bill_id, month, amount, date, paid) VALUES (?, ?, ?, ?, 0)
     ON CONFLICT (bill_id, month) DO UPDATE SET amount = excluded.amount`,
    billId,
    month,
    amount,
    paymentDate(month),
  );

/** Quita el pago de la factura en ese mes (deshace un check/importe accidental). */
export const deletePayment = (db: SQLiteDatabase, billId: number, month: string) =>
  db.runAsync('DELETE FROM bill_payment WHERE bill_id = ? AND month = ?', billId, month);

// --- Gastos ---

const EXPENSE_SELECT = `SELECT e.id, e.date, e.concept, e.amount, e.category_id,
  c.name AS category_name, c.kind AS category_kind
  FROM expense e LEFT JOIN category c ON c.id = e.category_id`;

export function listExpenses(db: SQLiteDatabase, month: string) {
  const [first, last] = monthRange(month);
  return db.getAllAsync<Expense>(`${EXPENSE_SELECT} WHERE e.date BETWEEN ? AND ? ORDER BY e.date DESC, e.id DESC`, first, last);
}

export const getExpense = (db: SQLiteDatabase, id: number) =>
  db.getFirstAsync<Expense>(`${EXPENSE_SELECT} WHERE e.id = ?`, id);

export const addExpense = (db: SQLiteDatabase, date: string, concept: string, amount: number, categoryId: number | null) =>
  db.runAsync('INSERT INTO expense (date, concept, amount, category_id) VALUES (?, ?, ?, ?)', date, concept, amount, categoryId);

export const updateExpense = (
  db: SQLiteDatabase,
  id: number,
  date: string,
  concept: string,
  amount: number,
  categoryId: number | null,
) =>
  db.runAsync('UPDATE expense SET date = ?, concept = ?, amount = ?, category_id = ? WHERE id = ?', date, concept, amount, categoryId, id);

export const deleteExpense = (db: SQLiteDatabase, id: number) => db.runAsync('DELETE FROM expense WHERE id = ?', id);

// --- Resumen ---

export function contributionsForMonth(db: SQLiteDatabase, month: string) {
  const [first, last] = monthRange(month);
  return db.getAllAsync<{ kind: 'savings' | 'investment' | 'debt'; amount: number }>(
    'SELECT kind, amount FROM contribution WHERE date BETWEEN ? AND ?',
    first,
    last,
  );
}

/** Todo lo que necesita `monthSummary` para el mes. `plan` = Σ metas/inversiones/deudas (vacío hasta la fase 2). */
export async function monthInput(db: SQLiteDatabase, month: string): Promise<MonthInput> {
  const [inc, bills, exps, contribs, { pct }, plan] = await Promise.all([
    incomes(db, month),
    listBillsForMonth(db, month),
    listExpenses(db, month),
    contributionsForMonth(db, month),
    getSettings(db),
    db.getFirstAsync<{ savings: number; investment: number; debt: number }>(
      `SELECT (SELECT COALESCE(SUM(min_monthly), 0) FROM savings_goal) AS savings,
              (SELECT COALESCE(SUM(monthly), 0) FROM investment) AS investment,
              (SELECT COALESCE(SUM(min_payment), 0) FROM debt) AS debt`,
    ),
  ]);
  return {
    incomes: inc,
    bills: bills.map((b) => ({ budget: b.budget, kind: b.kind, amount: b.payment_amount })),
    expenses: exps.map((e) => ({ amount: e.amount, kind: e.category_kind })),
    contributions: contribs,
    pct,
    plan: plan ?? undefined,
  };
}

// --- Ahorro e inversión ---

export type ContribKind = 'savings' | 'investment' | 'debt';
export type Goal = { id: number; name: string; target: number; min_monthly: number; initial: number; contrib: number };
export type Investment = {
  id: number;
  name: string;
  initial: number;
  monthly: number;
  current_value: number;
  value_date: string | null;
  contrib: number;
};
export type Contribution = { id: number; date: string; kind: ContribKind; target_id: number; amount: number; target_name: string | null };

const contribSum = (kind: ContribKind, table: string) =>
  `(SELECT COALESCE(SUM(amount), 0) FROM contribution WHERE kind = '${kind}' AND target_id = ${table}.id) AS contrib`;

export const listGoals = (db: SQLiteDatabase) =>
  db.getAllAsync<Goal>(`SELECT *, ${contribSum('savings', 'savings_goal')} FROM savings_goal ORDER BY id`);

export const addGoal = (db: SQLiteDatabase, name: string, target: number, min_monthly: number, initial: number) =>
  db.runAsync('INSERT INTO savings_goal (name, target, min_monthly, initial) VALUES (?, ?, ?, ?)', name, target, min_monthly, initial);

export const updateGoal = (db: SQLiteDatabase, id: number, name: string, target: number, min_monthly: number, initial: number) =>
  db.runAsync('UPDATE savings_goal SET name = ?, target = ?, min_monthly = ?, initial = ? WHERE id = ?', name, target, min_monthly, initial, id);

// contribution.target_id no es FK (polimórfico): la cascada es manual y en la misma transacción.
export const deleteGoal = (db: SQLiteDatabase, id: number) =>
  tx(db, async () => {
    await db.runAsync("DELETE FROM contribution WHERE kind = 'savings' AND target_id = ?", id);
    await db.runAsync('DELETE FROM savings_goal WHERE id = ?', id);
  });

export const listInvestments = (db: SQLiteDatabase) =>
  db.getAllAsync<Investment>(`SELECT *, ${contribSum('investment', 'investment')} FROM investment ORDER BY id`);

export const addInvestment = (db: SQLiteDatabase, name: string, initial: number, monthly: number) =>
  db.runAsync('INSERT INTO investment (name, initial, monthly) VALUES (?, ?, ?)', name, initial, monthly);

export const updateInvestment = (db: SQLiteDatabase, id: number, name: string, initial: number, monthly: number) =>
  db.runAsync('UPDATE investment SET name = ?, initial = ?, monthly = ? WHERE id = ?', name, initial, monthly, id);

export const deleteInvestment = (db: SQLiteDatabase, id: number) =>
  tx(db, async () => {
    await db.runAsync("DELETE FROM contribution WHERE kind = 'investment' AND target_id = ?", id);
    await db.runAsync('DELETE FROM investment WHERE id = ?', id);
  });

export const updateInvestmentValue = (db: SQLiteDatabase, id: number, cents: number, date: string) =>
  db.runAsync('UPDATE investment SET current_value = ?, value_date = ? WHERE id = ?', cents, date, id);

/** Aportaciones de un tipo (opcionalmente de un destino), más recientes primero. `target_name` solo para savings/investment. */
export const listContributions = (db: SQLiteDatabase, kind: ContribKind, targetId?: number) =>
  db.getAllAsync<Contribution>(
    `SELECT c.*, COALESCE(g.name, i.name) AS target_name FROM contribution c
     LEFT JOIN savings_goal g ON c.kind = 'savings' AND g.id = c.target_id
     LEFT JOIN investment i ON c.kind = 'investment' AND i.id = c.target_id
     WHERE c.kind = ?${targetId === undefined ? '' : ' AND c.target_id = ?'}
     ORDER BY c.date DESC, c.id DESC`,
    ...(targetId === undefined ? [kind] : [kind, targetId]),
  );

export const addContribution = (db: SQLiteDatabase, kind: ContribKind, targetId: number, date: string, amount: number) =>
  db.runAsync('INSERT INTO contribution (date, kind, target_id, amount) VALUES (?, ?, ?, ?)', date, kind, targetId, amount);

export const updateContribution = (db: SQLiteDatabase, id: number, date: string, amount: number) =>
  db.runAsync('UPDATE contribution SET date = ?, amount = ? WHERE id = ?', date, amount, id);

export const deleteContribution = (db: SQLiteDatabase, id: number) => db.runAsync('DELETE FROM contribution WHERE id = ?', id);
