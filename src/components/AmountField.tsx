import { View } from 'react-native';
import { HelperText, TextInput } from 'react-native-paper';
import { parseAmount } from '@/src/lib/money';

export function AmountField(p: { label: string; value: string; onChange: (v: string) => void }) {
  const bad = p.value.trim() !== '' && parseAmount(p.value) === null;
  return (
    <View>
      <TextInput
        mode="outlined"
        dense
        label={p.label}
        value={p.value}
        onChangeText={p.onChange}
        error={bad}
        keyboardType="decimal-pad"
        autoCorrect={false}
        autoCapitalize="none"
      />
      <HelperText type="error" visible={bad}>Importe no válido</HelperText>
    </View>
  );
}
