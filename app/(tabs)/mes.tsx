import { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  Button,
  Checkbox,
  Dialog,
  FAB,
  HelperText,
  IconButton,
  List,
  Portal,
  SegmentedButtons,
  Text,
  TextInput,
  useTheme,
} from 'react-native-paper';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useMonth } from '@/src/components/MonthContext';
import { MonthSelector } from '@/src/components/MonthSelector';
import * as q from '@/src/db/queries';
import type { Bill, Expense, Income } from '@/src/db/queries';
import type { Kind } from '@/src/lib/calc';
import { centsToInput, formatMoney, parseAmount } from '@/src/lib/money';

const KIND_LABEL: Record<Kind, string> = { needs: 'Necesidad', wants: 'Deseo', savings: 'Ahorro' };
const parse = (t: string) => (t.trim() === '' ? 0 : parseAmount(t)); // vacío = 0

type Dlg =
  | { t: 'income'; inc: Income | null }
  | { t: 'bill'; bill: Bill | null }
  | { t: 'confirm'; msg: string; ok: () => Promise<unknown> }
  | null;

function AmountField(p: { label: string; value: string; onChange: (v: string) => void }) {
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
        keyboardType="numbers-and-punctuation"
      />
      <HelperText type="error" visible={bad}>Importe no válido</HelperText>
    </View>
  );
}

function IncomeDialog({ inc, month, onClose }: { inc: Income | null; month: string; onClose: (changed: boolean) => void }) {
  const db = useSQLiteContext();
  const [concept, setConcept] = useState(inc?.concept ?? '');
  const [budget, setBudget] = useState(inc ? centsToInput(inc.budget) : '');
  const [amount, setAmount] = useState(inc ? centsToInput(inc.amount) : '');
  const b = parse(budget);
  const a = parse(amount);
  const ok = concept.trim() !== '' && b !== null && a !== null;
  const save = async () => {
    if (!ok) return;
    if (inc) await q.updateIncome(db, inc.id, concept.trim(), b, a);
    else await q.addIncome(db, month, concept.trim(), b, a);
    onClose(true);
  };
  const del = async () => {
    if (inc) await q.deleteIncome(db, inc.id);
    onClose(true);
  };
  return (
    <Dialog visible onDismiss={() => onClose(false)}>
      <Dialog.Title>{inc ? 'Editar ingreso' : 'Añadir ingreso'}</Dialog.Title>
      <Dialog.Content>
        <TextInput mode="outlined" dense label="Concepto" value={concept} onChangeText={setConcept} />
        <AmountField label="Presupuesto" value={budget} onChange={setBudget} />
        <AmountField label="Importe" value={amount} onChange={setAmount} />
      </Dialog.Content>
      <Dialog.Actions>
        {inc && <Button onPress={del}>Borrar</Button>}
        <Button onPress={() => onClose(false)}>Cancelar</Button>
        <Button onPress={save} disabled={!ok}>Guardar</Button>
      </Dialog.Actions>
    </Dialog>
  );
}

function BillDialog(p: {
  bill: Bill | null;
  month: string;
  onClose: (changed: boolean) => void;
  onConfirm: (msg: string, ok: () => Promise<unknown>) => void;
}) {
  const { bill, month } = p;
  const db = useSQLiteContext();
  const initAmount = bill && bill.payment_amount !== null ? centsToInput(bill.payment_amount) : '';
  const [amount, setAmount] = useState(initAmount);
  const [concept, setConcept] = useState(bill?.concept ?? '');
  const [kind, setKind] = useState<Kind>(bill?.kind ?? 'needs');
  const [budget, setBudget] = useState(bill ? centsToInput(bill.budget) : '');
  const b = parse(budget);
  const setAmt = amount.trim() !== '' && amount !== initAmount; // solo si el usuario lo ha tocado
  const am = setAmt ? parseAmount(amount) : 0;
  const ok = concept.trim() !== '' && b !== null && am !== null;
  const save = async () => {
    if (!ok) return;
    if (bill) {
      await q.updateBill(db, bill.id, concept.trim(), kind, b);
      if (setAmt) await q.setPaymentAmount(db, bill.id, month, am!);
    } else {
      await q.addBill(db, concept.trim(), kind, b, month);
    }
    p.onClose(true);
  };
  return (
    <Dialog visible onDismiss={() => p.onClose(false)}>
      <Dialog.Title>{bill ? 'Factura' : 'Añadir factura'}</Dialog.Title>
      <Dialog.ScrollArea>
        <ScrollView contentContainerStyle={styles.dlgBody}>
          {bill && <AmountField label="Importe de este mes" value={amount} onChange={setAmount} />}
          <TextInput mode="outlined" dense label="Concepto" value={concept} onChangeText={setConcept} />
          <SegmentedButtons
            style={styles.seg}
            value={kind}
            onValueChange={(v) => setKind(v as Kind)}
            buttons={(Object.keys(KIND_LABEL) as Kind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
          />
          <AmountField label="Presupuesto" value={budget} onChange={setBudget} />
          {bill && (
            <>
              <Button onPress={() => p.onConfirm(`¿Dejar de repetir "${bill.concept}" desde este mes?`, () => q.endBill(db, bill.id, month))}>
                Dejar de repetir desde este mes
              </Button>
              <Button onPress={() => p.onConfirm(`¿Borrar la factura "${bill.concept}" y todos sus pagos?`, () => q.deleteBill(db, bill.id))}>
                Borrar factura
              </Button>
            </>
          )}
        </ScrollView>
      </Dialog.ScrollArea>
      <Dialog.Actions>
        <Button onPress={() => p.onClose(false)}>Cancelar</Button>
        <Button onPress={save} disabled={!ok}>Guardar</Button>
      </Dialog.Actions>
    </Dialog>
  );
}

export default function Mes() {
  const db = useSQLiteContext();
  const { month } = useMonth();
  const c = useTheme().colors;
  const [cur, setCur] = useState('€');
  const [incs, setIncs] = useState<Income[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [exps, setExps] = useState<Expense[]>([]);
  const [dlg, setDlg] = useState<Dlg>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const n = ++seq.current;
    await q.ensureIncomes(db, month);
    const [i, b, e, st] = await Promise.all([q.incomes(db, month), q.listBillsForMonth(db, month), q.listExpenses(db, month), q.getSettings(db)]);
    if (n !== seq.current) return; // llegó otra carga más reciente
    setIncs(i);
    setBills(b);
    setExps(e);
    setCur(st.currency);
  }, [db, month]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const m = (x: number) => formatMoney(x, cur);
  const close = (changed: boolean) => {
    setDlg(null);
    if (changed) load();
  };
  const confirm = (msg: string, ok: () => Promise<unknown>) => setDlg({ t: 'confirm', msg, ok });
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  return (
    <View style={[styles.flex, { backgroundColor: c.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <MonthSelector />

        <Text variant="titleMedium" style={styles.title}>Ingresos</Text>
        {incs.map((i) => (
          <List.Item
            key={i.id}
            title={i.concept}
            description={`previsto ${m(i.budget)}`}
            right={() => <Text variant="bodyLarge" style={styles.amt}>{m(i.amount)}</Text>}
            onPress={() => setDlg({ t: 'income', inc: i })}
          />
        ))}
        <Button icon="plus" onPress={() => setDlg({ t: 'income', inc: null })}>Añadir ingreso</Button>

        <View style={[styles.between, styles.title]}>
          <Text variant="titleMedium">Facturas</Text>
          <Text variant="bodyMedium">
            {m(sum(bills.map((b) => b.payment_amount ?? 0)))} / {m(sum(bills.map((b) => b.budget)))}
          </Text>
        </View>
        {bills.map((b) => (
          <List.Item
            key={b.id}
            title={b.concept}
            description={KIND_LABEL[b.kind]}
            left={() => (
              <Checkbox
                status={b.paid ? 'checked' : 'unchecked'}
                onPress={async () => {
                  await q.setBillPaid(db, b.id, month, !b.paid);
                  load();
                }}
              />
            )}
            right={() => (
              <Text variant="bodyLarge" style={[styles.amt, b.payment_amount === null && { color: c.outline }]}>
                {m(b.payment_amount ?? b.budget)}
              </Text>
            )}
            onPress={() => setDlg({ t: 'bill', bill: b })}
          />
        ))}
        <Button icon="plus" onPress={() => setDlg({ t: 'bill', bill: null })}>Añadir factura</Button>

        <View style={[styles.between, styles.title]}>
          <Text variant="titleMedium">Gastos</Text>
          <Text variant="bodyMedium">{m(sum(exps.map((e) => e.amount)))}</Text>
        </View>
        {exps.length === 0 && (
          <View style={styles.empty}>
            <Text variant="bodyMedium">No hay gastos este mes.</Text>
            <Button onPress={() => router.push('/gasto')}>Añadir gasto</Button>
          </View>
        )}
        {exps.map((e) => (
          <List.Item
            key={e.id}
            title={e.concept}
            description={`${e.category_name ?? 'Sin categoría'} · ${e.date.slice(8)}/${e.date.slice(5, 7)}`}
            right={() => (
              <View style={styles.rowEnd}>
                <Text variant="bodyLarge">{m(e.amount)}</Text>
                <IconButton icon="delete-outline" accessibilityLabel="Borrar gasto" onPress={() => confirm(`¿Borrar el gasto "${e.concept}"?`, () => q.deleteExpense(db, e.id))} />
              </View>
            )}
            onPress={() => router.push({ pathname: '/gasto', params: { id: String(e.id) } })}
            onLongPress={() => confirm(`¿Borrar el gasto "${e.concept}"?`, () => q.deleteExpense(db, e.id))}
          />
        ))}
      </ScrollView>

      <Portal>
        {dlg?.t === 'income' && <IncomeDialog inc={dlg.inc} month={month} onClose={close} />}
        {dlg?.t === 'bill' && <BillDialog bill={dlg.bill} month={month} onClose={close} onConfirm={confirm} />}
        {dlg?.t === 'confirm' && (
          <Dialog visible onDismiss={() => close(false)}>
            <Dialog.Content><Text variant="bodyMedium">{dlg.msg}</Text></Dialog.Content>
            <Dialog.Actions>
              <Button onPress={() => close(false)}>Cancelar</Button>
              <Button textColor={c.error} onPress={async () => { await dlg.ok(); close(true); }}>Confirmar</Button>
            </Dialog.Actions>
          </Dialog>
        )}
      </Portal>
      <FAB icon="plus" style={styles.fab} onPress={() => router.push('/gasto')} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 96 },
  title: { marginTop: 24 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  amt: { alignSelf: 'center' },
  rowEnd: { flexDirection: 'row', alignItems: 'center' },
  empty: { alignItems: 'center', paddingVertical: 8 },
  dlgBody: { paddingVertical: 8 },
  seg: { marginVertical: 8 },
  fab: { position: 'absolute', right: 16, bottom: 16 },
});
