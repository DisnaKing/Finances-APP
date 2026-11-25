import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { MonthSelector } from '@/src/components/MonthSelector';
import { useMonth } from '@/src/components/MonthContext';
import { AddExpenseFab, Bar, FitText, HeroCard } from '@/src/components/ui';
import { ensureIncomes, getSettings, monthInput } from '@/src/db/queries';
import { monthSummary } from '@/src/lib/calc';
import { formatMoney, formatPct } from '@/src/lib/money';
import { useAppTheme } from '@/src/theme';

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
  const theme = useAppTheme();
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
  // Proporción sobre los ingresos, acotada a 0..1 (0 sin ingresos).
  const ratio = (x: number) => (s && s.income > 0 ? Math.max(0, Math.min(1, x / s.income)) : 0);

  return (
    <View style={[styles.flex, { backgroundColor: c.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <MonthSelector />
        {s && (
          <>
            <HeroCard style={styles.hero}>
              <Text variant="labelLarge" style={{ color: c.onHeroMuted }}>Restante</Text>
              <FitText size={34} style={[styles.figure, { color: s.remaining < 0 ? c.heroError : c.heroAccent }]}>
                {m(s.remaining)}
              </FitText>
              <Bar progress={ratio(s.remaining)} height={6} color={c.heroAccent} track={c.heroTrack} />
              {s.income > 0 && (
                <Text variant="bodySmall" style={{ color: c.onHeroMuted }}>
                  Queda el {formatPct(ratio(s.remaining), false)} de los ingresos
                </Text>
              )}
            </HeroCard>

            <View style={styles.tiles}>
              {[
                { label: 'Ingresos', value: s.income },
                { label: 'Gastado', value: s.spent },
                { label: 'Ahorro + inv.', value: s.saved + s.invested },
              ].map((t) => (
                <View key={t.label} style={[styles.tile, { backgroundColor: c.elevation.level1 }]}>
                  <Text variant="labelMedium" numberOfLines={1} style={{ color: c.onSurfaceVariant }}>{t.label}</Text>
                  <FitText size={17} style={styles.figure}>{m(t.value)}</FitText>
                </View>
              ))}
            </View>

            <Text variant="titleMedium" style={styles.title}>Desglose del mes</Text>
            {ROWS.map(({ key, label }) => (
              <View key={key} style={styles.row}>
                <View style={styles.between}>
                  <Text variant="bodyLarge" style={styles.flex}>{label}</Text>
                  <Text variant="bodyLarge">{m(s[key])}</Text>
                </View>
                <Bar progress={ratio(s[key])} height={3} color={c.primary} track={c.outlineVariant} />
              </View>
            ))}
          </>
        )}
      </ScrollView>
      <AddExpenseFab />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 96 },
  hero: { marginTop: 8, gap: 8 },
  figure: { fontWeight: '700' },
  tiles: { flexDirection: 'row', gap: 8, marginTop: 8 },
  tile: { flex: 1, minWidth: 0, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 10, gap: 4 },
  title: { marginTop: 24, marginBottom: 8 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  row: { paddingVertical: 6, gap: 6 },
});
