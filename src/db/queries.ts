import type { SQLiteDatabase } from 'expo-sqlite';
import { billVisible, type Kind, type MonthInput, type Pct } from '@/src/lib/calc';
import { addMonths, monthRange, today } from '@/src/lib/month';

// Solo runAsync/getAllAsync/withTransactionAsync: withExclusiveTransactionAsync usa otra conexión
// con foreign_keys OFF y no dispararía las cascadas.

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

/** Si el mes no tiene ingresos, crea Sueldo/Ingresos extra/Otros con el presupuesto del último mes anterior. */
export async function ensureIncomes(db: SQLiteDatabase, month: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    const n = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM income WHERE month = ?', month);
    if (n && n.n > 0) return;
    for (const concept of ['Sueldo', 'Ingresos extra', 'Otros']) {
      const prev = await db.getFirstAsync<{ budget: number }>(
        'SELECT budget FROM income WHERE concept = ? AND month < ? ORDER BY month DESC, id DESC LIMIT 1',
        concept,
        month,
      );
      await db.runAsync(
        'INSERT INTO income (month, concept, budget, amount) VALUES (?, ?, ?, 0)',
        month,
        concept,
        prev?.budget ?? 0,
      );
    }
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

/** "Dejar de repetir desde este mes": end_month = mes anterior; si queda antes del inicio y sin pagos, se borra. */
export async function endBill(db: SQLiteDatabase, id: number, month: string): Promise<void> {
  await db.withTransactionAsync(async () => {
    const end = addMonths(month, -1);
    const b = await db.getFirstAsync<{ start_month: string }>('SELECT start_month FROM bill WHERE id = ?', id);
    if (!b) return;
    const n = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM bill_payment WHERE bill_id = ?', id);
    if (end < b.start_month && (n?.n ?? 0) === 0) await db.runAsync('DELETE FROM bill WHERE id = ?', id);
    else await db.runAsync('UPDATE bill SET end_month = ? WHERE id = ?', end, id);
  });
}

export const deleteBill = (db: SQLiteDatabase, id: number) => db.runAsync('DELETE FROM bill WHERE id = ?', id); // cascada a bill_payment

/** Marca/desmarca pagada. Sin pago previo, lo crea con importe = presupuesto de la factura. */
export async function setBillPaid(db: SQLiteDatabase, billId: number, month: string, paid: boolean): Promise<void> {
  await db.withTransactionAsync(async () => {
    const r = await db.runAsync('UPDATE bill_payment SET paid = ? WHERE bill_id = ? AND month = ?', paid ? 1 : 0, billId, month);
    if (r.changes > 0) return;
    const b = await db.getFirstAsync<{ budget: number }>('SELECT budget FROM bill WHERE id = ?', billId);
    if (!b) return;
    await db.runAsync(
      'INSERT INTO bill_payment (bill_id, month, amount, date, paid) VALUES (?, ?, ?, ?, ?)',
      billId,
      month,
      b.budget,
      today(),
      paid ? 1 : 0,
    );
  });
}

/** Upsert del importe real del mes; conserva `paid`. */
export const setPaymentAmount = (db: SQLiteDatabase, billId: number, month: string, amount: number) =>
  db.runAsync(
    `INSERT INTO bill_payment (bill_id, month, amount, date, paid) VALUES (?, ?, ?, ?, 0)
     ON CONFLICT (bill_id, month) DO UPDATE SET amount = excluded.amount`,
    billId,
    month,
    amount,
    today(),
  );

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
