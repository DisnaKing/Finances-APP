// Precios de mercado (Yahoo Finance, endpoint `chart`, sin clave). Sin imports de Expo: la lógica pura corre bajo `node --test`.
// Solo se envía el símbolo (ticker) público; nunca importes ni datos personales.

export type RawQuote = { price: number; currency: string };

const SYMBOLS: Record<string, string> = { '€': 'EUR', '$': 'USD', '£': 'GBP' };

/** Moneda de la app ('€', '$', 'EUR'...) → código ISO. Desconocida → EUR. */
export const isoCurrency = (sym: string): string => SYMBOLS[sym] ?? (/^[A-Z]{3}$/.test(sym) ? sym : 'EUR');

/** Extrae precio y moneda de la respuesta de `chart`; null si no tiene el formato esperado. */
export function parseChart(json: any): RawQuote | null {
  const meta = json?.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  const currency = meta?.currency;
  return typeof price === 'number' && Number.isFinite(price) && price > 0 && typeof currency === 'string' ? { price, currency } : null;
}

/** Londres cotiza en peniques (GBp/GBX): se pasa a libras. */
export function normalizeQuote(q: RawQuote): RawQuote {
  return q.currency === 'GBp' || q.currency === 'GBX' ? { price: q.price / 100, currency: 'GBP' } : q;
}

export type Fetcher = (symbol: string) => Promise<RawQuote>;

export const fetchChart: Fetcher = async (symbol) => {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`, {
      signal: ctl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const q = parseChart(await res.json());
    if (!q) throw new Error('Respuesta sin precio');
    return q;
  } finally {
    clearTimeout(timer);
  }
};

/** Precio por unidad en céntimos de la moneda de la app. Si cotiza en otra moneda, convierte con el par `APPXXX=X`. */
export async function quoteInCents(symbol: string, appCurrency: string, fetcher: Fetcher = fetchChart): Promise<number> {
  const q = normalizeQuote(await fetcher(symbol));
  const app = isoCurrency(appCurrency);
  if (q.currency === app) return Math.round(q.price * 100);
  const fx = await fetcher(`${app}${q.currency}=X`); // unidades de `q.currency` por 1 de la moneda de la app
  return Math.round((q.price / fx.price) * 100);
}
