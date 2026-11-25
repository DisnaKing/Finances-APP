import { MD3DarkTheme, MD3LightTheme, adaptNavigationTheme, useTheme, type MD3Theme } from 'react-native-paper';
import { DarkTheme as NavDark, DefaultTheme as NavLight } from 'expo-router';

type NavTheme = Parameters<typeof adaptNavigationTheme>[0]['reactNavigationLight'] & {};

export type AppTheme = MD3Theme & {
  colors: MD3Theme['colors'] & {
    navBar: string;
    // Tarjeta protagonista: oscura en ambos modos, con sus propios colores de contenido.
    hero: string;
    onHero: string;
    onHeroMuted: string;
    heroAccent: string;
    heroTrack: string;
    heroError: string;
  };
};

/** Tema de Paper con los colores propios ya tipados. */
export const useAppTheme = () => useTheme<AppTheme>();

// Paleta "Medianoche": fintech de azules pizarra y verde menta, con la cifra principal como protagonista.
export const lightTheme: AppTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#00805F',
    onPrimary: '#FFFFFF',
    primaryContainer: '#C4F0DF',
    onPrimaryContainer: '#00281C',
    secondary: '#47607A',
    onSecondary: '#FFFFFF',
    secondaryContainer: '#DCE6F0',
    onSecondaryContainer: '#12283D',
    tertiary: '#2F62B8',
    onTertiary: '#FFFFFF',
    tertiaryContainer: '#DAE5FA',
    onTertiaryContainer: '#0B2455',
    background: '#F2F5F7',
    onBackground: '#0B1520',
    surface: '#F2F5F7',
    onSurface: '#0B1520',
    surfaceVariant: '#E4EAEF',
    onSurfaceVariant: '#5C6B7A',
    outline: '#617282',
    outlineVariant: '#DCE3E8',
    error: '#C4261D',
    onError: '#FFFFFF',
    errorContainer: '#FFDAD6',
    onErrorContainer: '#410002',
    inversePrimary: '#3DE0A8',
    inverseSurface: '#1B2733',
    inverseOnSurface: '#EEF3F6',
    elevation: {
      level0: 'transparent',
      level1: '#FFFFFF',
      level2: '#FFFFFF',
      level3: '#FFFFFF',
      level4: '#FAFCFD',
      level5: '#F7FAFB',
    },
    navBar: '#FFFFFF',
    hero: '#0B1520',
    onHero: '#FFFFFF',
    onHeroMuted: '#9DB0C0',
    heroAccent: '#3DE0A8',
    heroTrack: '#34495C',
    heroError: '#FF8A80',
  },
};

export const darkTheme: AppTheme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#3DE0A8',
    onPrimary: '#04241A',
    primaryContainer: '#0F4A38',
    onPrimaryContainer: '#B4F5DB',
    secondary: '#A9C1D9',
    onSecondary: '#112A40',
    secondaryContainer: '#263A4F',
    onSecondaryContainer: '#D5E4F3',
    tertiary: '#8AB4FF',
    onTertiary: '#062552',
    tertiaryContainer: '#1E3A6B',
    onTertiaryContainer: '#D9E4FF',
    background: '#0A1017',
    onBackground: '#E8F0F5',
    surface: '#0A1017',
    onSurface: '#E8F0F5',
    surfaceVariant: '#1C2935',
    onSurfaceVariant: '#8395A5',
    outline: '#6C8092',
    outlineVariant: '#1F2C38',
    error: '#FF8A80',
    onError: '#4A0703',
    errorContainer: '#8C1D18',
    onErrorContainer: '#FFDAD6',
    inversePrimary: '#00664C',
    inverseSurface: '#E8F0F5',
    inverseOnSurface: '#16212C',
    elevation: {
      level0: 'transparent',
      level1: '#131C26',
      level2: '#151F2A',
      level3: '#17222E',
      level4: '#192532',
      level5: '#1B2835',
    },
    navBar: '#0E161F',
    hero: '#162330',
    onHero: '#E8F0F5',
    onHeroMuted: '#9DB0C0',
    heroAccent: '#3DE0A8',
    heroTrack: '#34495C',
    heroError: '#FF8A80',
  },
};

// Tema de react-navigation (cabeceras / fondo) con los mismos colores.
const adapted = adaptNavigationTheme({
  // expo-router tipa los colores como ColorValue; Paper espera string.
  reactNavigationLight: NavLight as unknown as NavTheme,
  reactNavigationDark: NavDark as unknown as NavTheme,
  materialLight: lightTheme,
  materialDark: darkTheme,
});

// Cabeceras del color del fondo y bordes suaves.
const nav = (t: typeof adapted.LightTheme, { colors }: AppTheme) => ({
  ...t,
  colors: { ...t.colors, card: colors.background, border: colors.outlineVariant },
});
// adaptNavigationTheme no copia las fuentes que expo-router exige.
export const navLightTheme = { ...nav(adapted.LightTheme, lightTheme), fonts: NavLight.fonts };
export const navDarkTheme = { ...nav(adapted.DarkTheme, darkTheme), fonts: NavDark.fonts };
