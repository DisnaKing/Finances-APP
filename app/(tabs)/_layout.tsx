import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs, router } from 'expo-router';
import { Menu, IconButton, useTheme } from 'react-native-paper';
import { useState } from 'react';
import { View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Icon = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
// Icono dentro de una "píldora" (indicador activo MD3).
const tab = (title: string, icon: Icon, activeBg: string, activeIcon: string) => ({
  title,
  tabBarIcon: ({ focused, color }: { focused: boolean; color: ColorValue; size: number }) => (
    <View
      style={{
        width: 64,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: focused ? activeBg : 'transparent',
      }}
    >
      <MaterialCommunityIcons name={icon} color={focused ? activeIcon : (color as string)} size={24} />
    </View>
  ),
});

function HomeMenu() {
  const [open, setOpen] = useState(false);
  const go = (path: '/deudas' | '/ajustes') => {
    setOpen(false);
    router.push(path);
  };
  return (
    <Menu
      visible={open}
      onDismiss={() => setOpen(false)}
      anchor={<IconButton icon="dots-vertical" accessibilityLabel="Más opciones" onPress={() => setOpen(true)} />}
    >
      <Menu.Item leadingIcon="credit-card-outline" title="Deudas" onPress={() => go('/deudas')} />
      <Menu.Item leadingIcon="cog" title="Ajustes" onPress={() => go('/ajustes')} />
    </Menu>
  );
}

export default function TabsLayout() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const t = (title: string, icon: Icon) => tab(title, icon, colors.primaryContainer, colors.onPrimaryContainer);
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.onSurface,
        tabBarInactiveTintColor: colors.onSurfaceVariant,
        tabBarStyle: {
          backgroundColor: colors.elevation.level2,
          height: 72 + insets.bottom,
          paddingBottom: insets.bottom + 8,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontSize: 12, marginTop: 4 },
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.onBackground,
      }}
    >
      <Tabs.Screen name="index" options={{ ...t('Inicio', 'home'), headerRight: () => <HomeMenu /> }} />
      <Tabs.Screen name="mes" options={t('Mes', 'format-list-bulleted')} />
      <Tabs.Screen name="ahorro" options={t('Ahorro', 'piggy-bank')} />
      <Tabs.Screen name="inversion" options={t('Inversión', 'chart-line')} />
      <Tabs.Screen name="totales" options={t('Totales', 'calendar-month')} />
    </Tabs>
  );
}
