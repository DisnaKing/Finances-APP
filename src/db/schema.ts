import type { SQLiteDatabase } from 'expo-sqlite';

// Esquema v1 (SPEC.md) + v2 (cuenta remunerada: savings_goal.interest_rate, TAE anual en %; 0 = sin remunerar).
// v3: contribution.price = precio de compra por unidad en céntimos (NULL = sin registrar), útil en inversiones.
// v4: savings_goal.start_date = fecha de creación (el monto inicial rinde desde ese día; NULL = desde la 1.ª aportación).
// Para v5: añadir `if (v < 5) { ... }` y subir LATEST.
const LATEST = 4;

const V1 = `
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE category (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('needs','wants')), sort INTEGER NOT NULL DEFAULT 0);

CREATE TABLE income (id INTEGER PRIMARY KEY, month TEXT NOT NULL, concept TEXT NOT NULL,
  budget INTEGER NOT NULL DEFAULT 0, amount INTEGER NOT NULL DEFAULT 0);

CREATE TABLE bill (id INTEGER PRIMARY KEY, concept TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'needs' CHECK (kind IN ('needs','wants','savings')),
  budget INTEGER NOT NULL DEFAULT 0, start_month TEXT NOT NULL, end_month TEXT);

CREATE TABLE bill_payment (id INTEGER PRIMARY KEY, bill_id INTEGER NOT NULL REFERENCES bill(id) ON DELETE CASCADE,
  month TEXT NOT NULL, amount INTEGER NOT NULL, date TEXT, paid INTEGER NOT NULL DEFAULT 0,
  UNIQUE (bill_id, month));

CREATE TABLE expense (id INTEGER PRIMARY KEY, date TEXT NOT NULL, concept TEXT NOT NULL,
  amount INTEGER NOT NULL, category_id INTEGER REFERENCES category(id) ON DELETE SET NULL);

CREATE TABLE savings_goal (id INTEGER PRIMARY KEY, name TEXT NOT NULL, target INTEGER NOT NULL,
  min_monthly INTEGER NOT NULL DEFAULT 0, initial INTEGER NOT NULL DEFAULT 0);

CREATE TABLE investment (id INTEGER PRIMARY KEY, name TEXT NOT NULL, initial INTEGER NOT NULL DEFAULT 0,
  monthly INTEGER NOT NULL DEFAULT 0, current_value INTEGER NOT NULL DEFAULT 0, value_date TEXT);

CREATE TABLE debt (id INTEGER PRIMARY KEY, name TEXT NOT NULL, principal INTEGER NOT NULL,
  min_payment INTEGER NOT NULL, annual_rate REAL NOT NULL DEFAULT 0, start_date TEXT NOT NULL);

CREATE TABLE contribution (id INTEGER PRIMARY KEY, date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('savings','investment','debt')),
  target_id INTEGER NOT NULL, amount INTEGER NOT NULL);
`;

const SETTINGS: [string, string][] = [['currency', '€']];

// Orden del desplegable del Excel.
const CATEGORIES: [string, 'needs' | 'wants'][] = [
  ['Mercado', 'needs'],
  ['Transporte', 'needs'],
  ['Restaurante', 'wants'],
  ['Entretenimiento', 'wants'],
  ['Salud', 'needs'],
  ['Cuidado personal', 'wants'],
  ['Hogar', 'needs'],
  ['Compras', 'wants'],
  ['Educación', 'needs'],
  ['Vacaciones', 'wants'],
  ['Mascotas', 'needs'],
  ['Otros', 'wants'],
];

/** Para `<SQLiteProvider onInit={migrate}>`. Idempotente: solo migra si user_version < LATEST. */
export async function migrate(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const v = row?.user_version ?? 0;
  if (v >= LATEST) return;

  await db.withTransactionAsync(async () => {
    if (v < 1) {
      await db.execAsync(V1);
      for (const [k, val] of SETTINGS)
        await db.runAsync('INSERT INTO settings (key, value) VALUES (?, ?)', k, val);
      for (const [i, [name, kind]] of CATEGORIES.entries())
        await db.runAsync('INSERT INTO category (name, kind, sort) VALUES (?, ?, ?)', name, kind, i + 1);
    }
    if (v < 2) {
      await db.execAsync('ALTER TABLE savings_goal ADD COLUMN interest_rate REAL NOT NULL DEFAULT 0');
      await db.execAsync("DELETE FROM settings WHERE key LIKE 'pct\\_%' ESCAPE '\\'");
    }
    if (v < 3) {
      await db.execAsync('ALTER TABLE contribution ADD COLUMN price INTEGER');
    }
    if (v < 4) {
      await db.execAsync('ALTER TABLE savings_goal ADD COLUMN start_date TEXT');
    }
    await db.execAsync(`PRAGMA user_version = ${LATEST}`);
  });
}
