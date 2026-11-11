import { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Dialog, HelperText, List, Portal, ProgressBar, Text, TextInput, useTheme } from 'react-native-paper';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AmountField } from '@/src/components/AmountField';
import { ConfirmDialog } from '@/src/components/ConfirmDialog';
import { ContribDialog } from '@/src/components/ContribDialog';
import { DateField, validDate } from '@/src/components/DateField';
import { useGuard } from '@/src/components/useGuard';
import { useKeyboardHeight } from '@/src/components/useKeyboardHeight';
import * as q from '@/src/db/queries';
import { debtSchedule, debtStats, debtSummary } from '@/src/lib/calc';
import { centsToInput, formatMoney, formatPct, parseAmount } from '@/src/lib/money';
import { currentMonth, formatDate, monthName, today } from '@/src/lib/month';

/** "3,5" → 3.5 ; vacío = 0 ; no válido = null */
const parseRate = (t: string) => {
  const s = t.trim().replace(',', '.');
  return s === '' ? 0 : /^\d+(\.\d+)?$/.test(s) ? Number(s) : null;
};
const short = (mo: string) => monthName(mo).replace(/^(\S{3})\S*/, '$1'); // "Ene 2026"

type Paid = Record<number, Record<string, number>>;
type Dlg =
  | { t: 'debt'; debt: q.Debt | null }
  | { t: 'contrib'; targetId: number; title: string; defaultAmount: number; c: q.Contribution | null }
  | { t: 'amort'; debt: q.Debt }
  | { t: 'confirm'; msg: string; ok: () => Promise<unknown> }
  | null;

function DebtDialog(p: {
  debt: q.Debt | null;
  cur: string;
  onClose: (changed: boolean) => void;
  onConfirm: (msg: string, ok: () => Promise<unknown>) => void;
}) {
  const { debt } = p;
  const db = useSQLiteContext();
  const [name, setName] = useState(debt?.name ?? '');
  const [principal, setPrincipal] = useState(debt ? centsToInput(debt.principal) : '');
  const [min, setMin] = useState(debt ? centsToInput(debt.min_payment) : '');
  const [rate, setRate] = useState(debt ? String(debt.annual_rate).replace('.', ',') : '');
  const [start, setStart] = useState(debt?.start_date ?? today());
  const [busy, run] = useGuard();
  const kb = useKeyboardHeight();
  const pr = parseAmount(principal);
  const mn = parseAmount(min);
  const rt = parseRate(rate);
  const errP = principal.trim() !== '' && pr !== null && pr <= 0 ? 'Debe ser mayor que 0' : undefined;
  const errM = min.trim() !== '' && mn !== null && mn <= 0 ? 'Debe ser mayor que 0' : undefined;
  const errR = rt === null ? 'Interés no válido' : undefined;
  const interest = pr !== null && rt !== null ? Math.round((pr * rt) / 100 / 12) : 0;
  const lowMin = mn !== null && mn > 0 && interest > 0 && mn <= interest;
  const ok = name.trim() !== '' && pr !== null && pr > 0 && mn !== null && mn > 0 && rt !== null && validDate(start) && !busy;
  const save = () => {
    if (!ok) return;
    return run(async () => {
      if (debt) await q.updateDebt(db, debt.id, name.trim(), pr, mn, rt, start);
      else await q.addDebt(db, name.trim(), pr, mn, rt, start);
      p.onClose(true);
    }, true);
  };
  return (
    <Dialog visible onDismiss={() => p.onClose(false)} style={{ marginBottom: kb }}>
      <Dialog.Title>{debt ? 'Editar deuda' : 'Nueva deuda'}</Dialog.Title>
      <Dialog.ScrollArea>
        <ScrollView keyboardShouldPersistTaps="handled">
          <TextInput mode="outlined" dense label="Nombre" value={name} onChangeText={setName} />
          <AmountField label="Deuda inicial" value={principal} onChange={setPrincipal} error={errP} />
          <AmountField label="Pago mínimo mensual" value={min} onChange={setMin} error={errM} />
          <HelperText type="error" visible={lowMin}>
            El pago mínimo no cubre los intereses mensuales ({formatMoney(interest, p.cur)}): la deuda no bajaría.
          </HelperText>
          <TextInput mode="outlined" dense label="Interés anual (%)" value={rate} onChangeText={setRate} error={!!errR} keyboardType="decimal-pad" autoCorrect={false} />
          <HelperText type="error" visible={!!errR}>{errR}</HelperText>
          <DateField value={start} onChange={setStart} />
        </ScrollView>
      </Dialog.ScrollArea>
      <Dialog.Actions>
        {debt && (
          <Button disabled={busy} onPress={() => p.onConfirm(`¿Borrar la deuda "${debt.name}" y todos sus pagos?`, () => q.deleteDebt(db, debt.id))}>
            Borrar
          </Button>
        )}
        <Button onPress={() => p.onClose(false)}>Cancelar</Button>
        <Button onPress={save} disabled={!ok}>Guardar</Button>
      </Dialog.Actions>
    </Dialog>
  );
}

function AmortDialog(p: { debt: q.Debt; paid: Record<string, number>; cur: string; onClose: () => void }) {
  const rows = debtSchedule(p.debt, p.paid);
  const m = (x: number) => formatMoney(x, p.cur);
  const cell = (flex: number, right = true) => ({ flex, textAlign: right ? ('right' as const) : ('left' as const) });
  return (
    <Dialog visible onDismiss={p.onClose}>
      <Dialog.Title>Amortización · {p.debt.name}</Dialog.Title>
      <Dialog.ScrollArea>
        <ScrollView>
          <View style={styles.row}>
            {['Mes', 'Pago', 'Interés', 'Saldo'].map((h, i) => (
              <Text key={h} variant="labelMedium" style={cell(i === 0 ? 1.1 : 1, i > 0)}>{h}</Text>
            ))}
          </View>
          {rows.map((r) => {
            const w = { fontWeight: p.paid[r.month] !== undefined ? ('bold' as const) : ('normal' as const) };
            return (
              <View key={r.month} style={styles.row}>
                <Text variant="bodySmall" style={[cell(1.1, false), w]}>{short(r.month)}</Text>
                <Text variant="bodySmall" style={[cell(1), w]}>{m(r.payment)}</Text>
                <Text variant="bodySmall" style={cell(1)}>{m(r.interest)}</Text>
                <Text variant="bodySmall" style={cell(1)}>{m(r.balance)}</Text>
              </View>
            );
          })}
          {rows.length === 600 && rows[599].balance > 0 && <Text variant="bodySmall">Se muestran los primeros 600 meses.</Text>}
        </ScrollView>
      </Dialog.ScrollArea>
      <Dialog.Actions>
        <Text variant="bodySmall" style={styles.legend}>Negrita = pago real; el resto asume el pago mínimo.</Text>
        <Button onPress={p.onClose}>Cerrar</Button>
      </Dialog.Actions>
    </Dialog>
  );
}

export default function Deudas() {
  const db = useSQLiteContext();
  const c = useTheme().colors;
  const [cur, setCur] = useState('€');
  const [debts, setDebts] = useState<q.Debt[]>([]);
  const [paid, setPaid] = useState<Paid>({});
  const [regs, setRegs] = useState<q.Contribution[]>([]);
  const [dlg, setDlg] = useState<Dlg>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const n = ++seq.current;
    try {
      const [d, p, r, st] = await Promise.all([q.listDebts(db), q.debtPaymentsByMonth(db), q.listContributions(db, 'debt'), q.getSettings(db)]);
      if (n !== seq.current) return; // llegó otra carga más reciente
      setDebts(d);
      setPaid(p);
      setRegs(r);
      setCur(st.currency);
    } catch (err) {
      console.error(err);
    }
  }, [db]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const m = (x: number) => formatMoney(x, cur);
  const close = (changed: boolean) => {
    setDlg(null);
    if (changed) load();
  };
  const confirm = (msg: string, ok: () => Promise<unknown>) => setDlg({ t: 'confirm', msg, ok });
  const now = currentMonth();
  const stats = new Map(debts.map((d) => [d.id, { d, s: debtStats(d, paid[d.id] ?? {}, now) }]));
  const sum = debtSummary([...stats.values()].map(({ d, s }) => ({ id: d.id, min_payment: d.min_payment, ...s })));
  const free =
    sum.totalBalance <= 0 ? 'Libre de deudas'
    : sum.freeMonth === null ? 'Nunca con el pago mínimo actual'
    : `Libre de deudas en ${monthName(sum.freeMonth)}`;

  return (
    <View style={[styles.flex, { backgroundColor: c.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        {debts.length > 0 && (
          <Card style={{ backgroundColor: c.primaryContainer }}>
            <Card.Content>
              <View style={styles.between}>
                <View>
                  <Text variant="labelMedium">Deuda total</Text>
                  <Text variant="titleLarge">{m(sum.totalBalance)}</Text>
                </View>
                <View style={styles.end}>
                  <Text variant="labelMedium">Pago mínimo total</Text>
                  <Text variant="titleLarge">{m(sum.totalMin)}</Text>
                </View>
              </View>
              <Text variant="bodyMedium" style={styles.free}>{free}</Text>
            </Card.Content>
          </Card>
        )}

        <Text variant="titleMedium" style={styles.title}>Deudas</Text>
        {debts.length === 0 && (
          <View style={styles.empty}>
            <Text variant="bodyMedium">Aún no tienes deudas registradas.</Text>
            <Button onPress={() => setDlg({ t: 'debt', debt: null })}>Añade tu primera deuda</Button>
          </View>
        )}
        {sum.order.map((id) => {
          const { d, s } = stats.get(id)!;
          return (
            <List.Item
              key={id}
              title={d.name}
              description={() => (
                <View>
                  <Text variant="bodySmall">mín. {m(d.min_payment)} · {formatPct(d.annual_rate / 100, false)} anual</Text>
                  <ProgressBar progress={s.paidPct} style={styles.bar} />
                  <Text variant="bodySmall">
                    {formatPct(s.paidPct, false)} pagado
                    {s.currentBalance <= 0 ? ' · liquidada' : s.monthsLeft === null ? ' · no baja con el mínimo' : ` · ${s.monthsLeft} ${s.monthsLeft === 1 ? 'mes restante' : 'meses restantes'}`}
                  </Text>
                  <Button compact style={styles.link} onPress={() => setDlg({ t: 'amort', debt: d })}>Ver amortización</Button>
                </View>
              )}
              right={() => (
                <View style={styles.end}>
                  <Text variant="bodyLarge">{m(s.currentBalance)}</Text>
                  <Button compact onPress={() => setDlg({ t: 'contrib', targetId: d.id, title: d.name, defaultAmount: d.min_payment, c: null })}>Pagar</Button>
                </View>
              )}
              onPress={() => setDlg({ t: 'debt', debt: d })}
            />
          );
        })}
        {debts.length > 0 && <Button icon="plus" onPress={() => setDlg({ t: 'debt', debt: null })}>Añadir deuda</Button>}

        <Text variant="titleMedium" style={styles.title}>Registro</Text>
        {regs.length === 0 && <Text variant="bodyMedium">Sin pagos todavía.</Text>}
        {regs.map((r) => (
          <List.Item
            key={r.id}
            title={r.target_name ?? 'Deuda borrada'}
            description={formatDate(r.date)}
            right={() => <Text variant="bodyLarge" style={styles.amt}>{m(r.amount)}</Text>}
            onPress={() => {
              const debt = debts.find((x) => x.id === r.target_id);
              setDlg({ t: 'contrib', targetId: r.target_id, title: debt?.name ?? 'Deuda borrada', defaultAmount: debt?.min_payment ?? 0, c: r });
            }}
          />
        ))}
      </ScrollView>

      <Portal>
        {dlg?.t === 'debt' && <DebtDialog debt={dlg.debt} cur={cur} onClose={close} onConfirm={confirm} />}
        {dlg?.t === 'contrib' && (
          <ContribDialog kind="debt" targetId={dlg.targetId} title={dlg.title} c={dlg.c} defaultAmount={dlg.defaultAmount} onClose={close} />
        )}
        {dlg?.t === 'amort' && <AmortDialog debt={dlg.debt} paid={paid[dlg.debt.id] ?? {}} cur={cur} onClose={() => close(false)} />}
        {dlg?.t === 'confirm' && <ConfirmDialog msg={dlg.msg} ok={dlg.ok} onClose={close} />}
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  title: { marginTop: 24 },
  between: { flexDirection: 'row', justifyContent: 'space-between' },
  end: { alignItems: 'flex-end' },
  free: { marginTop: 8 },
  empty: { alignItems: 'center', paddingVertical: 8 },
  bar: { height: 8, borderRadius: 4, marginVertical: 4 },
  link: { alignSelf: 'flex-start' },
  amt: { alignSelf: 'center' },
  row: { flexDirection: 'row', paddingVertical: 4, gap: 4 },
  legend: { flex: 1 },
});
