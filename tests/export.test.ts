import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupName, csvEscape, toCsv } from '../src/lib/export.ts';

test('csvEscape: ; " y saltos de línea van entre comillas', () => {
  assert.equal(csvEscape('plano'), 'plano');
  assert.equal(csvEscape('a;b'), '"a;b"');
  assert.equal(csvEscape('di "hola"'), '"di ""hola"""');
  assert.equal(csvEscape('l1\nl2'), '"l1\nl2"');
  assert.equal(csvEscape('l1\r\nl2'), '"l1\r\nl2"');
});

test('toCsv: BOM, cabecera, coma decimal, CRLF y escapado', () => {
  const csv = toCsv([
    ['2026-11-01', 'gasto', 'Café; "bar"', 'Ocio', 1234],
    ['2026-11-02', 'ingreso', 'Nómina', '', 150000],
    ['2026-11-03', 'gasto', 'Devolución', 'Hogar', -5],
  ]);
  assert.ok(csv.startsWith('﻿fecha;tipo;concepto;categoría/destino;importe\r\n'));
  assert.deepEqual(csv.slice(1).split('\r\n'), [
    'fecha;tipo;concepto;categoría/destino;importe',
    '2026-11-01;gasto;"Café; ""bar""";Ocio;12,34',
    '2026-11-02;ingreso;Nómina;;1500,00',
    '2026-11-03;gasto;Devolución;Hogar;-0,05',
    '',
  ]);
});

test('toCsv: sin filas solo cabecera', () => {
  assert.equal(toCsv([]), '﻿fecha;tipo;concepto;categoría/destino;importe\r\n');
});

test('backupName', () => {
  assert.equal(backupName('2026-11-11'), 'mny-backup-2026-11-11.json');
});
