import { Pressable, StyleSheet, View } from 'react-native';
import { IconButton, Text } from 'react-native-paper';
import { addMonths, currentMonth, monthName } from '@/src/lib/month';
import { useMonth } from './MonthContext';

export function MonthSelector() {
  const { month, setMonth } = useMonth();
  return (
    <View style={styles.row}>
      <IconButton icon="chevron-left" accessibilityLabel="Mes anterior" onPress={() => setMonth(addMonths(month, -1))} />
      <Pressable onPress={() => setMonth(currentMonth())} accessibilityLabel="Ir al mes actual">
        <Text variant="titleMedium">{monthName(month)}</Text>
      </Pressable>
      <IconButton icon="chevron-right" accessibilityLabel="Mes siguiente" onPress={() => setMonth(addMonths(month, 1))} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
});
