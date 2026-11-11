import { useCallback, useRef, useState } from 'react';

/**
 * Anti doble toque: `run(fn)` ignora llamadas mientras otra sigue en curso (ref síncrona + `busy` para deshabilitar
 * botones). Libera al terminar o fallar (el error se registra); con `keepLocked` se queda bloqueado tras un éxito,
 * para pantallas que se cierran justo después (evita un segundo guardado antes de desmontar).
 */
export function useGuard() {
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn: () => Promise<unknown>, keepLocked = false) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    let ok = false;
    try {
      await fn();
      ok = true;
    } catch (e) {
      console.error(e);
    } finally {
      if (!(ok && keepLocked)) {
        lock.current = false;
        setBusy(false);
      }
    }
  }, []);
  return [busy, run] as const;
}
