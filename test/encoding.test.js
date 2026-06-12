import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeCsvBytes } from '../src/encoding.js';

test('decodeCsvBytes: UTF-8 z BOM — obcina BOM i dekoduje', () => {
  const bom = Buffer.from([0xEF, 0xBB, 0xBF]);
  const body = Buffer.from('Łódź żółć;D1;a@x.pl', 'utf8');
  assert.equal(decodeCsvBytes(Buffer.concat([bom, body])), 'Łódź żółć;D1;a@x.pl');
});

test('decodeCsvBytes: czysty UTF-8 (bez BOM) z polskimi znakami', () => {
  const bytes = Buffer.from('Rafał Dłużniewski;D1;r@x.pl', 'utf8');
  assert.equal(decodeCsvBytes(bytes), 'Rafał Dłużniewski;D1;r@x.pl');
});

test('decodeCsvBytes: Windows-1250 (Excel "CSV") z polskimi znakami', () => {
  // "Rafał Dłużniewski" zakodowane w cp1250
  const cp1250 = Buffer.from([
    0x52, 0x61, 0x66, 0x61, 0xB3, 0x20, // "Rafał "  (ł = 0xB3)
    0x44, 0xB3, 0x75, 0xBF, 0x6E, 0x69, 0x65, 0x77, 0x73, 0x6B, 0x69, // "Dłużniewski" (ł=0xB3, ż=0xBF)
  ]);
  assert.equal(decodeCsvBytes(cp1250), 'Rafał Dłużniewski');
});

test('decodeCsvBytes: akceptuje Uint8Array, nie tylko Buffer', () => {
  const bytes = new Uint8Array(Buffer.from('Test ąć;D1;a@x.pl', 'utf8'));
  assert.equal(decodeCsvBytes(bytes), 'Test ąć;D1;a@x.pl');
});
