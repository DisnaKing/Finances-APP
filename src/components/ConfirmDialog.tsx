import { Button, Dialog, Text, useTheme } from 'react-native-paper';
import { useGuard } from '@/src/components/useGuard';

export function ConfirmDialog({ msg, ok, onClose }: { msg: string; ok: () => Promise<unknown>; onClose: (changed: boolean) => void }) {
  const c = useTheme().colors;
  const [busy, run] = useGuard();
  return (
    <Dialog visible onDismiss={() => onClose(false)}>
      <Dialog.Content><Text variant="bodyMedium">{msg}</Text></Dialog.Content>
      <Dialog.Actions>
        <Button onPress={() => onClose(false)}>Cancelar</Button>
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
