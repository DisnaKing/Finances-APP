import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { IconButton, Text, useTheme } from 'react-native-paper';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useMonth } from '@/src/components/MonthContext';
import * as q from '@/src/db/queries';
import { monthSummary, yearSummary, type YearRow } from '@/src/lib/calc';
import { formatMoney } from '@/src/lib/money';
import { monthName } from '@/src/lib/month';

const BAR_H = 120;
const COL_W = 92; // ancho de columna de la tabla
const HEAD = ['Mes', 'Ingresos', 'Gastado', 'Ahorro+Inv.', 'Deuda', 'Restante'];
const key = (year: number, mo: number) => `${year}-${String(mo).padStart(2, '0')}`;

export function AnnualView() {
  const db = useSQLiteContext();
  const c = useTheme().colors;
  const { setMonth } = useMonth();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [cur, setCur] = useState('€');
  const [data, setData] = useState<ReturnType<typeof yearSummary> | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const n = ++seq.current;
    try {
      const [inputs, st] = await Promise.all([q.yearInputs(db, year), q.getSettings(db)]);
      if (n !== seq.current) return; // llegó otra carga más reciente
      setData(yearSummary(inputs.map(monthSummary)));
      setCur(st.currency);
    } catch (err) {
      console.error(err);
    }
  }, [db, year]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const m = (x: number) => formatMoney(x, cur);
  const out = (r: Omit<YearRow, 'month'>) => r.spent + r.saved + r.invested + r.debtPaid;
  const max = Math.max(1, ...(data?.rows.flatMap((r) => [r.income, out(r)]) ?? []));
  const h = (x: number) => (x > 0 ? Math.max(2, Math.round((x / max) * BAR_H)) : 0);
  const open = (mo: number) => {
    setMonth(key(year, mo));
    router.navigate('/');
  };
  // El color va siempre explícito: `color: undefined` pisaría el del tema y el texto no cambiaría con él.
  const cell = (i: number, bold = false, color: string = c.onSurface) => [
    { width: COL_W, textAlign: i === 0 ? ('left' as const) : ('right' as const), color },
    bold && styles.bold,
  ];
  const vals = (r: Omit<YearRow, 'month'>, bold: boolean) => (
    <>
      <Text variant="bodySmall" style={cell(1, bold)}>{m(r.income)}</Text>
      <Text variant="bodySmall" style={cell(2, bold)}>{m(r.spent)}</Text>
      <Text variant="bodySmall" style={cell(3, bold)}>{m(r.saved + r.invested)}</Text>
      <Text variant="bodySmall" style={cell(4, bold)}>{m(r.debtPaid)}</Text>
      <Text variant="bodySmall" style={cell(5, bold, r.remaining < 0 ? c.error : undefined)}>{m(r.remaining)}</Text>
    </>
  );

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.content}>
      <View style={styles.sel}>
        <IconButton icon="chevron-left" accessibilityLabel="Año anterior" onPress={() => setYear(year - 1)} />
        <Pressable onPress={() => setYear(new Date().getFullYear())} accessibilityLabel={`${year}, ir al año actual`}>
          <Text variant="titleMedium">{year}</Text>
        </Pressable>
        <IconButton icon="chevron-right" accessibilityLabel="Año siguiente" onPress={() => setYear(year + 1)} />
      </View>

      {data !== null && (
        <>
          <View style={styles.legend}>
            <View style={[styles.dot, { backgroundColor: c.primary }]} />
            <Text variant="labelSmall">Ingresos</Text>
            <View style={[styles.dot, { backgroundColor: c.tertiary }]} />
            <Text variant="labelSmall">Gastado + ahorro + inversión + deuda</Text>
          </View>
          <View style={styles.chart}>
            {data.rows.map((r) => (
              <Pressable
                key={r.month}
                style={styles.col}
                onPress={() => open(r.month)}
                accessibilityRole="button"
                accessibilityLabel={`${monthName(key(year, r.month))}: ingresos ${m(r.income)}, salidas ${m(out(r))}`}
              >
                <View style={styles.bars}>
                  <View style={[styles.bar, { height: h(r.income), backgroundColor: c.primary }]} />
                  <View style={[styles.bar, { height: h(out(r)), backgroundColor: c.tertiary }]} />
                </View>
                <Text variant="labelSmall" style={{ color: c.onSurfaceVariant }}>{monthName(key(year, r.month)).slice(0, 3)}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.table}>
            <View>
              <View style={[styles.row, { borderColor: c.outlineVariant }]}>
                <Text variant="labelMedium" style={cell(0, true)}>{HEAD[0]}</Text>
              </View>
              {data.rows.map((r) => (
                <Pressable
                  key={r.month}
                  style={[styles.row, { borderColor: c.outlineVariant }]}
                  onPress={() => open(r.month)}
                  accessibilityRole="button"
                  accessibilityLabel={`Ver ${monthName(key(year, r.month))}`}
                >
                  <Text variant="bodySmall" style={cell(0, false)}>{monthName(key(year, r.month)).split(' ')[0]}</Text>
                </Pressable>
              ))}
              <View style={[styles.row, { borderColor: c.outline }]}>
                <Text variant="bodySmall" style={cell(0, true)}>Total</Text>
              </View>
            </View>
            <ScrollView horizontal style={styles.numbers}>
              <View>
                <View style={[styles.row, { borderColor: c.outlineVariant }]}>
                  {HEAD.slice(1).map((t, i) => <Text key={t} variant="labelMedium" style={cell(i + 1, true)}>{t}</Text>)}
                </View>
                {data.rows.map((r) => (
                  <Pressable
                    key={r.month}
                    style={[styles.row, { borderColor: c.outlineVariant }]}
                    onPress={() => open(r.month)}
                    accessibilityRole="button"
                    accessibilityLabel={`Ver ${monthName(key(year, r.month))}`}
                  >
                    {vals(r, false)}
                  </Pressable>
                ))}
                <View style={[styles.row, { borderColor: c.outline }]}>{vals(data.total, true)}</View>
              </View>
            </ScrollView>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32 },
  sel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 16 },
  col: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 1, height: BAR_H },
  bar: { width: 8, borderTopLeftRadius: 2, borderTopRightRadius: 2 },
  table: { flexDirection: 'row' },
  numbers: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', height: 36, borderBottomWidth: StyleSheet.hairlineWidth }, // altura fija: las dos mitades de la tabla quedan alineadas
  bold: { fontWeight: 'bold' },
});
