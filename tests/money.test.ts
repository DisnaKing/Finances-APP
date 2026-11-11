import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, formatMoney, centsToInput } from '../src/lib/money.ts';

test('parseAmount válidos', () => {
  const cases: [string, number][] = [
    ['12,99', 1299],
    ['=(1.8+1+1.2+1.2+0.9)', 610],
    ['4.88+6.1+27.23+51.1-26+12.5+3+12+10+28.23+21.48+41.5', 19202],
    ['(81.86+50)', 13186],
    ['2*3,5', 700],
    ['10/4', 250],
    ['-5', -500],
    [' 1 000 + 2 ', 100200],
    ['-(2+3)*2', -1000],
    // miles con punto (es-ES) vs decimal
    ['1.234', 123400], ['1.234,56', 123456], ['12.345,67', 1234567], ['1.000', 100000],
    ['1.234.567,8', 123456780], ['1.5', 150], ['1.8', 180], ['1,8', 180], ['12.34', 1234], ['1,234', 123],
    ['(1.8+1+1.2+1.2+0.9)', 610], ['=(1.8+1+1.2)', 400],
    // redondeo sin ruido binario, mitades lejos de 0
    ['4,35/2', 218], ['2.01/2', 101], ['0,57*0,5', 29], ['-0,005', -1],
  ];
  for (const [input, cents] of cases) assert.equal(parseAmount(input), cents, input);
});

test('parseAmount inválidos → null', () => {
  for (const input of ['', '   ', 'abc', '1+', '1/0', '(1+2', '1+2)', '1..2+', '*3'])
    assert.equal(parseAmount(input), null, input);
  assert.equal(parseAmount('('.repeat(300)), null);
  assert.equal(parseAmount('1+'.repeat(150) + '1'), null); // >200 caracteres
});

test('formatMoney', () => {
  assert.equal(formatMoney(123456), '1.234,56\u00A0€');
  assert.equal(formatMoney(-580), '-5,80\u00A0€');
  assert.equal(formatMoney(0), '0,00\u00A0€');
  assert.equal(formatMoney(100000000), '1.000.000,00\u00A0€');
  assert.equal(formatMoney(NaN), '—');
  assert.equal(formatMoney(Infinity), '—');
  assert.equal(formatMoney(5, '$'), '0,05\u00A0$');
});

test('centsToInput', () => {
  assert.equal(centsToInput(1299), '12,99');
  assert.equal(centsToInput(-500), '-5,00');
  assert.equal(parseAmount(centsToInput(123456)), 123456);
});
