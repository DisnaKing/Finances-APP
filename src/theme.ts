import { MD3DarkTheme, MD3LightTheme, adaptNavigationTheme } from 'react-native-paper';
import { DarkTheme as NavDark, DefaultTheme as NavLight } from 'expo-router';

type NavTheme = Parameters<typeof adaptNavigationTheme>[0]['reactNavigationLight'] & {};

// Paleta "naturaleza" (PLAN.md §4b). Los on* y elevaciones son derivados cálidos.
export const lightTheme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#3E6B37',
    onPrimary: '#FFFFFF',
    primaryContainer: '#C5E8B7',
    onPrimaryContainer: '#0F2A0C',
    secondary: '#8A6440',
    onSecondary: '#FFFFFF',
    secondaryContainer: '#F0E2D2',
    onSecondaryContainer: '#2B1D10',
    tertiary: '#5B7F4A',
    onTertiary: '#FFFFFF',
    tertiaryContainer: '#D9EBC9',
    onTertiaryContainer: '#0F2A0C',
    background: '#F8F5EE',
    onBackground: '#1C1B17',
    surface: '#F8F5EE',
    onSurface: '#1C1B17',
    surfaceVariant: '#EEEADF',
    onSurfaceVariant: '#4A4A40',
    outline: '#7B7B6F',
    outlineVariant: '#CBC9BC',
    error: '#BA1A1A',
    onError: '#FFFFFF',
    errorContainer: '#FFDAD6',
    onErrorContainer: '#410002',
    inversePrimary: '#A8D29A',
    inverseSurface: '#31302B',
    inverseOnSurface: '#F3F0E8',
    elevation: {
      level0: 'transparent',
      level1: '#F2EFE5',
      level2: '#EEEADF',
      level3: '#E9E5D8',
      level4: '#E7E3D5',
      level5: '#E4DFD0',
    },
  },
};

export const darkTheme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#A8D29A',
    onPrimary: '#0F2A0C',
    primaryContainer: '#264F22',
    onPrimaryContainer: '#C5E8B7',
    secondary: '#D9B48C',
    onSecondary: '#2B1D10',
    secondaryContainer: '#4A3826',
    onSecondaryContainer: '#F0E2D2',
    tertiary: '#8FB97E',
    onTertiary: '#0F2A0C',
    tertiaryContainer: '#3E5F31',
    onTertiaryContainer: '#D9EBC9',
    background: '#1A1C17',
    onBackground: '#E3E3DA',
    surface: '#1A1C17',
    onSurface: '#E3E3DA',
    surfaceVariant: '#24261F',
    onSurfaceVariant: '#C6C7BA',
    outline: '#909185',
    outlineVariant: '#44463C',
    error: '#FFB4AB',
    onError: '#690005',
    errorContainer: '#93000A',
    onErrorContainer: '#FFDAD6',
    inversePrimary: '#3E6B37',
    inverseSurface: '#E3E3DA',
    inverseOnSurface: '#2F312B',
    elevation: {
      level0: 'transparent',
      level1: '#21241C',
      level2: '#252921',
      level3: '#292D24',
      level4: '#2B2F26',
      level5: '#2E3228',
    },
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

// adaptNavigationTheme no copia las fuentes que expo-router exige.
export const navLightTheme = { ...adapted.LightTheme, fonts: NavLight.fonts };
export const navDarkTheme = { ...adapted.DarkTheme, fonts: NavDark.fonts };
