import type { SQLiteDatabase } from 'expo-sqlite';
import { billVisible, debtActiveIn, reactivationPlan, type MonthInput } from '@/src/lib/calc';
import { norm, validateBackup, type ImportPlan } from '@/src/lib/importXlsx';
import { addMonths, currentMonth, monthOf, monthRange, today } from '@/src/lib/month';

// Solo runAsync/getAllAsync/withTransactionAsync: withExclusiveTransactionAsync usa otra conexión
// con foreign_keys OFF y no dispararía las cascadas.

// BEGIN/COMMIT sobre una única conexión: dos transacciones solapadas se pisan, y una escritura suelta
// durante una transacción se colaría dentro de ella. TODA escritura pasa por esta cola.
// Nunca llamar a write()/tx() dentro del callback de una tx (interbloqueo): usar db.runAsync directo.
let queue: Promise<unknown> = Promise.resolve();
const write = <T>(fn: () => Promise<T>): Promise<T> => {
  const p = queue.then(fn);
  queue = p.catch(() => {});
  return p;
};
const tx = (db: SQLiteDatabase, fn: () => Promise<void>) => write(() => db.withTransactionAsync(fn));

/** Fecha de un pago nuevo: hoy si cae en `month`, si no el día 1. */
const paymentDate = (month: string) => (monthOf(today()) === month ? today() : `${month}-01`);

export type Category = { id: number; name: string };
export type Income = { id: number; month: string; concept: string; budget: number; amount: number };
export type Bill = {
  id: number;
  concept: string;
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
};

// --- Ajustes y categorías ---

export async function getSettings(db: SQLiteDatabase): Promise<{ currency: string }> {
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings');
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { currency: s.currency ?? '€' };
}

export const listCategories = (db: SQLiteDatabase) =>
  db.getAllAsync<Category>('SELECT id, name FROM category ORDER BY sort, id');

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
  write(() => db.runAsync('INSERT INTO income (month, concept, budget, amount) VALUES (?, ?, ?, ?)', month, concept, budget, amount));

export const updateIncome = (db: SQLiteDatabase, id: number, concept: string, budget: number, amount: number) =>
  write(() => db.runAsync('UPDATE income SET concept = ?, budget = ?, amount = ? WHERE id = ?', concept, budget, amount, id));

export const deleteIncome = (db: SQLiteDatabase, id: number) => write(() => db.runAsync('DELETE FROM income WHERE id = ?', id));

// --- Facturas ---

export async function listBillsForMonth(db: SQLiteDatabase, month: string): Promise<Bill[]> {
  const rows = await db.getAllAsync<Bill>(
    `SELECT b.id, b.concept, b.budget, b.start_month, b.end_month,
            p.amount AS payment_amount, COALESCE(p.paid, 0) AS paid
     FROM bill b LEFT JOIN bill_payment p ON p.bill_id = b.id AND p.month = ?
     ORDER BY b.id`,
    month,
  );
  return rows.filter((b) => billVisible(b, month, b.payment_amount !== null));
}

export const addBill = (db: SQLiteDatabase, concept: string, budget: number, start_month: string) =>
  write(() => db.runAsync('INSERT INTO bill (concept, budget, start_month) VALUES (?, ?, ?)', concept, budget, start_month));

export const updateBill = (db: SQLiteDatabase, id: number, concept: string, budget: number) =>
  write(() => db.runAsync('UPDATE bill SET concept = ?, budget = ? WHERE id = ?', concept, budget, id));

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

export const deleteBill = (db: SQLiteDatabase, id: number) => write(() => db.runAsync('DELETE FROM bill WHERE id = ?', id)); // cascada a bill_payment

/** Marca/desmarca pagada. Sin pago previo, lo crea con importe = presupuesto de la factura. */
export const setBillPaid = (db: SQLiteDatabase, billId: number, month: string, paid: boolean) =>
  write(() => db.runAsync(
    `INSERT INTO bill_payment (bill_id, month, amount, date, paid)
     SELECT id, ?, budget, ?, ? FROM bill WHERE id = ?
     ON CONFLICT (bill_id, month) DO UPDATE SET paid = excluded.paid`,
    month,
    paymentDate(month),
    paid ? 1 : 0,
    billId,
  ));

/** Upsert del importe real del mes; conserva `paid`. */
export const setPaymentAmount = (db: SQLiteDatabase, billId: number, month: string, amount: number) =>
  write(() => db.runAsync(
    `INSERT INTO bill_payment (bill_id, month, amount, date, paid) VALUES (?, ?, ?, ?, 0)
     ON CONFLICT (bill_id, month) DO UPDATE SET amount = excluded.amount`,
    billId,
    month,
    amount,
    paymentDate(month),
  ));

/** Quita el pago de la factura en ese mes (deshace un check/importe accidental). */
export const deletePayment = (db: SQLiteDatabase, billId: number, month: string) =>
  write(() => db.runAsync('DELETE FROM bill_payment WHERE bill_id = ? AND month = ?', billId, month));

// --- Gastos ---

const EXPENSE_SELECT = `SELECT e.id, e.date, e.concept, e.amount, e.category_id,
  c.name AS category_name
  FROM expense e LEFT JOIN category c ON c.id = e.category_id`;

export function listExpenses(db: SQLiteDatabase, month: string) {
  const [first, last] = monthRange(month);
  return db.getAllAsync<Expense>(`${EXPENSE_SELECT} WHERE e.date BETWEEN ? AND ? ORDER BY e.date DESC, e.id DESC`, first, last);
}

export const getExpense = (db: SQLiteDatabase, id: number) =>
  db.getFirstAsync<Expense>(`${EXPENSE_SELECT} WHERE e.id = ?`, id);

export const addExpense = (db: SQLiteDatabase, date: string, concept: string, amount: number, categoryId: number | null) =>
  write(() => db.runAsync('INSERT INTO expense (date, concept, amount, category_id) VALUES (?, ?, ?, ?)', date, concept, amount, categoryId));

export const updateExpense = (
  db: SQLiteDatabase,
  id: number,
  date: string,
  concept: string,
  amount: number,
  categoryId: number | null,
) =>
  write(() => db.runAsync('UPDATE expense SET date = ?, concept = ?, amount = ?, category_id = ? WHERE id = ?', date, concept, amount, categoryId, id));

export const deleteExpense = (db: SQLiteDatabase, id: number) => write(() => db.runAsync('DELETE FROM expense WHERE id = ?', id));

// --- Resumen ---

export function contributionsForMonth(db: SQLiteDatabase, month: string) {
  const [first, last] = monthRange(month);
  return db.getAllAsync<{ kind: 'savings' | 'investment' | 'debt'; amount: number }>(
    'SELECT kind, amount FROM contribution WHERE date BETWEEN ? AND ?',
    first,
    last,
  );
}

/** Todo lo que necesita `monthSummary` para el mes. `plan` = Σ metas/inversiones/deudas pendientes. */
export async function monthInput(db: SQLiteDatabase, month: string): Promise<MonthInput> {
  const [inc, bills, exps, contribs, plan, debt] = await Promise.all([
    incomes(db, month),
    listBillsForMonth(db, month),
    listExpenses(db, month),
    contributionsForMonth(db, month),
    db.getFirstAsync<{ savings: number; investment: number }>(
      `SELECT (SELECT COALESCE(SUM(min_monthly), 0) FROM savings_goal g
               WHERE g.target > g.initial + (SELECT COALESCE(SUM(amount), 0) FROM contribution WHERE kind = 'savings' AND target_id = g.id)) AS savings,
              (SELECT COALESCE(SUM(monthly), 0) FROM investment) AS investment`,
    ),
    debtPlan(db, month),
  ]);
  return {
    incomes: inc,
    bills: bills.map((b) => ({ budget: b.budget, amount: b.payment_amount })),
    expenses: exps.map((e) => ({ amount: e.amount })),
    contributions: contribs,
    plan: { savings: plan?.savings ?? 0, investment: plan?.investment ?? 0, debt },
  };
}

// --- Ahorro e inversión ---

export type ContribKind = 'savings' | 'investment' | 'debt';
export type Goal = {
  id: number;
  name: string;
  target: number;
  min_monthly: number;
  initial: number;
  interest_rate: number; // TAE anual en %; 0 = no es cuenta remunerada
  contrib: number;
};
export type Investment = {
  id: number;
  name: string;
  initial: number;
  monthly: number;
  current_value: number;
  value_date: string | null;
  contrib: number;
  contrib_after: number; // Σ aportaciones con date > value_date (0 si sin valorar)
};
export type Contribution = { id: number; date: string; kind: ContribKind; target_id: number; amount: number; target_name: string | null };

const contribSum = (kind: ContribKind, table: string) =>
  `(SELECT COALESCE(SUM(amount), 0) FROM contribution WHERE kind = '${kind}' AND target_id = ${table}.id) AS contrib`;

export const listGoals = (db: SQLiteDatabase) =>
  db.getAllAsync<Goal>(`SELECT *, ${contribSum('savings', 'savings_goal')} FROM savings_goal ORDER BY id`);

export const addGoal = (db: SQLiteDatabase, name: string, target: number, min_monthly: number, initial: number, interest_rate: number) =>
  write(() =>
    db.runAsync('INSERT INTO savings_goal (name, target, min_monthly, initial, interest_rate) VALUES (?, ?, ?, ?, ?)', name, target, min_monthly, initial, interest_rate),
  );

export const updateGoal = (db: SQLiteDatabase, id: number, name: string, target: number, min_monthly: number, initial: number, interest_rate: number) =>
  write(() =>
    db.runAsync('UPDATE savings_goal SET name = ?, target = ?, min_monthly = ?, initial = ?, interest_rate = ? WHERE id = ?', name, target, min_monthly, initial, interest_rate, id),
  );

/** Aportaciones de una meta agrupadas por mes ('YYYY-MM' → céntimos), para calcular intereses. */
export const goalContribByMonth = async (db: SQLiteDatabase, id: number) => {
  const rows = await db.getAllAsync<{ m: string; s: number }>(
    "SELECT substr(date, 1, 7) AS m, SUM(amount) AS s FROM contribution WHERE kind = 'savings' AND target_id = ? GROUP BY m",
    id,
  );
  return Object.fromEntries(rows.map((r) => [r.m, r.s])) as Record<string, number>;
};

// contribution.target_id no es FK (polimórfico): la cascada es manual y en la misma transacción.
export const deleteGoal = (db: SQLiteDatabase, id: number) =>
  tx(db, async () => {
    await db.runAsync("DELETE FROM contribution WHERE kind = 'savings' AND target_id = ?", id);
    await db.runAsync('DELETE FROM savings_goal WHERE id = ?', id);
  });

export const listInvestments = (db: SQLiteDatabase) =>
  db.getAllAsync<Investment>(`SELECT *, ${contribSum('investment', 'investment')},
    (SELECT COALESCE(SUM(c.amount), 0) FROM contribution c WHERE c.kind = 'investment' AND c.target_id = investment.id
       AND investment.value_date IS NOT NULL AND c.date > investment.value_date) AS contrib_after
    FROM investment ORDER BY id`);

export const addInvestment = (db: SQLiteDatabase, name: string, initial: number, monthly: number) =>
  write(() => db.runAsync('INSERT INTO investment (name, initial, monthly) VALUES (?, ?, ?)', name, initial, monthly));

export const updateInvestment = (db: SQLiteDatabase, id: number, name: string, initial: number, monthly: number) =>
  write(() => db.runAsync('UPDATE investment SET name = ?, initial = ?, monthly = ? WHERE id = ?', name, initial, monthly, id));

export const deleteInvestment = (db: SQLiteDatabase, id: number) =>
  tx(db, async () => {
    await db.runAsync("DELETE FROM contribution WHERE kind = 'investment' AND target_id = ?", id);
    await db.runAsync('DELETE FROM investment WHERE id = ?', id);
  });

export const updateInvestmentValue = (db: SQLiteDatabase, id: number, cents: number, date: string) =>
  write(() => db.runAsync('UPDATE investment SET current_value = ?, value_date = ? WHERE id = ?', cents, date, id));

/** Aportaciones de un tipo (opcionalmente de un destino), más recientes primero. `target_name` = meta/inversión/deuda. */
export const listContributions = (db: SQLiteDatabase, kind: ContribKind, targetId?: number) =>
  db.getAllAsync<Contribution>(
    `SELECT c.*, COALESCE(g.name, i.name, d.name) AS target_name FROM contribution c
     LEFT JOIN savings_goal g ON c.kind = 'savings' AND g.id = c.target_id
     LEFT JOIN investment i ON c.kind = 'investment' AND i.id = c.target_id
     LEFT JOIN debt d ON c.kind = 'debt' AND d.id = c.target_id
     WHERE c.kind = ?${targetId === undefined ? '' : ' AND c.target_id = ?'}
     ORDER BY c.date DESC, c.id DESC`,
    ...(targetId === undefined ? [kind] : [kind, targetId]),
  );

export const addContribution = (db: SQLiteDatabase, kind: ContribKind, targetId: number, date: string, amount: number) =>
  write(() => db.runAsync('INSERT INTO contribution (date, kind, target_id, amount) VALUES (?, ?, ?, ?)', date, kind, targetId, amount));

export const updateContribution = (db: SQLiteDatabase, id: number, date: string, amount: number) =>
  write(() => db.runAsync('UPDATE contribution SET date = ?, amount = ? WHERE id = ?', date, amount, id));

export const deleteContribution = (db: SQLiteDatabase, id: number) => write(() => db.runAsync('DELETE FROM contribution WHERE id = ?', id));

// --- Deudas ---

export type Debt = { id: number; name: string; principal: number; min_payment: number; annual_rate: number; start_date: string };

export const listDebts = (db: SQLiteDatabase) => db.getAllAsync<Debt>('SELECT * FROM debt ORDER BY id');

export const addDebt = (db: SQLiteDatabase, name: string, principal: number, min_payment: number, annual_rate: number, start_date: string) =>
  write(() => db.runAsync('INSERT INTO debt (name, principal, min_payment, annual_rate, start_date) VALUES (?, ?, ?, ?, ?)', name, principal, min_payment, annual_rate, start_date));

export const updateDebt = (db: SQLiteDatabase, id: number, name: string, principal: number, min_payment: number, annual_rate: number, start_date: string) =>
  write(() => db.runAsync('UPDATE debt SET name = ?, principal = ?, min_payment = ?, annual_rate = ?, start_date = ? WHERE id = ?', name, principal, min_payment, annual_rate, start_date, id));

export const deleteDebt = (db: SQLiteDatabase, id: number) =>
  tx(db, async () => {
    await db.runAsync("DELETE FROM contribution WHERE kind = 'debt' AND target_id = ?", id);
    await db.runAsync('DELETE FROM debt WHERE id = ?', id);
  });

/** Pagos reales por deuda y mes: { [debtId]: { 'YYYY-MM': Σcéntimos } }. */
export async function debtPaymentsByMonth(db: SQLiteDatabase): Promise<Record<number, Record<string, number>>> {
  const rows = await db.getAllAsync<{ id: number; m: string; s: number }>(
    "SELECT target_id AS id, substr(date, 1, 7) AS m, SUM(amount) AS s FROM contribution WHERE kind = 'debt' GROUP BY target_id, m",
  );
  const out: Record<number, Record<string, number>> = {};
  for (const r of rows) (out[r.id] ??= {})[r.m] = r.s;
  return out;
}

/** Presupuesto de Deuda del plan: Σ pago mínimo de las deudas no liquidadas a ese mes. */
async function debtPlan(db: SQLiteDatabase, month: string): Promise<number> {
  const [debts, paid] = await Promise.all([listDebts(db), debtPaymentsByMonth(db)]);
  return debts.reduce((a, d) => a + (debtActiveIn(d, paid[d.id] ?? {}, month) ? d.min_payment : 0), 0);
}

// --- Anual ---

/** MonthInput de los 12 meses del año (solo lecturas, no crea ingresos). */
export const yearInputs = (db: SQLiteDatabase, year: number) =>
  Promise.all(Array.from({ length: 12 }, (_, i) => monthInput(db, `${year}-${String(i + 1).padStart(2, '0')}`)));

// --- Ajustes: escritura ---

const setSetting = (db: SQLiteDatabase, key: string, value: string) =>
  db.runAsync('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);

export const setCurrency = (db: SQLiteDatabase, currency: string) => write(() => setSetting(db, 'currency', currency));

// Nombre repetido: lanza (UNIQUE) y el llamador lo muestra junto al campo.
// category.kind sigue en el esquema (NOT NULL, heredado del 50/30/20) pero ya no se usa: se guarda 'needs'.
export const addCategory = (db: SQLiteDatabase, name: string) =>
  write(() => db.runAsync("INSERT INTO category (name, kind, sort) VALUES (?, 'needs', (SELECT COALESCE(MAX(sort), 0) + 1 FROM category))", name));

export const updateCategory = (db: SQLiteDatabase, id: number, name: string) =>
  write(() => db.runAsync('UPDATE category SET name = ? WHERE id = ?', name, id));

/** Sus gastos quedan sin categoría (ON DELETE SET NULL). */
export const deleteCategory = (db: SQLiteDatabase, id: number) => write(() => db.runAsync('DELETE FROM category WHERE id = ?', id));

/** Plantillas de factura, activas y terminadas. */
export const listAllBills = (db: SQLiteDatabase) =>
  db.getAllAsync<Omit<Bill, 'payment_amount' | 'paid'>>('SELECT id, concept, budget, start_month, end_month FROM bill ORDER BY id');

/** Reabre la factura (end_month = NULL) si terminó hace poco; si es antigua, inserta una copia desde este mes y deja la vieja como histórico. */
export const reactivateBill = (db: SQLiteDatabase, id: number) =>
  tx(db, async () => {
    const b = await db.getFirstAsync<{ concept: string; budget: number; end_month: string | null }>(
      'SELECT concept, budget, end_month FROM bill WHERE id = ?',
      id,
    );
    if (!b || b.end_month === null) return;
    if (reactivationPlan(b.end_month, currentMonth()) === 'reopen') {
      await db.runAsync('UPDATE bill SET end_month = NULL WHERE id = ?', id);
    } else {
      await db.runAsync('INSERT INTO bill (concept, budget, start_month, end_month) VALUES (?, ?, ?, NULL)', b.concept, b.budget, currentMonth());
    }
  });

// --- Exportar ---

export const BACKUP_TABLES = ['settings', 'category', 'income', 'bill', 'bill_payment', 'expense', 'savings_goal', 'investment', 'debt', 'contribution'] as const;

/** Volcado de todas las tablas + metadatos; las lecturas van en la cola de escritura para no mezclar una tx a medias. */
export const backupData = (db: SQLiteDatabase) =>
  write(async () => {
    const v = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    const tables: Record<string, unknown[]> = {};
    for (const t of BACKUP_TABLES) tables[t] = await db.getAllAsync(`SELECT * FROM ${t}`);
    return { app: 'mny', schema: v?.user_version ?? 0, exported_at: new Date().toISOString(), tables };
  });

// Orden inverso al de inserción: primero los hijos (FK activas).
const WIPE = ['contribution', 'bill_payment', 'expense', 'income', 'bill', 'savings_goal', 'investment', 'debt'];

/** Importación del Excel: reemplaza datos en UNA transacción. Conserva ajustes (salvo la moneda del Excel) y categorías (crea las que falten). */
export const applyImport = (db: SQLiteDatabase, plan: ImportPlan) =>
  tx(db, async () => {
    for (const t of WIPE) await db.runAsync(`DELETE FROM ${t}`);
    const ins = async (sql: string, ...p: (string | number | null)[]) => (await db.runAsync(sql, ...p)).lastInsertRowId;

    const cat = new Map((await db.getAllAsync<{ id: number; name: string }>('SELECT id, name FROM category')).map((c) => [norm(c.name), c.id]));
    for (const c of plan.categoriesNeeded) {
      if (!cat.has(norm(c.name)))
        cat.set(norm(c.name), await ins("INSERT INTO category (name, kind, sort) VALUES (?, 'needs', (SELECT COALESCE(MAX(sort), 0) + 1 FROM category))", c.name));
    }

    for (const i of plan.incomes) await ins('INSERT INTO income (month, concept, budget, amount) VALUES (?, ?, ?, ?)', i.month, i.concept, i.budget, i.amount);
    const bills: number[] = [];
    for (const b of plan.bills)
      bills.push(await ins('INSERT INTO bill (concept, budget, start_month, end_month) VALUES (?, ?, ?, ?)', b.concept, b.budget, b.start_month, b.end_month));
    for (const p of plan.payments)
      await ins('INSERT INTO bill_payment (bill_id, month, amount, date, paid) VALUES (?, ?, ?, ?, ?)', bills[p.bill], p.month, p.amount, p.date, p.paid);
    for (const e of plan.expenses)
      await ins('INSERT INTO expense (date, concept, amount, category_id) VALUES (?, ?, ?, ?)', e.date, e.concept, e.amount, e.category ? (cat.get(norm(e.category)) ?? null) : null);
    const goals: number[] = [];
    for (const g of plan.goals) goals.push(await ins('INSERT INTO savings_goal (name, target, min_monthly, initial, interest_rate) VALUES (?, ?, ?, ?, 0)', g.name, g.target, g.min_monthly, g.initial));
    const invs: number[] = [];
    for (const v of plan.investments)
      invs.push(await ins('INSERT INTO investment (name, initial, monthly, current_value, value_date) VALUES (?, ?, ?, ?, ?)', v.name, v.initial, v.monthly, v.current_value, v.value_date));
    for (const d of plan.debts)
      await ins('INSERT INTO debt (name, principal, min_payment, annual_rate, start_date) VALUES (?, ?, ?, ?, ?)', d.name, d.principal, d.min_payment, d.annual_rate, d.start_date);
    for (const c of plan.contributions)
      await ins('INSERT INTO contribution (date, kind, target_id, amount) VALUES (?, ?, ?, ?)', c.date, c.kind, (c.kind === 'savings' ? goals : invs)[c.target], c.amount);
    if (plan.currency) await setSetting(db, 'currency', plan.currency);
  });

/** Restaura una copia JSON: valida antes de tocar nada y reemplaza TODAS las tablas (ids originales) en una transacción. */
export const restoreBackup = (db: SQLiteDatabase, json: unknown) =>
  tx(db, async () => {
    const v = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    const backup = validateBackup(json, BACKUP_TABLES, v?.user_version ?? 0);
    for (const t of [...BACKUP_TABLES].reverse()) await db.runAsync(`DELETE FROM ${t}`);
    for (const t of BACKUP_TABLES)
      for (const row of backup.tables[t]) {
        const cols = Object.keys(row);
        if (!cols.length) continue;
        await db.runAsync(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...cols.map((c) => row[c]));
      }
  });

/** Movimientos para el CSV: [fecha, tipo, concepto, categoría/destino, importe en céntimos]. */
export async function movements(db: SQLiteDatabase): Promise<[string, string, string, string, number][]> {
  const rows = await db.getAllAsync<{ date: string; tipo: string; concept: string; dest: string | null; amount: number; id: number }>(
    `SELECT e.date AS date, 'Gasto' AS tipo, e.concept AS concept, c.name AS dest, e.amount AS amount, e.id AS id
       FROM expense e LEFT JOIN category c ON c.id = e.category_id
     UNION ALL
     SELECT COALESCE(p.date, p.month || '-01'), 'Factura', b.concept, NULL, p.amount, p.id
       FROM bill_payment p JOIN bill b ON b.id = p.bill_id
     UNION ALL
     SELECT month || '-01', 'Ingreso', concept, NULL, amount, id FROM income WHERE amount <> 0
     UNION ALL
     SELECT c.date, CASE c.kind WHEN 'savings' THEN 'Ahorro' WHEN 'investment' THEN 'Inversión' ELSE 'Deuda' END,
            COALESCE(g.name, i.name, d.name, ''), COALESCE(g.name, i.name, d.name), c.amount, c.id
       FROM contribution c
       LEFT JOIN savings_goal g ON c.kind = 'savings' AND g.id = c.target_id
       LEFT JOIN investment i ON c.kind = 'investment' AND i.id = c.target_id
       LEFT JOIN debt d ON c.kind = 'debt' AND d.id = c.target_id
     ORDER BY 1, 2, 6`,
  );
  return rows.map((r) => [r.date, r.tipo, r.concept, r.dest ?? '', r.amount]);
}
