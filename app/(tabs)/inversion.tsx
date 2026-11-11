import { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Dialog, FAB, HelperText, List, Portal, Text, TextInput, useTheme } from 'react-native-paper';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AmountField } from '@/src/components/AmountField';
import { ConfirmDialog } from '@/src/components/ConfirmDialog';
import { ContribDialog } from '@/src/components/ContribDialog';
import { DateField, validDate } from '@/src/components/DateField';
import { useGuard } from '@/src/components/useGuard';
import { useKeyboardHeight } from '@/src/components/useKeyboardHeight';
import * as q from '@/src/db/queries';
import { investmentStats, investmentTotals, investmentValue } from '@/src/lib/calc';
import { centsToInput, formatMoney, formatPct, parseAmount } from '@/src/lib/money';
import { formatDate, today } from '@/src/lib/month';

const parse = (t: string) => (t.trim() === '' ? 0 : parseAmount(t)); // vacío = 0

type Dlg =
  | { t: 'inv'; inv: q.Investment | null }
  | { t: 'value'; inv: q.Investment; value: number }
  | { t: 'contrib'; targetId: number; title: string; defaultAmount: number; c: q.Contribution | null }
  | null;

function InvDialog(p: {
  inv: q.Investment | null;
  onClose: (changed: boolean) => void;
}) {
  const { inv } = p;
  const db = useSQLiteContext();
  const [name, setName] = useState(inv?.name ?? '');
  const [initial, setInitial] = useState(inv ? centsToInput(inv.initial) : '');
  const [monthly, setMonthly] = useState(inv ? centsToInput(inv.monthly) : '');
  const [busy, run] = useGuard();
  const [askDel, setAskDel] = useState(false);
  const kb = useKeyboardHeight();
  const i = parse(initial);
  const m = parse(monthly);
  const errI = i !== null && i < 0 ? 'No puede ser negativa' : undefined;
  const errM = m !== null && m < 0 ? 'No puede ser negativa' : undefined;
  const ok = name.trim() !== '' && i !== null && i >= 0 && m !== null && m >= 0 && !busy;
  const save = () => {
    if (!ok) return;
    return run(async () => {
      if (inv) await q.updateInvestment(db, inv.id, name.trim(), i, m);
      else await q.addInvestment(db, name.trim(), i, m);
      p.onClose(true);
    }, true);
  };
  return (
    <>
    <Dialog visible onDismiss={() => p.onClose(false)} style={{ marginBottom: kb }}>
      <Dialog.Title>{inv ? 'Editar inversión' : 'Nueva inversión'}</Dialog.Title>
      <Dialog.ScrollArea>
        <ScrollView keyboardShouldPersistTaps="handled">
          <TextInput mode="outlined" dense label="Nombre" value={name} onChangeText={setName} />
          <AmountField label="Aportación inicial" value={initial} onChange={setInitial} error={errI} />
          <AmountField label="Aportación mensual" value={monthly} onChange={setMonthly} error={errM} />
        </ScrollView>
      </Dialog.ScrollArea>
      <Dialog.Actions>
        {inv && (
          <Button disabled={busy} onPress={() => setAskDel(true)}>
            Borrar
          </Button>
        )}
        <Button onPress={() => p.onClose(false)}>Cancelar</Button>
        <Button onPress={save} disabled={!ok}>Guardar</Button>
      </Dialog.Actions>
    </Dialog>
    {askDel && inv && (
      <ConfirmDialog msg={`¿Borrar "${inv.name}" y todas sus aportaciones?`} ok={() => q.deleteInvestment(db, inv.id)} onClose={(ch) => (ch ? p.onClose(true) : setAskDel(false))} />
    )}
    </>
  );
}

function ValueDialog(p: { inv: q.Investment; value: number; onClose: (changed: boolean) => void }) {
  const db = useSQLiteContext();
  const [value, setValue] = useState(centsToInput(p.value));
  const [date, setDate] = useState(today());
  const [busy, run] = useGuard();
  const kb = useKeyboardHeight();
  const v = parse(value);
  const td = today();
  const errV = v !== null && v < 0 ? 'No puede ser negativo' : undefined;
  const ok = value.trim() !== '' && v !== null && v >= 0 && validDate(date) && date <= td && !busy;
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
          <AmountField label="Valor actual" value={value} onChange={setValue} error={errV} />
          <DateField value={date} onChange={setDate} max={td} />
          <HelperText type="info">El valor incluye las aportaciones hasta esta fecha</HelperText>
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
  const rows = invs.map((inv) => {
    const value = investmentValue(inv, inv.initial + inv.contrib, inv.contrib_after);
    return { inv, value, s: investmentStats({ initial: inv.initial, current_value: value }, inv.contrib) };
  });
  const tot = investmentTotals(rows.map((x) => ({ contributed: x.s.contributed, value: x.value })));
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
              Rendimiento {m(tot.gain)} ({formatPct(tot.gainPct)})
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
        {rows.map(({ inv, value, s }) => (
          <List.Item
            key={inv.id}
            title={inv.name}
            description={() => (
              <View>
                <Text variant="bodySmall">Aportado {m(s.contributed)}</Text>
                {inv.value_date === null ? (
                  <Text variant="bodySmall">Sin valorar</Text>
                ) : (
                  <>
                    <Text variant="bodySmall" style={{ color: gainColor(s.gain) }}>
                      Rendimiento {m(s.gain)} ({formatPct(s.gainPct)})
                    </Text>
                    <Text variant="bodySmall">Valor al {formatDate(inv.value_date)}</Text>
                  </>
                )}
                <View style={styles.actions}>
                  <Button compact onPress={() => setDlg({ t: 'value', inv, value })}>Actualizar valor</Button>
                  <Button compact onPress={() => setDlg({ t: 'contrib', targetId: inv.id, title: inv.name, defaultAmount: inv.monthly, c: null })}>Aportar</Button>
                </View>
              </View>
            )}
            right={() => <Text variant="bodyLarge" style={styles.amt}>{m(value)}</Text>}
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
            description={formatDate(r.date)}
            right={() => <Text variant="bodyLarge" style={styles.amt}>{m(r.amount)}</Text>}
            onPress={() => {
              const inv = invs.find((x) => x.id === r.target_id);
              setDlg({ t: 'contrib', targetId: r.target_id, title: inv?.name ?? 'Inversión borrada', defaultAmount: inv?.monthly ?? 0, c: r });
            }}
          />
        ))}
      </ScrollView>

      <Portal>
        {dlg?.t === 'inv' && <InvDialog inv={dlg.inv} onClose={close} />}
        {dlg?.t === 'value' && <ValueDialog inv={dlg.inv} value={dlg.value} onClose={close} />}
        {dlg?.t === 'contrib' && (
          <ContribDialog
            kind="investment"
            targetId={dlg.targetId}
            title={dlg.title}
            c={dlg.c}
            defaultAmount={dlg.defaultAmount}
            onClose={close}
          />
        )}
      </Portal>
      <FAB icon="plus" accessibilityLabel="Añadir gasto" style={styles.fab} onPress={() => router.navigate('/gasto')} />
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
