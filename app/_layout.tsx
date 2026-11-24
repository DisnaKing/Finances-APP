import { ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { MonthProvider } from '@/src/components/MonthContext';
import { QuoteSync } from '@/src/components/QuoteSync';
import { migrate } from '@/src/db/schema';
import { darkTheme, lightTheme, navDarkTheme, navLightTheme } from '@/src/theme';

export default function RootLayout() {
  const dark = useColorScheme() === 'dark';
  // SQLiteProvider va fuera para que los portales de Paper (Dialog/Menu) puedan usar useSQLiteContext.
  return (
    <SQLiteProvider databaseName="mny.db" onInit={migrate} onError={(e) => console.error('SQLite', e)}>
      <QuoteSync />
      <MonthProvider>
        <PaperProvider theme={dark ? darkTheme : lightTheme}>
          <ThemeProvider value={dark ? navDarkTheme : navLightTheme}>
            <StatusBar style={dark ? 'light' : 'dark'} />
            <Stack>
              <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Inicio' }} />
              <Stack.Screen name="gasto" options={{ presentation: 'modal', title: 'Gasto' }} />
              <Stack.Screen name="deudas" options={{ title: 'Deudas' }} />
              <Stack.Screen name="ajustes" options={{ title: 'Ajustes' }} />
            </Stack>
          </ThemeProvider>
        </PaperProvider>
      </MonthProvider>
    </SQLiteProvider>
  );
}
