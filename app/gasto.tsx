import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Chip, Dialog, HelperText, Portal, Text, TextInput, useTheme } from 'react-native-paper';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { DateField, validDate } from '@/src/components/DateField';
import { useMonth } from '@/src/components/MonthContext';
import { useGuard } from '@/src/components/useGuard';
import * as q from '@/src/db/queries';
import { centsToInput, formatMoney, insertAt, parseAmount } from '@/src/lib/money';
import { monthOf, today } from '@/src/lib/month';

const OPS = [
  ['+', '+'],
  ['−', '-'],
  ['×', '*'],
  ['÷', '/'],
  ['(', '('],
  [')', ')'],
] as const;

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
  const [busy, run] = useGuard();
  // Operadores: cursor/selección actuales del campo Importe y selección forzada tras insertar (se limpia al aplicarse).
  const amountRef = useRef<{ focus(): void }>(null);
  const selRef = useRef({ start: 0, end: 0 });
  const [forceSel, setForceSel] = useState<{ start: number; end: number } | undefined>();

  useEffect(() => {
    (async () => {
      try {
        const [cs, st] = await Promise.all([q.listCategories(db), q.getSettings(db)]);
        setCats(cs);
        setCur(st.currency);
        if (editId !== null) {
          const e = await q.getExpense(db, editId);
          if (e) {
            const t = centsToInput(e.amount);
            selRef.current = { start: t.length, end: t.length };
            setAmount(t);
            setConcept(e.concept);
            setCatId(e.category_id);
            setDate(e.date);
          }
        }
      } catch (e) {
        console.error(e);
      }
    })();
  }, [db, editId]);

  const parsed = amount.trim() === '' ? null : parseAmount(amount);
  const dateOk = validDate(date);
  const canSave = parsed !== null && parsed > 0 && dateOk && !busy;

  // keepLocked: la pantalla se cierra al terminar; si falla, se desbloquea.
  const save = () => {
    if (!canSave) return;
    return run(async () => {
      const name = concept.trim() || cats.find((k) => k.id === catId)?.name || 'Gasto';
      if (editId !== null) await q.updateExpense(db, editId, date, name, parsed, catId);
      else await q.addExpense(db, date, name, parsed, catId);
      router.back();
    }, true);
  };
  const del = () =>
    run(async () => {
      if (editId !== null) await q.deleteExpense(db, editId);
      router.back();
    }, true);
  const addOp = (ch: string) => {
    const { start, end } = selRef.current;
    const r = insertAt(amount, ch, start, end);
    selRef.current = { start: r.pos, end: r.pos };
    setForceSel({ start: r.pos, end: r.pos });
    setAmount(r.text);
    amountRef.current?.focus();
  };

  return (
    <View style={[styles.flex, { backgroundColor: c.background }]}>
      <Stack.Screen options={{ headerRight: () => <Button onPress={save} disabled={!canSave}>Guardar</Button> }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextInput
          mode="outlined"
          label="Importe"
          ref={amountRef as never} // el tipo de ref de Paper exige RN+Paper a la vez; solo usamos focus()
          value={amount}
          onChangeText={(t) => {
            // Posición desconocida tras teclear (web no emite selectionchange al escribir): addOp añade al final
            // salvo que llegue un onSelectionChange posterior.
            selRef.current = { start: t.length, end: t.length };
            setForceSel(undefined);
            setAmount(t);
          }}
          selection={forceSel}
          onSelectionChange={(e) => {
            const { start, end } = e.nativeEvent.selection;
            selRef.current = { start, end };
            if (forceSel && forceSel.start === start && forceSel.end === end) setForceSel(undefined);
          }}
          autoFocus
          keyboardType="decimal-pad"
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="done"
          onSubmitEditing={save}
          error={amount.trim() !== '' && parsed === null}
        />
        <View style={styles.ops}>
          {OPS.map(([label, ch]) => (
            <Button key={ch} mode="outlined" compact onPress={() => addOp(ch)}>
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

        <DateField value={date} onChange={setDate} />

        <Button mode="contained" onPress={save} disabled={!canSave} style={styles.label}>Guardar</Button>
        {editId !== null && (
          <Button textColor={c.error} onPress={() => setAskDelete(true)} disabled={busy} style={styles.label}>Borrar</Button>
        )}
      </ScrollView>

      <Portal>
        <Dialog visible={askDelete} onDismiss={() => setAskDelete(false)}>
          <Dialog.Content><Text variant="bodyMedium">¿Borrar este gasto?</Text></Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setAskDelete(false)}>Cancelar</Button>
            <Button textColor={c.error} onPress={del} disabled={busy}>Borrar</Button>
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
