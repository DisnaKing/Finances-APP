import { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Dialog, FAB, List, Portal, ProgressBar, Text, TextInput, useTheme } from 'react-native-paper';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { AmountField } from '@/src/components/AmountField';
import { ConfirmDialog } from '@/src/components/ConfirmDialog';
import { ContribDialog } from '@/src/components/ContribDialog';
import { useGuard } from '@/src/components/useGuard';
import { useKeyboardHeight } from '@/src/components/useKeyboardHeight';
import * as q from '@/src/db/queries';
import { goalStats } from '@/src/lib/calc';
import { centsToInput, formatMoney, parseAmount } from '@/src/lib/money';

const parse = (t: string) => (t.trim() === '' ? 0 : parseAmount(t)); // vacío = 0

type Dlg =
  | { t: 'goal'; goal: q.Goal | null }
  | { t: 'contrib'; goal: q.Goal; c: q.Contribution | null }
  | { t: 'confirm'; msg: string; ok: () => Promise<unknown> }
  | null;

function GoalDialog(p: {
  goal: q.Goal | null;
  onClose: (changed: boolean) => void;
  onConfirm: (msg: string, ok: () => Promise<unknown>) => void;
}) {
  const { goal } = p;
  const db = useSQLiteContext();
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(goal ? centsToInput(goal.target) : '');
  const [min, setMin] = useState(goal ? centsToInput(goal.min_monthly) : '');
  const [initial, setInitial] = useState(goal ? centsToInput(goal.initial) : '');
  const [busy, run] = useGuard();
  const kb = useKeyboardHeight();
  const t = parse(target);
  const m = parse(min);
  const i = parse(initial);
  const ok = name.trim() !== '' && t !== null && m !== null && i !== null && !busy;
  const save = () => {
    if (!ok) return;
    return run(async () => {
      if (goal) await q.updateGoal(db, goal.id, name.trim(), t, m, i);
      else await q.addGoal(db, name.trim(), t, m, i);
      p.onClose(true);
    }, true);
  };
  return (
    <Dialog visible onDismiss={() => p.onClose(false)} style={{ marginBottom: kb }}>
      <Dialog.Title>{goal ? 'Editar meta' : 'Nueva meta'}</Dialog.Title>
      <Dialog.ScrollArea>
        <ScrollView keyboardShouldPersistTaps="handled">
          <TextInput mode="outlined" dense label="Nombre" value={name} onChangeText={setName} />
          <AmountField label="Meta" value={target} onChange={setTarget} />
          <AmountField label="Contribución mínima mensual" value={min} onChange={setMin} />
          <AmountField label="Monto inicial" value={initial} onChange={setInitial} />
        </ScrollView>
      </Dialog.ScrollArea>
      <Dialog.Actions>
        {goal && (
          <Button onPress={() => p.onConfirm(`¿Borrar la meta "${goal.name}" y todas sus aportaciones?`, () => q.deleteGoal(db, goal.id))}>
            Borrar
          </Button>
        )}
        <Button onPress={() => p.onClose(false)}>Cancelar</Button>
        <Button onPress={save} disabled={!ok}>Guardar</Button>
      </Dialog.Actions>
    </Dialog>
  );
}

export default function Ahorro() {
  const db = useSQLiteContext();
  const c = useTheme().colors;
  const [cur, setCur] = useState('€');
  const [goals, setGoals] = useState<q.Goal[]>([]);
  const [regs, setRegs] = useState<q.Contribution[]>([]);
  const [dlg, setDlg] = useState<Dlg>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const n = ++seq.current;
    try {
      const [g, r, st] = await Promise.all([q.listGoals(db), q.listContributions(db, 'savings'), q.getSettings(db)]);
      if (n !== seq.current) return; // llegó otra carga más reciente
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
  const confirm = (msg: string, ok: () => Promise<unknown>) => setDlg({ t: 'confirm', msg, ok });
  const stats = goals.map((g) => ({ g, s: goalStats(g, g.contrib) }));
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
                  {s.left > 0 ? `falta ${m(s.left)}` : 'meta alcanzada'}
                  {s.monthsLeft !== null ? ` · ${s.monthsLeft} meses restantes` : ''}
                </Text>
              </View>
            )}
            right={() => (
              <View style={styles.end}>
                <Text variant="bodyLarge">{m(s.total)}</Text>
                <Text variant="bodySmall">de {m(g.target)}</Text>
                <Button compact onPress={() => setDlg({ t: 'contrib', goal: g, c: null })}>Aportar</Button>
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
            description={r.date}
            right={() => <Text variant="bodyLarge" style={styles.amt}>{m(r.amount)}</Text>}
            onPress={() => {
              const goal = goals.find((x) => x.id === r.target_id);
              if (goal) setDlg({ t: 'contrib', goal, c: r });
            }}
          />
        ))}
      </ScrollView>

      <Portal>
        {dlg?.t === 'goal' && <GoalDialog goal={dlg.goal} onClose={close} onConfirm={confirm} />}
        {dlg?.t === 'contrib' && (
          <ContribDialog
            kind="savings"
            targetId={dlg.goal.id}
            title={dlg.goal.name}
            c={dlg.c}
            defaultAmount={dlg.goal.min_monthly}
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
  between: { flexDirection: 'row', justifyContent: 'space-between' },
  end: { alignItems: 'flex-end' },
  empty: { alignItems: 'center', paddingVertical: 8 },
  bar: { height: 8, borderRadius: 4, marginVertical: 4 },
  amt: { alignSelf: 'center' },
  fab: { position: 'absolute', right: 16, bottom: 16 },
});
