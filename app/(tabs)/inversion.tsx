import { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Dialog, FAB, List, Portal, Text, TextInput, useTheme } from 'react-native-paper';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AmountField } from '@/src/components/AmountField';
import { ConfirmDialog } from '@/src/components/ConfirmDialog';
import { ContribDialog } from '@/src/components/ContribDialog';
import { DateField, validDate } from '@/src/components/DateField';
import { useGuard } from '@/src/components/useGuard';
import { useKeyboardHeight } from '@/src/components/useKeyboardHeight';
import * as q from '@/src/db/queries';
import { investmentStats, investmentTotals } from '@/src/lib/calc';
import { centsToInput, formatMoney, parseAmount } from '@/src/lib/money';
import { today } from '@/src/lib/month';

const parse = (t: string) => (t.trim() === '' ? 0 : parseAmount(t)); // vacío = 0
const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;

type Dlg =
  | { t: 'inv'; inv: q.Investment | null }
  | { t: 'value'; inv: q.Investment }
  | { t: 'contrib'; inv: q.Investment; c: q.Contribution | null }
  | { t: 'confirm'; msg: string; ok: () => Promise<unknown> }
  | null;

function InvDialog(p: {
  inv: q.Investment | null;
  onClose: (changed: boolean) => void;
  onConfirm: (msg: string, ok: () => Promise<unknown>) => void;
}) {
  const { inv } = p;
  const db = useSQLiteContext();
  const [name, setName] = useState(inv?.name ?? '');
  const [initial, setInitial] = useState(inv ? centsToInput(inv.initial) : '');
  const [monthly, setMonthly] = useState(inv ? centsToInput(inv.monthly) : '');
  const [busy, run] = useGuard();
  const kb = useKeyboardHeight();
  const i = parse(initial);
  const m = parse(monthly);
  const ok = name.trim() !== '' && i !== null && m !== null && !busy;
  const save = () => {
    if (!ok) return;
    return run(async () => {
      if (inv) await q.updateInvestment(db, inv.id, name.trim(), i, m);
      else await q.addInvestment(db, name.trim(), i, m);
      p.onClose(true);
    }, true);
  };
  return (
    <Dialog visible onDismiss={() => p.onClose(false)} style={{ marginBottom: kb }}>
      <Dialog.Title>{inv ? 'Editar inversión' : 'Nueva inversión'}</Dialog.Title>
      <Dialog.ScrollArea>
        <ScrollView keyboardShouldPersistTaps="handled">
          <TextInput mode="outlined" dense label="Nombre" value={name} onChangeText={setName} />
          <AmountField label="Aportación inicial" value={initial} onChange={setInitial} />
          <AmountField label="Aportación mensual" value={monthly} onChange={setMonthly} />
        </ScrollView>
      </Dialog.ScrollArea>
      <Dialog.Actions>
        {inv && (
          <Button onPress={() => p.onConfirm(`¿Borrar "${inv.name}" y todas sus aportaciones?`, () => q.deleteInvestment(db, inv.id))}>
            Borrar
          </Button>
        )}
        <Button onPress={() => p.onClose(false)}>Cancelar</Button>
        <Button onPress={save} disabled={!ok}>Guardar</Button>
      </Dialog.Actions>
    </Dialog>
  );
}

function ValueDialog(p: { inv: q.Investment; onClose: (changed: boolean) => void }) {
  const db = useSQLiteContext();
  const [value, setValue] = useState(centsToInput(p.inv.current_value));
  const [date, setDate] = useState(today());
  const [busy, run] = useGuard();
  const kb = useKeyboardHeight();
  const v = parse(value);
  const ok = v !== null && validDate(date) && !busy;
  const save = () => {
    if (!ok) return;
    return run(async () => {
      await q.updateInvestmentValue(db, p.inv.id, v, date);
      p.onClose(true);
    }, true);
  };
  return (
    <Dialog visible onDismiss={() => p.onClose(false)} style={{ marginBottom: kb }}>
      <Dialog.Title>Actualizar valor de {p.inv.name}</Dialog.Title>
      <Dialog.ScrollArea>
        <ScrollView keyboardShouldPersistTaps="handled">
          <AmountField label="Valor actual" value={value} onChange={setValue} />
          <DateField value={date} onChange={setDate} />
        </ScrollView>
      </Dialog.ScrollArea>
      <Dialog.Actions>
        <Button onPress={() => p.onClose(false)}>Cancelar</Button>
        <Button onPress={save} disabled={!ok}>Guardar</Button>
      </Dialog.Actions>
    </Dialog>
  );
}

export default function Inversion() {
  const db = useSQLiteContext();
  const c = useTheme().colors;
  const [cur, setCur] = useState('€');
  const [invs, setInvs] = useState<q.Investment[]>([]);
  const [regs, setRegs] = useState<q.Contribution[]>([]);
  const [dlg, setDlg] = useState<Dlg>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const n = ++seq.current;
    try {
      const [i, r, st] = await Promise.all([q.listInvestments(db), q.listContributions(db, 'investment'), q.getSettings(db)]);
      if (n !== seq.current) return; // llegó otra carga más reciente
      setInvs(i);
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
  const rows = invs.map((inv) => ({ inv, s: investmentStats(inv, inv.contrib) }));
  const tot = investmentTotals(rows.map((x) => ({ contributed: x.s.contributed, value: x.inv.current_value })));
  const gainColor = (g: number) => (g >= 0 ? c.primary : c.error);

  return (
    <View style={[styles.flex, { backgroundColor: c.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={{ backgroundColor: c.primaryContainer }}>
          <Card.Content>
            <View style={styles.between}>
              <View>
                <Text variant="labelMedium">Aportado</Text>
                <Text variant="titleLarge">{m(tot.contributed)}</Text>
              </View>
              <View style={styles.end}>
                <Text variant="labelMedium">Valor actual</Text>
                <Text variant="titleLarge">{m(tot.value)}</Text>
              </View>
            </View>
            <Text variant="titleMedium" style={[styles.gap, { color: gainColor(tot.gain) }]}>
              Rendimiento {m(tot.gain)} ({pct(tot.gainPct)})
            </Text>
          </Card.Content>
        </Card>

        <Text variant="titleMedium" style={styles.title}>Activos</Text>
        {invs.length === 0 && (
          <View style={styles.empty}>
            <Text variant="bodyMedium">Aún no tienes inversiones.</Text>
            <Button onPress={() => setDlg({ t: 'inv', inv: null })}>Crea tu primera inversión</Button>
          </View>
        )}
        {rows.map(({ inv, s }) => (
          <List.Item
            key={inv.id}
            title={inv.name}
            description={() => (
              <View>
                <Text variant="bodySmall">Aportado {m(s.contributed)}</Text>
                <Text variant="bodySmall" style={{ color: gainColor(s.gain) }}>
                  Rendimiento {m(s.gain)} ({pct(s.gainPct)})
                </Text>
                {inv.value_date && <Text variant="bodySmall">Valor al {inv.value_date}</Text>}
                <View style={styles.actions}>
                  <Button compact onPress={() => setDlg({ t: 'value', inv })}>Actualizar valor</Button>
                  <Button compact onPress={() => setDlg({ t: 'contrib', inv, c: null })}>Aportar</Button>
                </View>
              </View>
            )}
            right={() => <Text variant="bodyLarge" style={styles.amt}>{m(inv.current_value)}</Text>}
            onPress={() => setDlg({ t: 'inv', inv })}
          />
        ))}
        {invs.length > 0 && <Button icon="plus" onPress={() => setDlg({ t: 'inv', inv: null })}>Añadir inversión</Button>}

        <Text variant="titleMedium" style={styles.title}>Registro</Text>
        {regs.length === 0 && <Text variant="bodyMedium">Sin aportaciones todavía.</Text>}
        {regs.map((r) => (
          <List.Item
            key={r.id}
            title={r.target_name ?? 'Inversión borrada'}
            description={r.date}
            right={() => <Text variant="bodyLarge" style={styles.amt}>{m(r.amount)}</Text>}
            onPress={() => {
              const inv = invs.find((x) => x.id === r.target_id);
              if (inv) setDlg({ t: 'contrib', inv, c: r });
            }}
          />
        ))}
      </ScrollView>

      <Portal>
        {dlg?.t === 'inv' && <InvDialog inv={dlg.inv} onClose={close} onConfirm={confirm} />}
        {dlg?.t === 'value' && <ValueDialog inv={dlg.inv} onClose={close} />}
        {dlg?.t === 'contrib' && (
          <ContribDialog
            kind="investment"
            targetId={dlg.inv.id}
            title={dlg.inv.name}
            c={dlg.c}
            defaultAmount={dlg.inv.monthly}
            onClose={close}
          />
        )}
        {dlg?.t === 'confirm' && <ConfirmDialog msg={dlg.msg} ok={dlg.ok} onClose={close} />}
      </Portal>
      <FAB icon="plus" style={styles.fab} onPress={() => router.navigate('/gasto')} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 96 },
  title: { marginTop: 24 },
  gap: { marginTop: 8 },
  between: { flexDirection: 'row', justifyContent: 'space-between' },
  end: { alignItems: 'flex-end' },
  empty: { alignItems: 'center', paddingVertical: 8 },
  actions: { flexDirection: 'row', marginLeft: -8 },
  amt: { alignSelf: 'center' },
  fab: { position: 'absolute', right: 16, bottom: 16 },
});
