import type { SQLiteDatabase } from 'expo-sqlite';
import * as q from '@/src/db/queries';
import { fetchChart, quoteInCents, type Fetcher, type RawQuote } from '@/src/lib/quotes';

const MIN_GAP_MS = 10 * 60 * 1000; // no repetir la consulta automática antes de 10 min
let last = 0;
let running = false;
const listeners = new Set<() => void>();

/** Avisa a las pantallas cuando hay precios nuevos. Devuelve la función para darse de baja. */
export const onQuotesUpdated = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

/** Actualiza el precio de las inversiones con ticker. Si falla (sin red, ticker erróneo) conserva el último precio. */
export async function refreshQuotes(db: SQLiteDatabase, force = false): Promise<{ updated: number; failed: string[] }> {
  if (running || (!force && Date.now() - last < MIN_GAP_MS)) return { updated: 0, failed: [] };
  running = true;
  try {
    const [invs, st] = await Promise.all([q.listInvestments(db), q.getSettings(db)]);
    const withTicker = invs.filter((i) => i.ticker);
    if (withTicker.length === 0) return { updated: 0, failed: [] };
    const memo = new Map<string, Promise<RawQuote>>(); // un mismo símbolo/divisa se pide una sola vez
    const cached: Fetcher = (s) => {
      if (!memo.has(s)) memo.set(s, fetchChart(s));
      return memo.get(s)!;
    };
    const at = new Date().toISOString();
    const failed: string[] = [];
    let updated = 0;
    await Promise.all(
      withTicker.map(async (inv) => {
        try {
          await q.setQuote(db, inv.id, await quoteInCents(inv.ticker!, st.currency, cached), at);
          updated++;
        } catch {
          failed.push(inv.ticker!);
        }
      }),
    );
    last = Date.now();
    if (updated > 0) listeners.forEach((cb) => cb());
    return { updated, failed };
  } catch (e) {
    console.error(e);
    return { updated: 0, failed: [] };
  } finally {
    running = false;
  }
}
