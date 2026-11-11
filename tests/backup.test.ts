import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// queries.ts importa expo-sqlite (no cargable en node): se lee como texto.
const list = (src: string) => src.match(/BACKUP_TABLES = \[([^\]]*)\]/)![1].match(/'(\w+)'/g)!.map((s) => s.slice(1, -1));

test('BACKUP_TABLES coincide con las tablas de schema.ts', () => {
  const schema = readFileSync(new URL('../src/db/schema.ts', import.meta.url), 'utf8');
  const queries = readFileSync(new URL('../src/db/queries.ts', import.meta.url), 'utf8');
  const created = [...schema.matchAll(/CREATE TABLE (\w+)/g)].map((m) => m[1]);
  assert.ok(created.length > 0);
  assert.deepEqual(list(queries).sort(), created.sort());
});
