import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Card, FAB, Text, useTheme } from 'react-native-paper';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { MonthSelector } from '@/src/components/MonthSelector';
import { useMonth } from '@/src/components/MonthContext';
import { ensureIncomes, getSettings, monthInput } from '@/src/db/queries';
import { monthSummary } from '@/src/lib/calc';
import { formatMoney } from '@/src/lib/money';

type Summary = ReturnType<typeof monthSummary>;

const ROWS = [
  { key: 'billsSpent', label: 'Facturas' },
  { key: 'expensesSpent', label: 'Gastos' },
  { key: 'saved', label: 'Ahorros' },
  { key: 'invested', label: 'Inversión' },
  { key: 'debtPaid', label: 'Deuda' },
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
        try {
          await ensureIncomes(db, month);
          const [input, st] = await Promise.all([monthInput(db, month), getSettings(db)]);
          if (live) {
            setS(monthSummary(input));
            setCur(st.currency);
          }
        } catch (e) {
          console.error(e);
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

            <Text variant="titleMedium" style={styles.title}>Desglose del mes</Text>
            {ROWS.map(({ key, label }) => (
              <View key={key} style={[styles.between, styles.row]}>
                <Text variant="bodyLarge" style={styles.flex}>{label}</Text>
                <Text variant="bodyLarge">{m(s[key])}</Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>
      <FAB icon="plus" accessibilityLabel="Añadir gasto" style={styles.fab} onPress={() => router.navigate('/gasto')} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 96 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  card: { flexBasis: '48%', flexGrow: 1 },
  title: { marginTop: 24, marginBottom: 8 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  row: { paddingVertical: 6, gap: 8 },
  fab: { position: 'absolute', right: 16, bottom: 16 },
});
