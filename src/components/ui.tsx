import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { FAB, Text } from 'react-native-paper';
import { useAppTheme } from '@/src/theme';

/** FAB "+" hacia /gasto, igual en todas las pantallas. */
export function AddExpenseFab() {
  const { colors } = useAppTheme();
  return (
    <FAB
      icon="plus"
      accessibilityLabel="Añadir gasto"
      color={colors.onPrimary}
      style={[styles.fab, { backgroundColor: colors.primary }]}
      onPress={() => router.navigate('/gasto')}
    />
  );
}

/**
 * Texto de una sola línea que reduce la letra para caber en su ancho (importes largos).
 * Se calcula a partir del ancho medido porque `adjustsFontSizeToFit` no existe en web.
 * El contenedor debe tener ancho propio (estirado por el padre).
 */
export function FitText({ children, size, style }: { children: string; size: number; style?: StyleProp<TextStyle> }) {
  const [width, setWidth] = useState(0);
  // 0,6 em ≈ ancho medio (por exceso) de una cifra.
  const fontSize = width ? Math.max(8, Math.min(size, Math.floor(width / (children.length * 0.6)))) : size;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Text numberOfLines={1} adjustsFontSizeToFit style={[style, { fontSize, lineHeight: Math.round(size * 1.25) }]}>
        {children}
      </Text>
    </View>
  );
}

/** Barra de progreso; `progress` se acota a 0..1. */
export function Bar({ progress, height, color, track }: { progress: number; height: number; color: string; track: string }) {
  const pct = Math.max(0, Math.min(1, progress)) * 100;
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: track, overflow: 'hidden' }}>
      <View style={{ height, width: `${pct}%`, backgroundColor: color }} />
    </View>
  );
}

/** Tarjeta protagonista. Su contenido debe usar los colores `onHero*` / `hero*`. */
export function HeroCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useAppTheme();
  return <View style={[styles.hero, { backgroundColor: colors.hero }, style]}>{children}</View>;
}

/** Etiqueta + importe dentro de una HeroCard; dos en fila se reparten el ancho. */
export function HeroStat({ label, value, end }: { label: string; value: string; end?: boolean }) {
  const { colors } = useAppTheme();
  const align = { textAlign: end ? ('right' as const) : ('left' as const) };
  return (
    <View style={styles.stat}>
      <Text variant="labelMedium" style={[align, { color: colors.onHeroMuted }]}>{label}</Text>
      <FitText size={24} style={[styles.figure, align, { color: colors.onHero }]}>{value}</FitText>
    </View>
  );
}

const styles = StyleSheet.create({
  fab: { position: 'absolute', right: 16, bottom: 16, borderRadius: 14 },
  hero: { borderRadius: 14, padding: 16 },
  stat: { flex: 1 },
  figure: { fontWeight: '700' },
});
