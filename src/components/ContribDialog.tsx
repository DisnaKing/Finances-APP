import { useState } from 'react';
import { ScrollView } from 'react-native';
import { Button, Dialog, HelperText } from 'react-native-paper';
import { useSQLiteContext } from 'expo-sqlite';
import { AmountField } from '@/src/components/AmountField';
import { ConfirmDialog } from '@/src/components/ConfirmDialog';
import { DateField, validDate } from '@/src/components/DateField';
import { useGuard } from '@/src/components/useGuard';
import { useKeyboardHeight } from '@/src/components/useKeyboardHeight';
import * as q from '@/src/db/queries';
import { unitsFor } from '@/src/lib/calc';
import { centsToInput, parseAmount } from '@/src/lib/money';
import { today } from '@/src/lib/month';

/** Aportar/pagar (c = null) o editar/borrar un registro de una meta, inversión o deuda. */
export function ContribDialog(p: {
  kind: q.ContribKind;
  targetId: number;
  title: string;
  c: q.Contribution | null;
  defaultAmount?: number;
  /** ISO: fecha mínima (deudas: inicio de la deuda). */
  minDate?: string;
  onClose: (changed: boolean) => void;
}) {
  const { c } = p;
  const db = useSQLiteContext();
  const [amount, setAmount] = useState(c ? centsToInput(c.amount) : p.defaultAmount ? centsToInput(p.defaultAmount) : '');
  const [date, setDate] = useState(c?.date ?? today());
  const [price, setPrice] = useState(c?.price != null ? centsToInput(c.price) : '');
  const [busy, run] = useGuard();
  const [askDel, setAskDel] = useState(false);
  const kb = useKeyboardHeight();
  const a = parseAmount(amount);
  const debt = p.kind === 'debt';
  const inv = p.kind === 'investment';
  const pr = price.trim() === '' ? null : parseAmount(price); // vacío = sin precio
  const errP = price.trim() !== '' && (pr === null || pr <= 0) ? 'Indica un precio mayor que 0' : undefined;
  const units = a !== null && pr !== null ? unitsFor(a, pr) : null;
  const ok = a !== null && a > 0 && validDate(date) && (p.minDate === undefined || date >= p.minDate) && !errP && !busy;
  const save = () => {
    if (!ok) return;
    return run(async () => {
      const pc = inv ? pr : null;
      if (c) await q.updateContribution(db, c.id, date, a, pc);
      else await q.addContribution(db, p.kind, p.targetId, date, a, pc);
      p.onClose(true);
    }, true);
  };
  return (
    <>
    <Dialog visible onDismiss={() => p.onClose(false)} style={{ marginBottom: kb }}>
      <Dialog.Title>{debt ? (c ? 'Editar pago' : `Pagar ${p.title}`) : c ? 'Editar aportación' : `Aportar a ${p.title}`}</Dialog.Title>
      <Dialog.ScrollArea>
        <ScrollView keyboardShouldPersistTaps="handled">
          <AmountField label="Importe" value={amount} onChange={setAmount} />
          <DateField value={date} onChange={setDate} min={p.minDate} />
          {inv && <AmountField label="Precio de compra por unidad (opcional)" value={price} onChange={setPrice} error={errP} />}
          {inv && units !== null && <HelperText type="info">≈ {units.toLocaleString('es-ES', { maximumFractionDigits: 6 })} unidades</HelperText>}
        </ScrollView>
      </Dialog.ScrollArea>
      <Dialog.Actions>
        {c && <Button onPress={() => setAskDel(true)} disabled={busy}>Borrar</Button>}
        <Button onPress={() => p.onClose(false)}>Cancelar</Button>
        <Button onPress={save} disabled={!ok}>Guardar</Button>
      </Dialog.Actions>
    </Dialog>
    {askDel && c && (
      <ConfirmDialog msg={debt ? '¿Borrar este pago?' : '¿Borrar esta aportación?'} ok={() => q.deleteContribution(db, c.id)} onClose={(ch) => (ch ? p.onClose(true) : setAskDel(false))} />
    )}
    </>
  );
}
