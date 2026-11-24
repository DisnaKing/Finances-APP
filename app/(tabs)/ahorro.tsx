import { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Dialog, FAB, HelperText, List, Portal, ProgressBar, Switch, Text, TextInput, useTheme } from 'react-native-paper';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AmountField } from '@/src/components/AmountField';
import { ConfirmDialog } from '@/src/components/ConfirmDialog';
import { ContribDialog } from '@/src/components/ContribDialog';
import { useGuard } from '@/src/components/useGuard';
import { useKeyboardHeight } from '@/src/components/useKeyboardHeight';
import * as q from '@/src/db/queries';
import { accruedInterest, goalStats, yearlyInterest } from '@/src/lib/calc';
import { centsToInput, formatMoney, formatPct, parseAmount } from '@/src/lib/money';
import { formatDate, today } from '@/src/lib/month';

const parse = (t: string) => (t.trim() === '' ? 0 : parseAmount(t)); // vacío = 0

type Dlg =
  | { t: 'goal'; goal: q.Goal | null }
  | { t: 'contrib'; targetId: number; title: string; defaultAmount: number; c: q.Contribution | null }
  | null;

function GoalDialog(p: {
  goal: q.Goal | null;
  onClose: (changed: boolean) => void;
}) {
  const { goal } = p;
  const db = useSQLiteContext();
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(goal ? centsToInput(goal.target) : '');
  const [min, setMin] = useState(goal ? centsToInput(goal.min_monthly) : '');
  const [initial, setInitial] = useState(goal ? centsToInput(goal.initial) : '');
  const [remun, setRemun] = useState((goal?.interest_rate ?? 0) > 0);
  const [rate, setRate] = useState(goal && goal.interest_rate > 0 ? String(goal.interest_rate).replace('.', ',') : '');
  const [busy, run] = useGuard();
  const [askDel, setAskDel] = useState(false);
  const kb = useKeyboardHeight();
  const rs = rate.trim().replace(',', '.');
  const rt = !remun ? 0 : /^\d+(\.\d+)?$/.test(rs) && Number(rs) > 0 && Number(rs) <= 100 ? Number(rs) : null;
  const errR = remun && rt === null ? 'Indica un porcentaje entre 0 y 100' : undefined;
  const t = parse(target);
  const m = parse(min);
  const i = parse(initial);
  const errT = target.trim() !== '' && t !== null && t <= 0 ? 'La meta debe ser mayor que 0' : undefined;
  const errM = m !== null && m < 0 ? 'No puede ser negativa' : undefined;
  const errI = i !== null && i < 0 ? 'No puede ser negativo' : undefined;
  const ok = name.trim() !== '' && t !== null && t > 0 && m !== null && m >= 0 && i !== null && i >= 0 && rt !== null && !busy;
  const save = () => {
    if (!ok) return;
    return run(async () => {
      if (goal) await q.updateGoal(db, goal.id, name.trim(), t, m, i, rt!);
      else await q.addGoal(db, name.trim(), t, m, i, rt!);
      p.onClose(true);
    }, true);
  };
  return (
    <>
    <Dialog visible onDismiss={() => p.onClose(false)} style={{ marginBottom: kb }}>
      <Dialog.Title>{goal ? 'Editar meta' : 'Nueva meta'}</Dialog.Title>
      <Dialog.ScrollArea>
        <ScrollView keyboardShouldPersistTaps="handled">
          <TextInput mode="outlined" dense label="Nombre" value={name} onChangeText={setName} />
          <AmountField label="Meta" value={target} onChange={setTarget} error={errT} />
          <AmountField label="Contribución mínima mensual" value={min} onChange={setMin} error={errM} />
          <AmountField label="Monto inicial" value={initial} onChange={setInitial} error={errI} />
          <View style={styles.switchRow}>
            <Text variant="bodyLarge">Cuenta remunerada</Text>
            <Switch value={remun} onValueChange={setRemun} />
          </View>
          {remun && (
            <TextInput
              mode="outlined"
              dense
              label="Interés anual (TAE %)"
              value={rate}
              onChangeText={setRate}
              error={!!errR}
              keyboardType="decimal-pad"
              autoCorrect={false}
            />
          )}
          {errR && <HelperText type="error">{errR}</HelperText>}
        </ScrollView>
      </Dialog.ScrollArea>
      <Dialog.Actions>
        {goal && (
          <Button disabled={busy} onPress={() => setAskDel(true)}>
            Borrar
          </Button>
        )}
        <Button onPress={() => p.onClose(false)}>Cancelar</Button>
        <Button onPress={save} disabled={!ok}>Guardar</Button>
      </Dialog.Actions>
    </Dialog>
    {askDel && goal && (
      <ConfirmDialog msg={`¿Borrar la meta "${goal.name}" y todas sus aportaciones?`} ok={() => q.deleteGoal(db, goal.id)} onClose={(ch) => (ch ? p.onClose(true) : setAskDel(false))} />
    )}
    </>
  );
}

export default function Ahorro() {
  const db = useSQLiteContext();
  const c = useTheme().colors;
  const [cur, setCur] = useState('€');
  const [goals, setGoals] = useState<q.Goal[]>([]);
  const [regs, setRegs] = useState<q.Contribution[]>([]);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [accrued, setAccrued] = useState<Record<number, number>>({}); // id → interés ya abonado (céntimos)
  const seq = useRef(0);

  const load = useCallback(async () => {
    const n = ++seq.current;
    try {
      const [g, r, st] = await Promise.all([q.listGoals(db), q.listContributions(db, 'savings'), q.getSettings(db)]);
      // Interés abonado: se recibe el último día de cada mes ya transcurrido y forma parte del saldo de la meta.
      const acc: Record<number, number> = {};
      const now = today();
      for (const x of g) {
        if (x.interest_rate <= 0) continue;
        acc[x.id] = accruedInterest(x.interest_rate, x.initial, await q.goalContribs(db, x.id), now);
      }
      if (n !== seq.current) return; // llegó otra carga más reciente
      setAccrued(acc);
      setGoals(g);
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
  const stats = goals.map((g) => ({ g, s: goalStats(g, g.contrib + (accrued[g.id] ?? 0)) }));
  const saved = stats.reduce((a, x) => a + x.s.total, 0);
  const left = stats.reduce((a, x) => a + x.s.left, 0);

  return (
    <View style={[styles.flex, { backgroundColor: c.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Card style={{ backgroundColor: c.primaryContainer }}>
          <Card.Content style={styles.between}>
            <View>
              <Text variant="labelMedium">Total ahorrado</Text>
              <Text variant="titleLarge">{m(saved)}</Text>
            </View>
            <View style={styles.end}>
              <Text variant="labelMedium">Falta total</Text>
              <Text variant="titleLarge">{m(left)}</Text>
            </View>
          </Card.Content>
        </Card>

        <Text variant="titleMedium" style={styles.title}>Metas</Text>
        {goals.length === 0 && (
          <View style={styles.empty}>
            <Text variant="bodyMedium">Aún no tienes metas de ahorro.</Text>
            <Button onPress={() => setDlg({ t: 'goal', goal: null })}>Crea tu primera meta</Button>
          </View>
        )}
        {stats.map(({ g, s }) => (
          <List.Item
            key={g.id}
            title={g.name}
            description={() => (
              <View>
                <ProgressBar progress={s.progress} style={styles.bar} />
                <Text variant="bodySmall">
                  {s.left > 0 ? `falta ${m(s.left)} (${formatPct(s.progress, false)})` : 'meta alcanzada'}
                  {s.monthsLeft !== null ? ` · ${s.monthsLeft} ${s.monthsLeft === 1 ? 'mes restante' : 'meses restantes'}` : ''}
                </Text>
                {g.interest_rate > 0 && (
                  <Text variant="bodySmall">
                    Remunerada {formatPct(g.interest_rate / 100, false)} · intereses recibidos {m(accrued[g.id] ?? 0)} · ≈ {m(yearlyInterest(g.interest_rate, s.total))}/año
                  </Text>
                )}
              </View>
            )}
            right={() => (
              <View style={styles.end}>
                <Text variant="bodyLarge">{m(s.total)}</Text>
                <Text variant="bodySmall">de {m(g.target)}</Text>
                <Button compact onPress={() => setDlg({ t: 'contrib', targetId: g.id, title: g.name, defaultAmount: g.min_monthly, c: null })}>Aportar</Button>
              </View>
            )}
            onPress={() => setDlg({ t: 'goal', goal: g })}
          />
        ))}
        {goals.length > 0 && <Button icon="plus" onPress={() => setDlg({ t: 'goal', goal: null })}>Añadir meta</Button>}

        <Text variant="titleMedium" style={styles.title}>Registro</Text>
        {regs.length === 0 && <Text variant="bodyMedium">Sin aportaciones todavía.</Text>}
        {regs.map((r) => (
          <List.Item
            key={r.id}
            title={r.target_name ?? 'Meta borrada'}
            description={formatDate(r.date)}
            right={() => <Text variant="bodyLarge" style={styles.amt}>{m(r.amount)}</Text>}
            onPress={() => {
              const goal = goals.find((x) => x.id === r.target_id);
              setDlg({ t: 'contrib', targetId: r.target_id, title: goal?.name ?? 'Meta borrada', defaultAmount: goal?.min_monthly ?? 0, c: r });
            }}
          />
        ))}
      </ScrollView>

      <Portal>
        {dlg?.t === 'goal' && <GoalDialog goal={dlg.goal} onClose={close} />}
        {dlg?.t === 'contrib' && (
          <ContribDialog
            kind="savings"
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
  between: { flexDirection: 'row', justifyContent: 'space-between' },
  end: { alignItems: 'flex-end' },
  empty: { alignItems: 'center', paddingVertical: 8 },
  bar: { height: 8, borderRadius: 4, marginVertical: 4 },
  amt: { alignSelf: 'center' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 8 },
  fab: { position: 'absolute', right: 16, bottom: 16 },
});
