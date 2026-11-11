import { useState } from 'react';
import { ScrollView } from 'react-native';
import { Button, Dialog } from 'react-native-paper';
import { useSQLiteContext } from 'expo-sqlite';
import { AmountField } from '@/src/components/AmountField';
import { ConfirmDialog } from '@/src/components/ConfirmDialog';
import { DateField, validDate } from '@/src/components/DateField';
import { useGuard } from '@/src/components/useGuard';
import { useKeyboardHeight } from '@/src/components/useKeyboardHeight';
import * as q from '@/src/db/queries';
import { centsToInput, parseAmount } from '@/src/lib/money';
import { today } from '@/src/lib/month';

/** Aportar (c = null) o editar/borrar un registro de aportación de una meta o inversión. */
export function ContribDialog(p: {
  kind: q.ContribKind;
  targetId: number;
  title: string;
  c: q.Contribution | null;
  defaultAmount?: number;
  onClose: (changed: boolean) => void;
}) {
  const { c } = p;
  const db = useSQLiteContext();
  const [amount, setAmount] = useState(c ? centsToInput(c.amount) : p.defaultAmount ? centsToInput(p.defaultAmount) : '');
  const [date, setDate] = useState(c?.date ?? today());
  const [busy, run] = useGuard();
  const [askDel, setAskDel] = useState(false);
  const kb = useKeyboardHeight();
  const a = parseAmount(amount);
  const ok = a !== null && a > 0 && validDate(date) && !busy;
  const save = () => {
    if (!ok) return;
    return run(async () => {
      if (c) await q.updateContribution(db, c.id, date, a);
      else await q.addContribution(db, p.kind, p.targetId, date, a);
      p.onClose(true);
    }, true);
  };
  return (
    <>
    <Dialog visible onDismiss={() => p.onClose(false)} style={{ marginBottom: kb }}>
      <Dialog.Title>{c ? 'Editar aportación' : `Aportar a ${p.title}`}</Dialog.Title>
      <Dialog.ScrollArea>
        <ScrollView keyboardShouldPersistTaps="handled">
          <AmountField label="Importe" value={amount} onChange={setAmount} />
          <DateField value={date} onChange={setDate} />
        </ScrollView>
      </Dialog.ScrollArea>
      <Dialog.Actions>
        {c && <Button onPress={() => setAskDel(true)} disabled={busy}>Borrar</Button>}
        <Button onPress={() => p.onClose(false)}>Cancelar</Button>
        <Button onPress={save} disabled={!ok}>Guardar</Button>
      </Dialog.Actions>
    </Dialog>
    {askDel && c && (
      <ConfirmDialog msg="¿Borrar esta aportación?" ok={() => q.deleteContribution(db, c.id)} onClose={(ch) => (ch ? p.onClose(true) : setAskDel(false))} />
    )}
    </>
  );
}
