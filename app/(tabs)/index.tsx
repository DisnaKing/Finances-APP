import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Card, FAB, ProgressBar, Text, useTheme } from 'react-native-paper';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { MonthSelector } from '@/src/components/MonthSelector';
import { useMonth } from '@/src/components/MonthContext';
import { getSettings, monthInput } from '@/src/db/queries';
import { monthSummary } from '@/src/lib/calc';
import { formatMoney } from '@/src/lib/money';

type Summary = ReturnType<typeof monthSummary>;

const SPLIT = [
  { key: 'needs', label: 'Necesidades', color: 'primary' },
  { key: 'wants', label: 'Deseos', color: 'secondary' },
  { key: 'savings', label: 'Ahorros', color: 'tertiary' },
] as const;

const ROWS = [
  { key: 'bills', label: 'Facturas' },
  { key: 'expenses', label: 'Gastos' },
  { key: 'savings', label: 'Ahorros' },
  { key: 'investment', label: 'Inversión' },
  { key: 'debt', label: 'Deuda' },
] as const;

export default function Inicio() {
  const db = useSQLiteContext();
  const { month } = useMonth();
  const theme = useTheme();
  const [s, setS] = useState<Summary | null>(null);
  const [cur, setCur] = useState('€');

  useFocusEffect(
    useCallback(() => {
      let live = true;
      (async () => {
        const [input, st] = await Promise.all([monthInput(db, month), getSettings(db)]);
        if (live) {
          setS(monthSummary(input));
          setCur(st.currency);
        }
      })();
      return () => {
        live = false;
      };
    }, [db, month]),
  );

  const m = (c: number) => formatMoney(c, cur);
  const c = theme.colors;

  return (
    <View style={[styles.flex, { backgroundColor: c.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <MonthSelector />
        {s && (
          <>
            <View style={styles.grid}>
              <Card style={[styles.card, { backgroundColor: c.surfaceVariant }]}>
                <Card.Content>
                  <Text variant="labelMedium">Ingresos</Text>
                  <Text variant="titleLarge">{m(s.income)}</Text>
                  <Text variant="bodySmall">de {m(s.incomeBudget)} previsto</Text>
                </Card.Content>
              </Card>
              <Card style={[styles.card, { backgroundColor: c.secondaryContainer }]}>
                <Card.Content>
                  <Text variant="labelMedium">Gastado</Text>
                  <Text variant="titleLarge">{m(s.spent)}</Text>
                </Card.Content>
              </Card>
              <Card style={[styles.card, { backgroundColor: c.secondaryContainer }]}>
                <Card.Content>
                  <Text variant="labelMedium">Ahorrado + invertido</Text>
                  <Text variant="titleLarge">{m(s.saved + s.invested)}</Text>
                </Card.Content>
              </Card>
              <Card style={[styles.card, { backgroundColor: c.primaryContainer }]}>
                <Card.Content>
                  <Text variant="labelMedium">Restante</Text>
                  <Text variant="titleLarge" style={s.remaining < 0 ? { color: c.error } : undefined}>
                    {m(s.remaining)}
                  </Text>
                </Card.Content>
              </Card>
            </View>

            <Text variant="titleMedium" style={styles.title}>50/30/20</Text>
            {SPLIT.map(({ key, label, color }) => {
              const { budget, actual } = s.split[key];
              const over = actual > budget;
              return (
                <View key={key} style={styles.split}>
                  <View style={styles.between}>
                    <Text variant="bodyLarge">{label}</Text>
                    <Text variant="bodyMedium" style={over ? { color: c.error } : undefined}>
                      {m(actual)} / {m(budget)}
                    </Text>
                  </View>
                  <ProgressBar
                    progress={budget > 0 ? Math.min(Math.max(actual / budget, 0), 1) : actual > 0 ? 1 : 0}
                    color={over ? c.error : c[color]}
                    style={styles.bar}
                  />
                </View>
              );
            })}

            <Text variant="titleMedium" style={styles.title}>Presupuesto vs real</Text>
            {ROWS.map(({ key, label }) => {
              const { budget, actual } = s.rows[key];
              const diff = budget - actual;
              return (
                <View key={key} style={[styles.between, styles.row]}>
                  <Text variant="bodyLarge" style={styles.flex}>{label}</Text>
                  <Text variant="bodySmall" style={styles.num}>prev. {m(budget)}</Text>
                  <Text variant="bodySmall" style={styles.num}>real {m(actual)}</Text>
                  <Text variant="bodyMedium" style={[styles.num, diff < 0 && { color: c.error }]}>{m(diff)}</Text>
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
      <FAB icon="plus" style={styles.fab} onPress={() => router.push('/gasto')} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 96 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  card: { flexBasis: '48%', flexGrow: 1 },
  title: { marginTop: 24, marginBottom: 8 },
  split: { marginBottom: 12 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bar: { height: 8, borderRadius: 4, marginTop: 4 },
  row: { paddingVertical: 6, gap: 8 },
  num: { minWidth: 72, textAlign: 'right' },
  fab: { position: 'absolute', right: 16, bottom: 16 },
});
