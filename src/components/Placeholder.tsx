import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { FAB, Text, useTheme } from 'react-native-paper';

/** Pantalla provisional con FAB "+" hacia /gasto (fase 0). */
export function Placeholder({ fab = true }: { fab?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <Text variant="titleMedium" style={{ color: colors.onSurfaceVariant }}>
        Próximamente
      </Text>
      {fab && <FAB icon="plus" style={styles.fab} onPress={() => router.navigate('/gasto')} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fab: { position: 'absolute', right: 16, bottom: 16 },
});
