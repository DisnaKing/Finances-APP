// Importes en céntimos enteros. Sin imports: corre bajo `node --test`.

/** Evalúa "1,8+1+(2*3)" → céntimos. Inválido o división por cero → null. */
export function parseAmount(input: string): number | null {
  const s = input.replace(/\s+/g, '').replace(/^=/, '');
  if (!s || s.length > 200) return null; // evita desbordar la pila con "((((…"

  let i = 0;

  // Cada nivel devuelve number | null (null = error).
  const expr = (): number | null => {
    let v = term();
    while (v !== null && (s[i] === '+' || s[i] === '-')) {
      const op = s[i++];
      const r = term();
      if (r === null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };
  const term = (): number | null => {
    let v = unary();
    while (v !== null && (s[i] === '*' || s[i] === '/')) {
      const op = s[i++];
      const r = unary();
      if (r === null) return null;
      if (op === '/' && r === 0) return null;
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };
  const unary = (): number | null => {
    if (s[i] === '-') { i++; const v = unary(); return v === null ? null : -v; }
    if (s[i] === '+') { i++; return unary(); }
    return atom();
  };
  const atom = (): number | null => {
    if (s[i] === '(') {
      i++;
      const v = expr();
      if (v === null || s[i] !== ')') return null;
      i++;
      return v;
    }
    const rest = s.slice(i);
    // "1.234,56": puntos de miles (+ decimales con coma). Si no, decimal con coma o punto ("1,8", "1.5", "12.34").
    const g = /^\d{1,3}(?:\.\d{3})+(?!\d)(?:,\d+)?/.exec(rest);
    if (g) {
      i += g[0].length;
      return Number(g[0].replace(/\./g, '').replace(',', '.'));
    }
    const m = /^(?:\d+[.,]?\d*|[.,]\d+)/.exec(rest);
    if (!m) return null;
    i += m[0].length;
    return Number(m[0].replace(',', '.'));
  };

  const v = expr();
  if (v === null || i !== s.length || !Number.isFinite(v)) return null;
  const c = Number((v * 100).toPrecision(12)); // quita ruido binario (2.175*100)
  return Math.sign(c) * Math.round(Math.abs(c)) + 0; // mitades lejos de 0; +0 evita -0
}

function group(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** 123456 → "1.234,56 €" ; -580 → "-5,80 €" */
export function formatMoney(cents: number, currency = '€'): string {
  if (!Number.isFinite(cents)) return '—';
  const abs = Math.abs(Math.round(cents));
  const body = `${group(Math.floor(abs / 100))},${String(abs % 100).padStart(2, '0')}`;
  return `${cents < 0 && abs > 0 ? '-' : ''}${body}\u00A0${currency}`;
}

/** 1299 → "12,99" (para editar en un campo) */
export function centsToInput(cents: number): string {
  const abs = Math.abs(Math.round(cents));
  return `${cents < 0 && abs > 0 ? '-' : ''}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/** Inserta `ins` sustituyendo la selección [start,end) de `text`; `pos` = posición del cursor tras lo insertado. */
export function insertAt(text: string, ins: string, start: number, end: number): { text: string; pos: number } {
  const a = Math.max(0, Math.min(start, end, text.length));
  const b = Math.min(text.length, Math.max(start, end));
  return { text: text.slice(0, a) + ins + text.slice(b), pos: a + ins.length };
}
