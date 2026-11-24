# mny — Especificación técnica (fuente de verdad para implementar)

Leer junto a `PLAN.md` (qué y por qué) y `CLAUDE.md` (restricciones). Si algo choca, manda este archivo.

## Restricciones duras
- Nada instalado global. Solo `npm install` / `npx expo install` dentro del proyecto. CLIs con `npx`.
- Nunca servir en red: solo `npx expo start --web --localhost` para previsualizar.
- Datos del usuario solo en el SQLite del móvil. Nunca incrustar datos personales en el código de la app.
- `tests/` y `*.xlsx` excluidos de la subida a EAS (`.easignore`).

## Stack
- Expo (último SDK estable) + TypeScript estricto + expo-router (pestañas).
- react-native-paper (Material 3) con tema propio (ver PLAN.md §4b; colores en `src/theme.ts`).
- expo-sqlite (API async: `SQLiteProvider` + `useSQLiteContext`).
- Tests: `node --test` (Node 24 ejecuta `.ts` sin dependencias). Solo lógica pura (`src/lib/*`). Comando: `npm test`.
- Importes en **céntimos enteros** (`INTEGER`) en BD y en cálculos; formatear solo al mostrar (`es-ES`, 2 decimales, sufijo `€`).
- Fechas `TEXT` ISO `YYYY-MM-DD`; meses `TEXT` `YYYY-MM`.

## Estructura
```
app/                    rutas expo-router
  _layout.tsx           PaperProvider + SQLiteProvider + tema claro/oscuro del sistema
  (tabs)/_layout.tsx    4 pestañas: index (Inicio), mes, ahorro, inversion
  (tabs)/index.tsx      Inicio
  (tabs)/mes.tsx        Movimientos del mes
  (tabs)/ahorro.tsx     Metas de ahorro
  (tabs)/inversion.tsx  Cartera
  gasto.tsx             modal: añadir/editar gasto
  deudas.tsx, ajustes.tsx   (desde menú de Inicio)
  (tabs)/totales.tsx   (pestaña Totales con dos subpestañas: Anual | Total)
src/
  theme.ts              esquemas MD3 claro/oscuro
  db/schema.ts          migraciones (PRAGMA user_version)
  db/queries.ts         acceso a datos (funciones async pequeñas, sin ORM)
  lib/money.ts          céntimos <-> texto, parser de expresiones
  lib/calc.ts           TODOS los cálculos, puros
  lib/month.ts          helpers de mes (YYYY-MM, anterior/siguiente, nombre en español)
  components/           solo si se reutiliza en 2+ pantallas
tests/                  *.test.ts + fixtures del Excel (no se suben a EAS)
```

## Esquema SQLite (v2)
```sql
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- keys: currency('€')

CREATE TABLE category (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('needs','wants')), sort INTEGER NOT NULL DEFAULT 0);
-- `kind` se conserva en BD por compatibilidad pero ya no se usa (sin 50/30/20).
-- seed: Mercado, Transporte, Salud, Hogar, Educación, Mascotas, Restaurante, Entretenimiento,
--       Cuidado personal, Compras, Vacaciones, Otros

CREATE TABLE income (id INTEGER PRIMARY KEY, month TEXT NOT NULL, concept TEXT NOT NULL,
  budget INTEGER NOT NULL DEFAULT 0, amount INTEGER NOT NULL DEFAULT 0);

CREATE TABLE bill (id INTEGER PRIMARY KEY, concept TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'needs' CHECK (kind IN ('needs','wants','savings')),
  budget INTEGER NOT NULL DEFAULT 0, start_month TEXT NOT NULL, end_month TEXT); -- end_month NULL = activa

CREATE TABLE bill_payment (id INTEGER PRIMARY KEY, bill_id INTEGER NOT NULL REFERENCES bill(id) ON DELETE CASCADE,
  month TEXT NOT NULL, amount INTEGER NOT NULL, date TEXT, paid INTEGER NOT NULL DEFAULT 0,
  UNIQUE (bill_id, month));

CREATE TABLE expense (id INTEGER PRIMARY KEY, date TEXT NOT NULL, concept TEXT NOT NULL,
  amount INTEGER NOT NULL, category_id INTEGER REFERENCES category(id) ON DELETE SET NULL);

CREATE TABLE savings_goal (id INTEGER PRIMARY KEY, name TEXT NOT NULL, target INTEGER NOT NULL,
  min_monthly INTEGER NOT NULL DEFAULT 0, initial INTEGER NOT NULL DEFAULT 0,
  interest_rate REAL NOT NULL DEFAULT 0); -- v2: TAE anual en %; 0 = cuenta no remunerada

CREATE TABLE investment (id INTEGER PRIMARY KEY, name TEXT NOT NULL, initial INTEGER NOT NULL DEFAULT 0,
  monthly INTEGER NOT NULL DEFAULT 0, current_value INTEGER NOT NULL DEFAULT 0, value_date TEXT);

CREATE TABLE debt (id INTEGER PRIMARY KEY, name TEXT NOT NULL, principal INTEGER NOT NULL,
  min_payment INTEGER NOT NULL, annual_rate REAL NOT NULL DEFAULT 0, start_date TEXT NOT NULL);

-- Una aportación = un movimiento. Cuenta para su mes Y para su meta/activo/deuda.
CREATE TABLE contribution (id INTEGER PRIMARY KEY, date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('savings','investment','debt')),
  target_id INTEGER NOT NULL, amount INTEGER NOT NULL);
```
`PRAGMA foreign_keys = ON` al abrir. Borrar meta/activo/deuda borra sus aportaciones (hacerlo en la misma transacción, `target_id` no es FK polimórfica).

## Reglas de cálculo (`src/lib/calc.ts`), todo en céntimos
Mes M:
- `income = Σ income.amount` del mes. `incomeBudget = Σ income.budget`.
- `billsSpent = Σ bill_payment.amount` del mes (pagada o no: lo que hay apuntado es lo real, igual que la columna "Actual" del Excel).
- `expensesSpent = Σ expense.amount` con `date` en M.
- `spent = billsSpent + expensesSpent` (el Excel mensual hace esto; **no** incluir inversión — el ANUAL del Excel lo hacía mal).
- `saved / invested / debtPaid = Σ contribution.amount` del mes por `kind`.
- `remaining = income − spent − saved − invested − debtPaid` (= celda G21 del Excel).
- Presupuesto vs real por fila: Facturas (Σ presupuesto de facturas), Ahorros/Inversión/Deuda (plan opcional, 0 por defecto) y Gastos = max(ingreso previsto − facturas − ahorro − inversión − deuda, 0). No hay reparto 50/30/20.
- Facturas visibles en M: `start_month ≤ M` y (`end_month` NULL o `end_month ≥ M`), más cualquiera con pago en M.

Ahorro (meta g): `total = initial + Σ contribs(g)`; `left = max(target − total, 0)`; `progress = target>0 ? min(total/target,1) : 0`; `monthsLeft = min_monthly>0 && left>0 ? ceil(left/min_monthly) : null`.

Cuenta remunerada (meta con `interest_rate > 0`): interés **informativo**, no modifica `total`. `accruedInterest`: cada mes se aplica TAE/12 sobre el saldo de ese mes (media ponderada por los días que cada aportación lleva en la cuenta), redondeado; se abona el último día del mes (solo cuenta si ya ha llegado) y entra en el saldo del mes siguiente. `yearlyInterest(rate, saldo)`: 12 meses sin aportaciones.

Inversión (activo a): `contributed = initial + Σ contribs(a)`; valor mostrado `value = value_date null ? contributed : current_value + Σ contribs(a con date > value_date)` (las aportaciones del mismo día ya están en el valor); `gain = value − contributed`; `gainPct = contributed>0 ? gain/contributed : 0`. Sin `value_date` se muestra «Sin valorar» en lugar del rendimiento. Totales = suma.

Deuda (d), `r = annual_rate/100/12`, `cur` = mes en curso, `start` = mes de `start_date`:
- `nper(r, pago, saldo)`: 0 si saldo ≤ 0; `null` si pago ≤ 0 o `pago ≤ round(saldo·r)` (el interés mensual redondeado a céntimos: la deuda no baja); `r=0` → `ceil(saldo/pago)`; si no, NPER redondeado arriba.
- Calendario (tabla de amortización, desde `start`): `interés = round(saldo·r)`, `pago_k = min(real_k ?? min_payment, saldo+interés)`, `saldo_k = max(saldo+interés−pago_k, 0)`; para al llegar a 0 (máx. 600 filas). Asume `min_payment` en todo mes sin pago real, incluidos el actual y los futuros. Pagos reales con mes anterior a `start` se suman al pago real del primer mes.
- Meses anteriores a `cur`: pago = aportaciones reales si las hay, si no `min_payment`. **Mes actual: solo cuentan los pagos reales.**
- `currentBalance`: si `cur < start` → `principal`; si no, `max(saldo fin del mes anterior (o principal si la deuda empieza este mes) + round(saldo·r) − pagos reales de este mes, 0)`. Abierta ⇔ `currentBalance > 0`; liquidada ⇔ `currentBalance == 0`.
- `monthsLeft = nper(r, min_payment, base saldo)` con saldo base = `principal` si `cur < start`; `currentBalance` si hay pago real este mes (se cuenta desde el mes siguiente); saldo de fin del mes anterior en otro caso (se cuenta desde este mes). `freeMonth = addM(base, monthsLeft−1)` con base = `start` si `start > cur`; `cur` si no hay pago real este mes; `cur+1` si lo hay. `monthsLeft` 0 o `null` → `freeMonth null`.
- `paidPct = min(Σ contribs(d) / principal, 1)`.
- Resumen: deuda total, pago mínimo total (solo abiertas), fecha libre = máx(`freeMonth`) entre deudas (`null` si alguna abierta nunca se paga). Orden bola de nieve = `currentBalance` ascendente (las liquidadas, al final).
- Presupuesto de Deuda del plan del mes M = Σ `min_payment` de las deudas con fila en el calendario para M (`debtSchedule(d, pagos, M)` tiene una fila de M): el mes del último pago sí presupuesta; antes del inicio y tras liquidarla no.
- Pagos: la fecha no puede ser anterior a `start_date`. «Pagar» propone `min(min_payment, currentBalance)` y se oculta si `currentBalance == 0`. Interés anual válido: 0 a 100.
- `monthsLeft` usa NPER (paridad con el Excel); puede diferir en ±1 mes de la longitud del calendario por el redondeo mensual de intereses.

Anual (año Y): por cada mes, `income, spent, saved, invested, debtPaid, remaining`; fila total = sumas.

Total (toda la vida de la app): una fila por año con movimientos (`yearSummary(...).total`) y, arriba, `grandTotal` = suma de los años. Mismas columnas que Anual.

## Entrada de importes (`src/lib/money.ts`)
- `parseAmount("1,8+1+1.2") → 400` céntimos. Admite `+ - * /`, paréntesis, coma o punto decimal, espacios, `=` inicial opcional. Parser propio (sin `eval`/`Function`). Inválido → `null`. Redondeo a céntimo al final.
- `formatMoney(cents, currency)` → `1.234,56 €`.

## UX
- Español. Botón "+" (FAB) en todas las pestañas → modal de gasto: importe (teclado numérico + expresión, muestra el resultado), categoría (chips), concepto, fecha (hoy por defecto). Guardar en ≤3 toques.
- Selector de mes compartido (contexto o parámetro) en Inicio y Mes; por defecto el mes actual.
- Mes: secciones Ingresos (editar importes/presupuesto, añadir concepto; si el mes no tiene ingresos, crear Sueldo/Ingresos extra/Otros con el presupuesto copiado del mes anterior), Facturas (check = pagada; al marcar sin pago crea uno con importe = presupuesto), Gastos (lista por fecha desc, tocar para editar, borrar con confirmación).
- Estados vacíos con una línea y una acción. Errores de validación junto al campo.
- Tema claro/oscuro según el sistema.
