import { Platform, StyleSheet, View } from 'react-native';
import { Button, Chip, HelperText, Text, TextInput } from 'react-native-paper';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { today } from '@/src/lib/month';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** El padre usa esto para saber si `value` es una fecha válida (deshabilitar Guardar). */
export const validDate = (s: string) => ISO.test(s) && !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function DateField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ok = validDate(value);
  const pickDate = () =>
    DateTimePickerAndroid.open({
      value: ok ? new Date(`${value}T12:00:00`) : new Date(),
      mode: 'date',
      onChange: (_e, d) => d && onChange(iso(d)),
    });
  const yesterday = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return iso(d);
  })();

  return (
    <>
      <Text variant="labelLarge" style={styles.label}>Fecha</Text>
      <View style={styles.chips}>
        <Chip selected={value === today()} onPress={() => onChange(today())}>Hoy</Chip>
        <Chip selected={value === yesterday} onPress={() => onChange(yesterday)}>Ayer</Chip>
      </View>
      {Platform.OS === 'web' ? (
        <TextInput mode="outlined" dense label="YYYY-MM-DD" value={value} onChangeText={onChange} error={!ok} style={styles.label} />
      ) : (
        <Button mode="outlined" icon="calendar" onPress={pickDate} style={styles.label}>{value}</Button>
      )}
      <HelperText type="error" visible={!ok}>Fecha no válida (YYYY-MM-DD)</HelperText>
    </>
  );
}

const styles = StyleSheet.create({
  label: { marginTop: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
});
