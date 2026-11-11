import { Platform, StyleSheet, View } from 'react-native';
import { Button, Chip, HelperText, Text, TextInput } from 'react-native-paper';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { formatDate, today } from '@/src/lib/month';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** El padre usa esto para saber si `value` es una fecha válida (deshabilitar Guardar). */
export const validDate = (s: string) => ISO.test(s) && !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** `max`/`min` (ISO) opcionales: fechas fuera de rango se marcan como error (el padre debe también deshabilitar Guardar). `label` (def. "Fecha"); `chips={false}` oculta Hoy/Ayer. */
export function DateField(p: { value: string; onChange: (v: string) => void; max?: string; min?: string; label?: string; chips?: boolean }) {
  const { value, onChange, max, min } = p;
  const ok = validDate(value);
  const late = ok && max !== undefined && value > max;
  const early = ok && min !== undefined && value < min;
  const pickDate = () =>
    DateTimePickerAndroid.open({
      value: ok ? new Date(`${value}T12:00:00`) : new Date(),
      mode: 'date',
      minimumDate: min !== undefined && validDate(min) ? new Date(`${min}T00:00:00`) : undefined,
      onChange: (_e, d) => d && onChange(iso(d)),
    });
  const yesterday = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return iso(d);
  })();

  return (
    <>
      <Text variant="labelLarge" style={styles.label}>{p.label ?? 'Fecha'}</Text>
      {p.chips !== false && (
        <View style={styles.chips}>
          <Chip selected={value === today()} onPress={() => onChange(today())}>Hoy</Chip>
          <Chip selected={value === yesterday} onPress={() => onChange(yesterday)}>Ayer</Chip>
        </View>
      )}
      {Platform.OS === 'web' ? (
        <TextInput mode="outlined" dense label="AAAA-MM-DD" value={value} onChangeText={onChange} error={!ok || late || early} style={styles.label} />
      ) : (
        <Button mode="outlined" icon="calendar" onPress={pickDate} style={styles.label}>{ok ? formatDate(value) : value}</Button>
      )}
      <HelperText type="error" visible={!ok || late || early}>
        {late ? 'La fecha no puede ser futura' : early ? `No puede ser anterior a ${formatDate(min!)}` : 'Fecha no válida (AAAA-MM-DD)'}
      </HelperText>
    </>
  );
}

const styles = StyleSheet.create({
  label: { marginTop: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
});
