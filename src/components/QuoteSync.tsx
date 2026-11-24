import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { refreshQuotes } from '@/src/db/quotesSync';

/** Al abrir la app y al volver a primer plano, actualiza los precios de las inversiones con ticker. No pinta nada. */
export function QuoteSync() {
  const db = useSQLiteContext();
  useEffect(() => {
    refreshQuotes(db);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refreshQuotes(db);
    });
    return () => sub.remove();
  }, [db]);
  return null;
}
