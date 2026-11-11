// Meses 'YYYY-MM', fechas 'YYYY-MM-DD'. Sin imports: corre bajo `node --test`.

const NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const pad = (n: number) => String(n).padStart(2, '0');

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** Fecha local 'YYYY-MM-DD' (no toISOString: ese es UTC). */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addMonths(m: string, n: number): string {
  const [y, mo] = m.split('-').map(Number);
  const t = y * 12 + (mo - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}

export function monthName(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  return `${NAMES[mo - 1]} ${y}`;
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** ['2026-02-01', '2026-02-28'] */
export function monthRange(m: string): [string, string] {
  const [y, mo] = m.split('-').map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return [`${m}-01`, `${m}-${pad(last)}`];
}
