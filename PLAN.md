# mny — Plan de la app de gastos

Objetivo: app móvil que sustituya `presupuesto_completo` (Google Sheets) cubriendo todos sus campos y cálculos.

## 1. Qué cubre hoy el Excel

| Pestaña | Datos que metes tú | Cálculos |
|---|---|---|
| **ANUAL** | Año, moneda | Por mes: ingreso, gastado, ahorrado, restante + total anual |
| **ENE…DIC** (12) | **Ingresos**: Sueldo / Ingresos extra / Otros (presupuesto + actual)<br>**Reparto 50/30/20**: % Necesidades / Deseos / Ahorros<br>**Presupuesto vs actual**: Facturas, Gastos, Ahorros, Inversión, Deuda<br>**Facturas (fijos)**: ✓ pagado, concepto, presupuesto, actual, tipo (Necesidades/Deseos/Ahorros), fecha<br>**Gastos**: ✓, concepto, monto, categoría, fecha | Ingreso total, total gastado, restante por asignar, total ahorrado, presupuesto por categoría = ingreso × %, gráfico gastado/restante |
| **PAGO DEUDAS (bola de nieve)** | Por deuda: nombre, deuda inicial, pago mínimo, interés anual %, fecha inicial; pago real por mes | Deuda total, pago mínimo total, meses restantes (NPER), fecha libre de deudas, calendario de amortización, % pagado |
| **FONDO DE AHORROS** | Metas: nombre, meta, contribución mínima, monto inicial<br>Registro: fecha, meta, monto | Total ahorrado por meta, falta, progreso %, meses restantes |
| **INVERSIONES** | Activos: nombre, aportación inicial, aportación mensual, valor actual<br>Registro: fecha, activo, monto | Total aportado, rendimiento €, rendimiento % (por activo y total) |

Categorías de gasto (las 12 del desplegable): Mercado, Transporte, Restaurante, Entretenimiento, Salud, Cuidado personal, Hogar, Compras, Educación, Vacaciones, Mascotas, Otros.

### Cosas del Excel que la app arregla de paso
- **Ahorro e inversión se meten dos veces**: en el mes (G18/G19) y otra vez en el registro de Fondo de Ahorros e Inversiones. En la app, una aportación se registra una vez y cuenta para el mes y para la meta o el activo.
- **ANUAL suma la inversión dentro de "Total gastado"** (`B9+G19`), pero el mes no la suma. En la app, gastado e invertido van por separado.
- **El presupuesto de "Gastos" está vacío** casi todos los meses (solo noviembre lo tiene, tecleado a mano). La app lo calcula siempre con el 50/30/20.
- **Montos escritos como sumas** (`=(1.8+1+1.2)`): el campo de importe acepta expresiones `1.8+1+1.2`.
- **Facturas copiadas a mano cada mes**: las facturas son plantillas que se repiten y cada mes se marcan como pagadas.
- **La amortización solo existe para la 1ª deuda**: la app la calcula para todas y ordena por bola de nieve (la deuda más pequeña primero).

## 2. Modelo de datos

```
Settings      (moneda, año activo)
Income        (id, mes, tipo: sueldo|extra|otros, presupuesto, importe)
Bill          (id, concepto, tipo: necesidades|deseos|ahorros, presupuesto, activa)   -- plantilla recurrente
BillPayment   (id, bill_id, mes, importe, fecha, pagada)
Expense       (id, fecha, concepto, importe, categoría)
SavingsGoal   (id, nombre, meta, contribución_mín, monto_inicial)
Contribution  (id, fecha, tipo: ahorro|inversión|deuda, destino_id, importe)
Investment    (id, activo, aportación_inicial, aportación_mensual, valor_actual, actualizado_en)
Debt          (id, nombre, deuda_inicial, pago_mín, interés_anual, fecha_inicial)
```
Todo lo demás (totales, restante, progreso, NPER, amortización, rendimiento) es **calculado**, no se guarda.

## 3. Pantallas
1. **Inicio (mes actual)**: ingreso, gastado, ahorrado/invertido, restante; presupuesto contra lo real; selector de mes.
2. **Añadir gasto** (botón +, ≤3 toques): importe con calculadora, categoría, concepto, fecha = hoy.
3. **Movimientos del mes**: lista de gastos y facturas (con check de pagada) e ingresos; editar y borrar.
4. **Ahorros**: metas con progreso y meses restantes, y registro de aportaciones.
5. **Inversiones**: cartera, actualizar valor, aportaciones, rendimiento.
6. **Deudas**: lista, fecha libre de deudas, amortización por deuda.
7. **Anual**: tabla por mes y gráfico.
8. **Ajustes**: moneda, categorías, plantillas de facturas, importar/exportar.

## 4. Stack propuesto (pendiente de confirmar)
- **Expo (React Native + TypeScript)**: un solo código para Android e iOS, y se prueba en el móvil con Expo Go sin compilar.
- **expo-sqlite**: datos locales, funciona sin conexión, una sola persona usuaria, sin backend.
- **Gráficos**: victory-native o barras hechas con `View` (lo más simple que sirva).
- **Exportar**: CSV/JSON con la hoja de compartir del sistema, que sirve de copia de seguridad.
- Sin login ni sincronización en la nube en la v1 (se añade cuando haga falta un segundo dispositivo).

## 4b. Estilo: "Medianoche"
- **Base**: Material Design 3 con **react-native-paper**. Componentes compartidos mínimos en `src/components/ui.tsx` (tarjeta protagonista, barras, FAB).
- **Tema claro y oscuro**: sigue el tema del sistema.
- **Paleta** (un solo `theme.ts` con los dos esquemas de Paper):

| Color | Claro | Oscuro | Uso |
|---|---|---|---|
| primary (menta) | `#00805F` | `#3DE0A8` | FAB, acciones, pestaña activa, barras |
| tertiary (azul) | `#2F62B8` | `#8AB4FF` | Segunda serie del gráfico anual |
| background / surface | `#F2F5F7` | `#0A1017` | Fondo |
| tarjeta (elevation.level1) | `#FFFFFF` | `#131C26` | Tarjetas |
| hero | `#0B1520` | `#162330` | Cifra protagonista ("Restante", resúmenes) |
| heroAccent | `#3DE0A8` | `#3DE0A8` | Cifra positiva dentro de la tarjeta hero |
| error | `#C4261D` | `#FF8A80` | Saldo negativo, pérdidas |

- **Navegación inferior** (5 pestañas): Inicio · Mes · Ahorro · Inversión · Totales (subpestañas Anual | Total). Deudas y Ajustes se abren desde el menú de Inicio.
- **FAB "+"** fijo en todas las pestañas para añadir un gasto.

## 5. Fases
| Fase | Entrega | Hecho cuando |
|---|---|---|
| **0. Base** | Proyecto Expo, esquema SQLite, navegación por pestañas | La app arranca en el móvil con Expo Go |
| **1. Mes** | Ingresos, facturas recurrentes, gastos, resumen del mes | Noviembre en la app da los mismos números que el Excel |
| **2. Ahorros + inversiones** | Metas, cartera, aportaciones únicas | Totales iguales a los de las pestañas del Excel |
| **3. Deudas** | Deudas, NPER, amortización, bola de nieve | Mismos meses restantes que `NPER` del Excel |
| **4. Anual + export** | Resumen anual, gráfico, exportar CSV/JSON | Anual cuadra con la pestaña ANUAL |
| **5. Importar Excel** | Script que lee el .xlsx y carga ago–nov 2026 | Histórico completo dentro de la app |

Los cálculos (NPER, amortización, rendimiento) van en un único módulo `calc.ts` con un test que compara contra los valores reales de este Excel.

## 6. Reparto de agentes (según CLAUDE.md)
- **opus**: este plan, revisión de cada fase y cuadre con el Excel.
- **sonnet**: implementar cada fase.
- **haiku**: buscar la documentación de Expo y de las librerías.
- **fable**: si algo se atasca (por ejemplo, cuadrar la amortización).

## 7. Decisiones
1. ✅ Plataforma: **Android** (Expo; iOS queda posible sin reescribir).
2. ✅ Datos: **solo en el móvil**, almacenamiento local (expo-sqlite, sin nube).
3. ✅ **Se importan** los datos de agosto a noviembre de 2026 del Excel (fase 5).
4. ✅ "✓" **solo en facturas** (pagada). Se quita de los gastos: apuntar un gasto ya implica que ocurrió.
