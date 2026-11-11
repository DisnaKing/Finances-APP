import { useCallback, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Dialog, Divider, HelperText, List, Portal, SegmentedButtons, Text, TextInput, useTheme } from 'react-native-paper';
import { useFocusEffect } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useSQLiteContext } from 'expo-sqlite';
import { AmountField } from '@/src/components/AmountField';
import { ConfirmDialog } from '@/src/components/ConfirmDialog';
import { saveFile } from '@/src/components/saveFile';
import { useGuard } from '@/src/components/useGuard';
import { useKeyboardHeight } from '@/src/components/useKeyboardHeight';
import * as q from '@/src/db/queries';
import type { Kind } from '@/src/lib/calc';
import { NOT_BUDGET, parseWorkbook, validateBackup } from '@/src/lib/importXlsx';
import { backupName, toCsv } from '@/src/lib/export';
import { centsToInput, formatMoney, parseAmount } from '@/src/lib/money';
import { monthName, today } from '@/src/lib/month';

const KIND_LABEL: Record<Kind, string> = { needs: 'Necesidad', wants: 'Deseo', savings: 'Ahorro' };
type Bill = Awaited<ReturnType<typeof q.listAllBills>>[number];
type Dlg = { t: 'cat'; cat: q.Category | null } | { t: 'bill'; bill: Bill } | null;

const DUP_MSG = 'Ya existe una categoría con ese nombre';

type Pending = { title: string; lines: string[]; warnings: string[]; diffs: string[]; apply: () => Promise<string> };
const XLSX_TYPES = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'application/octet-stream'];
const READ_ERR = 'No se pudo leer el archivo.';
const MAX_BYTES = 10 * 1024 * 1024;

/** Error con mensaje apto para mostrar tal cual; el resto se sustituye por un texto genérico. */
const userErr = (m: string) => Object.assign(new Error(m), { user: true });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Elige un archivo y devuelve sus bytes (null si se cancela). */
async function pickBytes(type: string[]): Promise<ArrayBuffer | null> {
  const r = await DocumentPicker.getDocumentAsync({ type, copyToCacheDirectory: true });
  if (r.canceled) return null;
  const a = r.assets[0];
  if (a.size != null && a.size > MAX_BYTES) throw userErr('El archivo es demasiado grande (máximo 10 MB).');
  if (Platform.OS === 'web') return a.file ? a.file.arrayBuffer() : (await fetch(a.uri)).arrayBuffer();
  const f = new File(a.uri);
  try {
    return await f.arrayBuffer();
  } finally {
    try { f.delete(); } catch { /* copia en caché: si no se puede borrar, la limpia el sistema */ }
  }
}

const pctNum = (t: string) => (/^\d{1,3}$/.test(t.trim()) && Number(t) <= 100 ? Number(t) : null);

function CategoryDialog(p: { cat: q.Category | null; names: string[]; onClose: (changed: boolean) => void }) {
  const { cat } = p;
  const db = useSQLiteContext();
  const [name, setName] = useState(cat?.name ?? '');
  const [kind, setKind] = useState<q.Category['kind']>(cat?.kind ?? 'needs');
  const [dbErr, setDbErr] = useState('');
  const [busy, run] = useGuard();
  const [askDel, setAskDel] = useState(false);
  const kb = useKeyboardHeight();
  const n = name.trim();
  const dup = p.names.some((x) => x.toLowerCase() === n.toLowerCase() && x !== cat?.name);
  const err = dup ? DUP_MSG : dbErr || undefined;
  const ok = n !== '' && !err && !busy;
  const save = () => {
    if (!ok) return;
    return run(async () => {
      try {
        if (cat) await q.updateCategory(db, cat.id, n, kind);
        else await q.addCategory(db, n, kind);
      } catch (e) {
        setDbErr(/UNIQUE/i.test(String(e)) ? DUP_MSG : 'No se pudo guardar');
        throw e;
      }
      p.onClose(true);
    }, true);
  };
  return (
    <>
      <Dialog visible onDismiss={() => p.onClose(false)} style={{ marginBottom: kb }}>
        <Dialog.Title>{cat ? 'Editar categoría' : 'Nueva categoría'}</Dialog.Title>
        <Dialog.ScrollArea>
          <ScrollView keyboardShouldPersistTaps="handled">
            <TextInput mode="outlined" dense label="Nombre" value={name} error={!!err} onChangeText={(t) => { setName(t); setDbErr(''); }} />
            <HelperText type="error" visible={!!err}>{err}</HelperText>
            <SegmentedButtons
              value={kind}
              onValueChange={(v) => setKind(v as q.Category['kind'])}
              buttons={(['needs', 'wants'] as const).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
            />
            {cat && <HelperText type="info">Los cambios se aplican a todos los meses.</HelperText>}
          </ScrollView>
        </Dialog.ScrollArea>
        <Dialog.Actions>
          {cat && <Button disabled={busy} onPress={() => setAskDel(true)}>Borrar</Button>}
          <Button onPress={() => p.onClose(false)}>Cancelar</Button>
          <Button onPress={save} disabled={!ok}>Guardar</Button>
        </Dialog.Actions>
      </Dialog>
      {askDel && cat && (
        <ConfirmDialog
          msg={`¿Borrar la categoría "${cat.name}"? Sus gastos quedarán sin categoría y contarán como Deseos.`}
          ok={() => q.deleteCategory(db, cat.id)}
          onClose={(ch) => (ch ? p.onClose(true) : setAskDel(false))}
        />
      )}
    </>
  );
}

function BillDialog(p: { bill: Bill; onClose: (changed: boolean) => void }) {
  const { bill } = p;
  const db = useSQLiteContext();
  const [concept, setConcept] = useState(bill.concept);
  const [kind, setKind] = useState<Kind>(bill.kind);
  const [budget, setBudget] = useState(centsToInput(bill.budget));
  const [busy, run] = useGuard();
  const kb = useKeyboardHeight();
  const b = parseAmount(budget);
  const errB = budget.trim() !== '' && b !== null && b < 0 ? 'No puede ser negativo' : undefined;
  const ok = concept.trim() !== '' && b !== null && b >= 0 && !busy;
  const save = () => {
    if (!ok) return;
    return run(async () => {
      await q.updateBill(db, bill.id, concept.trim(), kind, b);
      p.onClose(true);
    }, true);
  };
  return (
    <Dialog visible onDismiss={() => p.onClose(false)} style={{ marginBottom: kb }}>
      <Dialog.Title>Editar factura</Dialog.Title>
      <Dialog.ScrollArea>
        <ScrollView keyboardShouldPersistTaps="handled">
          <TextInput mode="outlined" dense label="Concepto" value={concept} onChangeText={setConcept} />
          <SegmentedButtons
            style={styles.seg}
            value={kind}
            onValueChange={(v) => setKind(v as Kind)}
            buttons={(Object.keys(KIND_LABEL) as Kind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
          />
          <AmountField label="Presupuesto" value={budget} onChange={setBudget} error={errB} />
          <HelperText type="info">Los cambios se aplican a todos los meses.</HelperText>
        </ScrollView>
      </Dialog.ScrollArea>
      <Dialog.Actions>
        <Button onPress={() => p.onClose(false)}>Cancelar</Button>
        <Button onPress={save} disabled={!ok}>Guardar</Button>
      </Dialog.Actions>
    </Dialog>
  );
}

export default function Ajustes() {
  const db = useSQLiteContext();
  const c = useTheme().colors;
  const [cur, setCur] = useState('€');
  const [pct, setPct] = useState({ needs: '50', wants: '30', savings: '20' });
  const [cats, setCats] = useState<q.Category[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState(false);
  const [expErr, setExpErr] = useState('');
  const [impErr, setImpErr] = useState('');
  const [impOk, setImpOk] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, run] = useGuard();
  const seq = useRef(0);

  const load = useCallback(async () => {
    const n = ++seq.current;
    try {
      const [st, cs, bs] = await Promise.all([q.getSettings(db), q.listCategories(db), q.listAllBills(db)]);
      if (n !== seq.current) return; // llegó otra carga más reciente
      setCur(st.currency);
      setPct({ needs: String(st.pct.needs), wants: String(st.pct.wants), savings: String(st.pct.savings) });
      setCats(cs);
      setBills(bs);
      setLoaded(true);
      setLoadErr(false);
    } catch (err) {
      console.error(err);
      setLoadErr(true);
    }
  }, [db]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const close = (changed: boolean) => {
    setDlg(null);
    if (changed) load();
  };

  const nums = [pctNum(pct.needs), pctNum(pct.wants), pctNum(pct.savings)];
  const sum = nums.reduce<number>((a, x) => a + (x ?? 0), 0);
  const curOk = cur.trim().length >= 1 && cur.trim().length <= 4;
  const pctErr = nums.includes(null) ? 'Cada porcentaje es un entero de 0 a 100' : sum !== 100 ? `Deben sumar 100 (ahora suman ${sum})` : undefined;
  const curErr = curOk ? undefined : 'De 1 a 4 caracteres';
  const edit = (f: () => void) => { setSaved(false); f(); };
  const saveGeneral = () =>
    run(async () => {
      if (pctErr || curErr) return;
      await q.saveGeneral(db, cur.trim(), { needs: nums[0]!, wants: nums[1]!, savings: nums[2]! });
      setSaved(true);
    });

  const exportAs = (what: 'json' | 'csv') =>
    run(async () => {
      setExpErr('');
      try {
        if (what === 'json') await saveFile(backupName(today()), JSON.stringify(await q.backupData(db), null, 2), 'application/json');
        else await saveFile(`mny-movimientos-${today()}.csv`, toCsv(await q.movements(db)), 'text/csv');
      } catch (e) {
        console.error(e);
        setExpErr('No se pudo exportar el archivo.');
      }
    });

  const fail = (e: unknown, fallback: string) => {
    console.error(e);
    setImpErr((e as { user?: boolean } | null)?.user ? (e as Error).message : fallback);
  };
  const start = (type: string[], prepare: (buf: ArrayBuffer) => Promise<Pending>) =>
    run(async () => {
      setImpErr('');
      setImpOk('');
      let buf: ArrayBuffer | null;
      try {
        buf = await pickBytes(type);
      } catch (e) {
        return fail(e, READ_ERR);
      }
      if (!buf) return;
      try {
        setPending(await prepare(buf));
      } catch (e) {
        fail(e, READ_ERR);
      }
    });

  const pickExcel = () =>
    start(XLSX_TYPES, async (buf) => {
      let plan;
      try {
        const m = await import('xlsx/dist/xlsx.mini.min.js');
        const XLSX = m.default ?? m;
        plan = parseWorkbook(XLSX.read(new Uint8Array(buf), { type: 'array', cellNF: true, cellFormula: false }));
      } catch (e) {
        console.error(e);
        throw userErr(NOT_BUDGET);
      }
      const n = (x: unknown[], one: string, many: string) => plural(x.length, one, many);
      return {
        title: 'Importar Excel',
        lines: [
          n(plan.months, 'mes', 'meses'), n(plan.bills, 'factura', 'facturas'), n(plan.expenses, 'gasto', 'gastos'),
          n(plan.goals, 'meta', 'metas'), n(plan.investments, 'inversión', 'inversiones'), n(plan.debts, 'deuda', 'deudas'),
          n(plan.contributions, 'aportación', 'aportaciones'),
        ],
        warnings: plan.warnings,
        diffs: plan.discrepancies.map((d) => `${d.month ? monthName(d.month) + ': ' : ''}${d.field} (diferencia ${formatMoney(d.diff, cur)})`),
        apply: async () => { await q.applyImport(db, plan); return 'Excel importado.'; },
      };
    });

  const pickBackup = () =>
    start(['application/json', 'text/plain', 'application/octet-stream'], async (buf) => {
      let json: unknown;
      try {
        json = JSON.parse(new TextDecoder().decode(buf));
      } catch {
        throw userErr('No parece una copia de mny');
      }
      // Valida ya con el esquema real; restoreBackup vuelve a validar antes de tocar nada.
      const v = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
      let b;
      try {
        b = validateBackup(json, q.BACKUP_TABLES, v?.user_version ?? 0);
      } catch (e) {
        throw userErr(e instanceof Error ? e.message : READ_ERR);
      }
      return {
        title: 'Restaurar copia',
        lines: q.BACKUP_TABLES.map((t) => `${t}: ${b.tables[t].length}`),
        warnings: [],
        diffs: [],
        apply: async () => { await q.restoreBackup(db, json); return 'Copia restaurada.'; },
      };
    });

  const confirmImport = () =>
    run(async () => {
      if (!pending) return;
      try {
        setImpOk(await pending.apply());
        setPending(null);
        await load();
      } catch (e) {
        setPending(null);
        fail(e, 'No se pudo importar; no se ha cambiado nada.');
      }
    });

  const pctField = (key: 'needs' | 'wants' | 'savings', label: string) => (
    <TextInput
      style={styles.pct}
      mode="outlined"
      dense
      label={label}
      value={pct[key]}
      onChangeText={(t) => edit(() => setPct({ ...pct, [key]: t }))}
      error={!!pctErr}
      keyboardType="number-pad"
      maxLength={3}
      right={<TextInput.Affix text="%" />}
    />
  );

  return (
    <View style={[styles.flex, { backgroundColor: c.background }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text variant="titleMedium">General</Text>
        <HelperText type="error" visible={loadErr}>No se pudieron cargar los ajustes.</HelperText>
        <TextInput mode="outlined" dense label="Moneda" value={cur} onChangeText={(t) => edit(() => setCur(t))} error={!!curErr} maxLength={4} autoCorrect={false} />
        <HelperText type="error" visible={!!curErr}>{curErr}</HelperText>
        <Text variant="labelLarge">Reparto 50/30/20</Text>
        <View style={styles.pcts}>
          {pctField('needs', 'Necesidades')}
          {pctField('wants', 'Deseos')}
          {pctField('savings', 'Ahorro')}
        </View>
        <HelperText type="error" visible={!!pctErr}>{pctErr}</HelperText>
        <Button mode="contained" onPress={saveGeneral} disabled={busy || !loaded || !!pctErr || !!curErr}>Guardar</Button>
        {saved && <HelperText type="info" visible>Guardado.</HelperText>}

        <Divider style={styles.div} />
        <Text variant="titleMedium">Categorías de gasto</Text>
        {cats.map((x) => (
          <List.Item key={x.id} title={x.name} description={KIND_LABEL[x.kind]} onPress={() => setDlg({ t: 'cat', cat: x })} />
        ))}
        <Button icon="plus" onPress={() => setDlg({ t: 'cat', cat: null })}>Añadir categoría</Button>

        <Divider style={styles.div} />
        <Text variant="titleMedium">Facturas recurrentes</Text>
        {bills.length === 0 && <Text variant="bodyMedium">Aún no hay facturas. Se crean desde la pestaña Mes.</Text>}
        {bills.map((b) => (
          <List.Item
            key={b.id}
            title={b.concept}
            description={`${KIND_LABEL[b.kind]} · ${formatMoney(b.budget, cur)} · desde ${monthName(b.start_month)}${b.end_month ? ` hasta ${monthName(b.end_month)}` : ''}`}
            descriptionNumberOfLines={3}
            right={() =>
              b.end_month ? (
                <Button compact disabled={busy} accessibilityLabel={`Reactivar ${b.concept}`} onPress={() => run(async () => { await q.reactivateBill(db, b.id); await load(); })}>
                  Reactivar
                </Button>
              ) : null
            }
            onPress={() => setDlg({ t: 'bill', bill: b })}
          />
        ))}

        <Divider style={styles.div} />
        <Text variant="titleMedium">Exportar</Text>
        <Button icon="download" disabled={busy} onPress={() => exportAs('json')}>Copia de seguridad (JSON)</Button>
        <Button icon="table" disabled={busy} onPress={() => exportAs('csv')}>Movimientos (CSV)</Button>
        <HelperText type="error" visible={expErr !== ''}>{expErr}</HelperText>

        <Divider style={styles.div} />
        <Text variant="titleMedium">Importar</Text>
        <Button icon="file-excel" disabled={busy} accessibilityLabel="Importar Excel" onPress={pickExcel}>Importar Excel (.xlsx)</Button>
        <Button icon="backup-restore" disabled={busy} accessibilityLabel="Restaurar copia de seguridad" onPress={pickBackup}>Restaurar copia (JSON)</Button>
        <HelperText type="error" visible={impErr !== ''}>{impErr}</HelperText>
        <HelperText type="info" visible={impOk !== ''}>{impOk}</HelperText>
      </ScrollView>

      <Portal>
        {pending && (
          <Dialog visible onDismiss={() => !busy && setPending(null)} style={{ maxHeight: '85%' }}>
            <Dialog.Title>{pending.title}</Dialog.Title>
            <Dialog.ScrollArea>
              <ScrollView>
                {pending.lines.map((l) => <Text key={l} variant="bodyMedium">{l}</Text>)}
                {pending.warnings.length > 0 && <Text variant="labelLarge" style={styles.sec}>Avisos</Text>}
                {pending.warnings.map((w, i) => <Text key={i} variant="bodySmall">{w}</Text>)}
                {pending.diffs.length > 0 && <Text variant="labelLarge" style={styles.sec}>Diferencias con el Excel</Text>}
                {pending.diffs.map((d, i) => <Text key={i} variant="bodySmall">{d}</Text>)}
                <Text variant="bodyMedium" style={styles.sec}>Se reemplazarán todos los datos actuales. Haz antes una copia de seguridad.</Text>
              </ScrollView>
            </Dialog.ScrollArea>
            <Dialog.Actions>
              <Button disabled={busy} onPress={() => exportAs('json')}>Copia</Button>
              <Button disabled={busy} onPress={() => setPending(null)}>Cancelar</Button>
              <Button disabled={busy} onPress={confirmImport}>Importar</Button>
            </Dialog.Actions>
          </Dialog>
        )}
        {dlg?.t === 'cat' && <CategoryDialog cat={dlg.cat} names={cats.map((x) => x.name)} onClose={close} />}
        {dlg?.t === 'bill' && <BillDialog bill={dlg.bill} onClose={close} />}
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  pcts: { flexDirection: 'row', gap: 8, marginTop: 4 },
  pct: { flex: 1 },
  div: { marginVertical: 16 },
  seg: { marginVertical: 8 },
  sec: { marginTop: 12 },
});
