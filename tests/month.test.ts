import { test } from 'node:test';
import assert from 'node:assert/strict';
import { today, currentMonth, addMonths, monthName, monthOf, monthRange } from '../src/lib/month.ts';

test('addMonths con cambio de año', () => {
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-11', 0), '2026-11');
  assert.equal(addMonths('2026-03', 14), '2027-05');
  assert.equal(addMonths('2026-03', -15), '2024-12');
});

test('monthName', () => {
  assert.equal(monthName('2026-11'), 'Noviembre 2026');
  assert.equal(monthName('2027-01'), 'Enero 2027');
});

test('monthOf / monthRange', () => {
  assert.equal(monthOf('2026-11-05'), '2026-11');
  assert.deepEqual(monthRange('2026-11'), ['2026-11-01', '2026-11-30']);
  assert.deepEqual(monthRange('2028-02'), ['2028-02-01', '2028-02-29']);
  assert.deepEqual(monthRange('2026-12'), ['2026-12-01', '2026-12-31']);
});

test('currentMonth formato', () => {
  assert.match(currentMonth(), /^\d{4}-(0[1-9]|1[0-2])$/);
});

test('today formato local', () => {
  assert.match(today(), /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/);
  assert.equal(today().slice(0, 7), currentMonth());
});
