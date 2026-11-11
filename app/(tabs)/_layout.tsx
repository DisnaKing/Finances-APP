import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs, router } from 'expo-router';
import { Menu, IconButton, useTheme } from 'react-native-paper';
import { useState } from 'react';
import type { ColorValue } from 'react-native';

type Icon = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
const tab = (title: string, icon: Icon) => ({
  title,
  tabBarIcon: ({ color, size }: { color: ColorValue; size: number }) => (
    <MaterialCommunityIcons name={icon} color={color as string} size={size} />
  ),
});

function HomeMenu() {
  const [open, setOpen] = useState(false);
  const go = (path: '/deudas' | '/anual' | '/ajustes') => {
    setOpen(false);
    router.push(path);
  };
  return (
    <Menu
      visible={open}
      onDismiss={() => setOpen(false)}
      anchor={<IconButton icon="dots-vertical" onPress={() => setOpen(true)} />}
    >
      <Menu.Item leadingIcon="credit-card-outline" title="Deudas" onPress={() => go('/deudas')} />
      <Menu.Item leadingIcon="calendar-month" title="Anual" onPress={() => go('/anual')} />
      <Menu.Item leadingIcon="cog" title="Ajustes" onPress={() => go('/ajustes')} />
    </Menu>
  );
}

export default function TabsLayout() {
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.onPrimaryContainer,
        tabBarInactiveTintColor: colors.onSurfaceVariant,
        tabBarActiveBackgroundColor: colors.primaryContainer,
        tabBarStyle: { backgroundColor: colors.elevation.level2 },
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.onBackground,
      }}
    >
      <Tabs.Screen name="index" options={{ ...tab('Inicio', 'home'), headerRight: () => <HomeMenu /> }} />
      <Tabs.Screen name="mes" options={tab('Mes', 'format-list-bulleted')} />
      <Tabs.Screen name="ahorro" options={tab('Ahorro', 'piggy-bank')} />
      <Tabs.Screen name="inversion" options={tab('Inversión', 'chart-line')} />
    </Tabs>
  );
}
