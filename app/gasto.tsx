import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Chip, Dialog, HelperText, Portal, Text, TextInput, useTheme } from 'react-native-paper';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useMonth } from '@/src/components/MonthContext';
import * as q from '@/src/db/queries';
import { centsToInput, formatMoney, parseAmount } from '@/src/lib/money';
import { monthOf, today } from '@/src/lib/month';

const OPS = [
  ['+', '+'],
  ['−', '-'],
  ['×', '*'],
  ['÷', '/'],
  ['(', '('],
  [')', ')'],
] as const;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string) => ISO.test(s) && !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function Gasto() {
  const db = useSQLiteContext();
  const c = useTheme().colors;
  const { month } = useMonth();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editId = id ? Number(id) : null;

  const [cats, setCats] = useState<q.Category[]>([]);
  const [cur, setCur] = useState('€');
  const [amount, setAmount] = useState('');
  const [concept, setConcept] = useState('');
  const [catId, setCatId] = useState<number | null>(null);
  // Fecha por defecto: hoy si cae en el mes seleccionado, si no el día 1 de ese mes.
  const [date, setDate] = useState(() => (monthOf(today()) === month ? today() : `${month}-01`));
  const [askDelete, setAskDelete] = useState(false);

  useEffect(() => {
    (async () => {
      const [cs, st] = await Promise.all([q.listCategories(db), q.getSettings(db)]);
      setCats(cs);
      setCur(st.currency);
      if (editId !== null) {
        const e = await q.getExpense(db, editId);
        if (e) {
          setAmount(centsToInput(e.amount));
          setConcept(e.concept);
          setCatId(e.category_id);
          setDate(e.date);
        }
      }
    })();
  }, [db, editId]);

  const parsed = amount.trim() === '' ? null : parseAmount(amount);
  const dateOk = validDate(date);
  const canSave = parsed !== null && parsed > 0 && dateOk;

  const save = async () => {
    if (!canSave) return;
    const name = concept.trim() || cats.find((k) => k.id === catId)?.name || 'Gasto';
    if (editId !== null) await q.updateExpense(db, editId, date, name, parsed, catId);
    else await q.addExpense(db, date, name, parsed, catId);
    router.back();
  };
  const del = async () => {
    if (editId !== null) await q.deleteExpense(db, editId);
    router.back();
  };
  const pickDate = () =>
    DateTimePickerAndroid.open({
      value: dateOk ? new Date(`${date}T12:00:00`) : new Date(),
      mode: 'date',
      onChange: (_e, d) => d && setDate(iso(d)),
    });
  const yesterday = iso(new Date(Date.now() - 86400000));

  return (
    <View style={[styles.flex, { backgroundColor: c.background }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextInput
          mode="outlined"
          label="Importe"
          value={amount}
          onChangeText={setAmount}
          autoFocus
          keyboardType="numbers-and-punctuation"
          error={amount.trim() !== '' && parsed === null}
        />
        <View style={styles.ops}>
          {OPS.map(([label, ch]) => (
            <Button key={ch} mode="outlined" compact onPress={() => setAmount((a) => a + ch)}>
              {label}
            </Button>
          ))}
        </View>
        {amount.trim() !== '' &&
          (parsed === null ? (
            <HelperText type="error">Importe no válido</HelperText>
          ) : (
            <Text variant="titleMedium" style={styles.result}>= {formatMoney(parsed, cur)}</Text>
          ))}

        <Text variant="labelLarge" style={styles.label}>Categoría</Text>
        <View style={styles.chips}>
          {cats.map((k) => (
            <Chip key={k.id} selected={catId === k.id} showSelectedOverlay onPress={() => setCatId(catId === k.id ? null : k.id)}>
              {k.name}
            </Chip>
          ))}
        </View>

        <TextInput mode="outlined" label="Concepto (opcional)" value={concept} onChangeText={setConcept} style={styles.label} />

        <Text variant="labelLarge" style={styles.label}>Fecha</Text>
        <View style={styles.chips}>
          <Chip selected={date === today()} onPress={() => setDate(today())}>Hoy</Chip>
          <Chip selected={date === yesterday} onPress={() => setDate(yesterday)}>Ayer</Chip>
        </View>
        {Platform.OS === 'web' ? (
          <TextInput mode="outlined" dense label="YYYY-MM-DD" value={date} onChangeText={setDate} error={!dateOk} style={styles.label} />
        ) : (
          <Button mode="outlined" icon="calendar" onPress={pickDate} style={styles.label}>{date}</Button>
        )}
        <HelperText type="error" visible={!dateOk}>Fecha no válida (YYYY-MM-DD)</HelperText>

        <Button mode="contained" onPress={save} disabled={!canSave} style={styles.label}>Guardar</Button>
        {editId !== null && (
          <Button textColor={c.error} onPress={() => setAskDelete(true)} style={styles.label}>Borrar</Button>
        )}
      </ScrollView>

      <Portal>
        <Dialog visible={askDelete} onDismiss={() => setAskDelete(false)}>
          <Dialog.Content><Text variant="bodyMedium">¿Borrar este gasto?</Text></Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setAskDelete(false)}>Cancelar</Button>
            <Button textColor={c.error} onPress={del}>Borrar</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  ops: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  result: { marginTop: 8 },
  label: { marginTop: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
});
