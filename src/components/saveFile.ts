import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** Guarda `content` como archivo: en web descarga (Blob + <a download>); en nativo lo escribe en caché y abre "Compartir". */
export async function saveFile(name: string, content: string, mimeType: string) {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const f = new File(Paths.cache, name);
  f.create({ overwrite: true });
  await f.write(content);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Compartir no disponible');
  await Sharing.shareAsync(f.uri, { mimeType, dialogTitle: name });
}
