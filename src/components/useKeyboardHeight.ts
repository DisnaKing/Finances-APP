import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

/** Alto actual del teclado (0 si está oculto). Para subir los Dialog de Paper, que no lo evitan solos. */
export function useKeyboardHeight() {
  const [h, setH] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => setH(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setH(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return h;
}
