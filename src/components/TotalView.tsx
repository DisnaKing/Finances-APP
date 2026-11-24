import { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Card, Text, useTheme } from 'react-native-paper';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import * as q from '@/src/db/queries';
import { grandTotal, monthSummary, yearSummary, type Totals } from '@/src/lib/calc';
import { formatMoney } from '@/src/lib/money';

const COL_W = 92;
const HEAD = ['Año', 'Ingresos', 'Gastado', 'Ahorro+Inv.', 'Deuda', 'Restante'];

/** Totales de toda la vida de la app: tarjetas con el acumulado y una fila por año. */
export function TotalView() {
  const db = useSQLiteContext();
  const c = useTheme().colors;
  const [cur, setCur] = useState('€');
  const [years, setYears] = useState<{ year: number; t: Totals }[] | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const n = ++seq.current;
    try {
      const [range, st] = await Promise.all([q.dataYears(db), q.getSettings(db)]);
      const out: { year: number; t: Totals }[] = [];
      if (range) {
        for (let y = range[0]; y <= range[1]; y++) {
          const t = yearSummary((await q.yearInputs(db, y)).map(monthSummary)).total;
          if (Object.values(t).some((v) => v !== 0)) out.push({ year: y, t }); // años sin movimientos no aportan filas
        }
      }
      if (n !== seq.current) return; // llegó otra carga más reciente
      setYears(out);
      setCur(st.currency);
    } catch (err) {
      console.error(err);
    }
  }, [db]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const m = (x: number) => formatMoney(x, cur);
  const total = grandTotal((years ?? []).map((y) => y.t));
  const cell = (i: number, bold = false, color?: string) => [
    { width: COL_W, textAlign: i === 0 ? ('left' as const) : ('right' as const), color },
    bold && styles.bold,
  ];
  const vals = (t: Totals, bold: boolean) => (
    <>
      <Text variant="bodySmall" style={cell(1, bold)}>{m(t.income)}</Text>
      <Text variant="bodySmall" style={cell(2, bold)}>{m(t.spent)}</Text>
      <Text variant="bodySmall" style={cell(3, bold)}>{m(t.saved + t.invested)}</Text>
      <Text variant="bodySmall" style={cell(4, bold)}>{m(t.debtPaid)}</Text>
      <Text variant="bodySmall" style={cell(5, bold, t.remaining < 0 ? c.error : undefined)}>{m(t.remaining)}</Text>
    </>
  );
  const cards: { label: string; value: number; bg: string; neg?: boolean }[] = [
    { label: 'Ingresos', value: total.income, bg: c.surfaceVariant },
    { label: 'Gastado', value: total.spent, bg: c.secondaryContainer },
    { label: 'Ahorrado', value: total.saved, bg: c.secondaryContainer },
    { label: 'Invertido', value: total.invested, bg: c.secondaryContainer },
    { label: 'Deuda pagada', value: total.debtPaid, bg: c.secondaryContainer },
    { label: 'Restante', value: total.remaining, bg: c.primaryContainer, neg: true },
  ];

  return (
    <ScrollView style={{ backgroundColor: c.background }} contentContainerStyle={styles.content}>
      {years !== null && years.length === 0 && <Text variant="bodyMedium">Aún no hay movimientos.</Text>}
      {years !== null && years.length > 0 && (
        <>
          <View style={styles.grid}>
            {cards.map((k) => (
              <Card key={k.label} style={[styles.card, { backgroundColor: k.bg }]}>
                <Card.Content>
                  <Text variant="labelMedium">{k.label}</Text>
                  <Text variant="titleLarge" style={k.neg && k.value < 0 ? { color: c.error } : undefined}>{m(k.value)}</Text>
                </Card.Content>
              </Card>
            ))}
          </View>

          <Text variant="titleMedium" style={styles.title}>Por año</Text>
          <ScrollView horizontal>
            <View>
              <View style={[styles.row, { borderColor: c.outlineVariant }]}>
                {HEAD.map((t, i) => <Text key={t} variant="labelMedium" style={cell(i, true)}>{t}</Text>)}
              </View>
              {years.map((y) => (
                <View key={y.year} style={[styles.row, { borderColor: c.outlineVariant }]}>
                  <Text variant="bodySmall" style={cell(0)}>{y.year}</Text>
                  {vals(y.t, false)}
                </View>
              ))}
              <View style={[styles.row, { borderColor: c.outline }]}>
                <Text variant="bodySmall" style={cell(0, true)}>Total</Text>
                {vals(total, true)}
              </View>
            </View>
          </ScrollView>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: { flexBasis: '48%', flexGrow: 1 },
  title: { marginTop: 24, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', height: 36, borderBottomWidth: StyleSheet.hairlineWidth },
  bold: { fontWeight: 'bold' },
});
