# mny — gastos personales

App Android (Expo + React Native) para llevar el presupuesto mensual que antes vivía en una hoja de cálculo: ingresos, facturas recurrentes, gastos del día a día, metas de ahorro, inversiones y deudas, con el reparto 50/30/20.

Los datos se guardan **solo en el móvil** (SQLite local). No hay servidor ni cuentas: la app funciona sin conexión.

## Qué hace

- **Inicio**: resumen del mes (ingresos, gastado, ahorrado + invertido, restante), reparto 50/30/20 y presupuesto frente a real.
- **Mes**: ingresos, facturas (con ✓ de pagada) y gastos del mes. Las facturas se repiten cada mes hasta darlas de baja.
- **Gasto**: alta rápida con calculadora (`+ − × ÷`), categoría y fecha.
- **Ahorro**: metas con objetivo, aportación mínima mensual, progreso y meses restantes.
- **Inversión**: activos con lo aportado, valor actual y ganancia/pérdida.
- **Deudas**: saldo, cuota, interés, tabla de amortización y fecha de fin.
- **Anual**: totales por mes del año con gráfico; tocar un mes lleva a él.
- **Ajustes**: moneda, porcentajes 50/30/20, categorías, facturas recurrentes (editar/reactivar).
- **Exportar**: copia de seguridad (JSON) y movimientos (CSV para Excel).
- **Importar**: el Excel de presupuesto (`.xlsx`) o una copia JSON. Antes de reemplazar los datos muestra un resumen, avisos y las diferencias con los totales del Excel.

Tema Material 3 "naturaleza" (verdes y marrones), claro u oscuro según el sistema.

## Stack

Expo SDK 58 · expo-router · TypeScript estricto · react-native-paper (MD3) · expo-sqlite · SheetJS (xlsx, empaquetado en `vendor/`).

Importes en céntimos enteros; todos los cálculos son funciones puras en `src/lib/calc.ts`.

```
app/            pantallas (expo-router): (tabs)/ Inicio, Mes, Ahorro, Inversión + gasto, deudas, anual, ajustes
src/db/         esquema SQLite y consultas
src/lib/        cálculos, dinero, meses, exportación, importación del Excel
src/components/ componentes compartidos
tests/          tests de la lógica (node --test)
```

Más detalle en [SPEC.md](SPEC.md) (especificación técnica) y [PLAN.md](PLAN.md) (plan y decisiones).

## Desarrollo

Requisitos: Node 24+ y npm. No hace falta Android Studio ni el SDK de Android.

```bash
npm install
npm test            # tests de la lógica
npm run typecheck   # comprobación de tipos
npm run web         # vista previa en el navegador, solo en localhost
```

La vista previa web es solo para revisar pantallas; la app de verdad es la de Android.

## Generar el APK

El APK se compila en la nube de Expo (EAS Build), así que no hay que instalar nada en el ordenador.

1. Crea una cuenta gratuita en [expo.dev](https://expo.dev).
2. En la carpeta del proyecto:

   ```bash
   npm install
   npx eas-cli login
   npx eas-cli update:configure   # solo la primera vez: enlaza el proyecto y activa EAS Update
   npx eas-cli build -p android --profile preview
   ```

3. Cuando termine (unos minutos), EAS da un enlace y un QR. Ábrelo en el móvil, descarga el `.apk` e instálalo (Android pedirá permitir apps de origen desconocido).
4. En la app: **Ajustes → Importar → Importar Excel (.xlsx)** y elige el presupuesto exportado como `.xlsx`.

### Actualizar la app ya instalada

Para cambios de código (pantallas, lógica) no hace falta otro APK:

```bash
npx eas-cli update --channel preview
```

La app descarga la actualización al abrirse. Solo hay que volver a compilar el APK si se añade una dependencia nativa o se cambia la versión en `app.json`.

### Si `npx eas-cli` se queda colgado

En algunas redes (oficinas, wifi públicas) el firewall corta la descarga de paquetes de npm y `npx eas-cli` no llega a arrancar. Prueba desde otra conexión (casa, datos del móvil).

## Privacidad

- Los datos solo existen en el SQLite del móvil; haz copias con **Exportar → Copia de seguridad (JSON)**.
- `tests/fixtures/`, `*.xlsx` y `*.csv` están en `.gitignore` y `tests/` en `.easignore`: los datos reales nunca se suben a GitHub ni a EAS.
