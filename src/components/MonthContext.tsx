import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { currentMonth } from '@/src/lib/month';

type Ctx = { month: string; setMonth: (m: string) => void };
const MonthCtx = createContext<Ctx>({ month: currentMonth(), setMonth: () => {} });

export function MonthProvider({ children }: { children: ReactNode }) {
  const [month, setMonth] = useState(currentMonth);
  const value = useMemo(() => ({ month, setMonth }), [month]);
  return <MonthCtx.Provider value={value}>{children}</MonthCtx.Provider>;
}

export const useMonth = () => useContext(MonthCtx);
