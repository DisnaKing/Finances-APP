/** Un campo CSV: entre comillas si lleva `;`, `"` o salto de línea; las comillas se duplican. */
export const csvEscape = (s: string) => (/[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** Campo de texto libre: si empieza por = + - @ (o tab/CR) Excel lo ejecutaría como fórmula; se antepone `'`. */
const textField = (s: string) => csvEscape(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

/** Céntimos → "1234,56" (sin separador de miles, para que Excel lo trate como número). */
const amount = (c: number) => `${c < 0 ? '-' : ''}${Math.floor(Math.abs(c) / 100)},${String(Math.abs(c) % 100).padStart(2, '0')}`;

const BOM = '\uFEFF';

/** Movimientos → CSV UTF-8 con BOM, separador `;` y coma decimal. Fila: [fecha ISO, tipo, concepto, categoría/destino, céntimos]. */
export function toCsv(rows: [string, string, string, string, number][]): string {
  const head = 'fecha;tipo;concepto;categoría/destino;importe';
  return BOM + [head, ...rows.map(([d, t, c, k, a]) => [textField(d), textField(t), textField(c), textField(k), amount(a)].join(';'))].join('\r\n') + '\r\n';
}

export const backupName = (date: string) => `mny-backup-${date}.json`;
