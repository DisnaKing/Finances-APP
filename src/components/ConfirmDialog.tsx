import { useEffect } from 'react';
import { Keyboard } from 'react-native';
import { Button, Dialog, Text, useTheme } from 'react-native-paper';
import { useGuard } from '@/src/components/useGuard';

/** `busy` = el padre está ocupado (p. ej. su propio diálogo guardando): bloquea también Cancelar y el cierre al tocar fuera. */
export function ConfirmDialog({ msg, ok, onClose, busy: parentBusy = false }: { msg: string; ok: () => Promise<unknown>; onClose: (changed: boolean) => void; busy?: boolean }) {
  const c = useTheme().colors;
  const [own, run] = useGuard();
  const busy = own || parentBusy;
  useEffect(() => Keyboard.dismiss(), []); // si no, en Android el teclado del diálogo anterior tapa los botones
  return (
    <Dialog visible onDismiss={() => !busy && onClose(false)}>
      <Dialog.Content><Text variant="bodyMedium">{msg}</Text></Dialog.Content>
      <Dialog.Actions>
        <Button disabled={busy} onPress={() => onClose(false)}>Cancelar</Button>
        <Button
          textColor={c.error}
          disabled={busy}
          onPress={() =>
            run(async () => {
              await ok();
              onClose(true);
            }, true)
          }
        >
          Confirmar
        </Button>
      </Dialog.Actions>
    </Dialog>
  );
}
