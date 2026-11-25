import { StyleSheet, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { AddExpenseFab } from '@/src/components/ui';

/** Pantalla provisional con FAB "+" hacia /gasto (fase 0). */
export function Placeholder({ fab = true }: { fab?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <Text variant="titleMedium" style={{ color: colors.onSurfaceVariant }}>
        Próximamente
      </Text>
      {fab && <AddExpenseFab />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
