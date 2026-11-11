import { View } from 'react-native';
import { HelperText, TextInput } from 'react-native-paper';
import { parseAmount } from '@/src/lib/money';

export function AmountField(p: { label: string; value: string; onChange: (v: string) => void; error?: string }) {
  const bad = p.value.trim() !== '' && parseAmount(p.value) === null;
  const msg = bad ? 'Importe no válido' : p.error;
  return (
    <View>
      <TextInput
        mode="outlined"
        dense
        label={p.label}
        value={p.value}
        onChangeText={p.onChange}
        error={!!msg}
        keyboardType="decimal-pad"
        autoCorrect={false}
        autoCapitalize="none"
      />
      <HelperText type="error" visible={!!msg}>{msg}</HelperText>
    </View>
  );
}
