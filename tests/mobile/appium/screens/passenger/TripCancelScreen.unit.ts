// Unit de TripCancelScreen (funciones puras + chequeos estáticos), sin Appium.
// Run: npx tsx --test tests/mobile/appium/screens/passenger/TripCancelScreen.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  isCancelConfirmLabel,
  isCancelDialogText,
  parseCancellationCost
} from './TripCancelScreen.js';

test('isCancelConfirmLabel: solo «Si»/«Yes» exactos; «No», «Llamar» y «Aceptar» no', () => {
  assert.equal(isCancelConfirmLabel('Si'), true);
  assert.equal(isCancelConfirmLabel('Sí '), true);
  assert.equal(isCancelConfirmLabel('Yes'), true);
  assert.equal(isCancelConfirmLabel('No'), false);
  assert.equal(isCancelConfirmLabel('Llamar'), false);
  assert.equal(isCancelConfirmLabel('Aceptar'), false);
  assert.equal(isCancelConfirmLabel('Simular'), false);
});

test('isCancelDialogText: diálogo de cancelación es/en; otros avisos no', () => {
  assert.equal(
    isCancelDialogText('Cancelar Viaje ¿Está seguro que desea cancelar el Viaje ?'),
    true
  );
  assert.equal(isCancelDialogText('Atención ¿Desea cancelar el Viaje?'), true);
  assert.equal(isCancelDialogText('Trip Cancel Are You Sure?'), true);
  assert.equal(isCancelDialogText('Ya tiene un viaje creado'), false);
});

test('parseCancellationCost: aviso de costo es/en con monto; sin aviso -> null', () => {
  const es = parseCancellationCost(
    'Atención ¿Desea cancelar el Viaje? La cancelación del Viaje  incluye un costo de 150.50'
  );
  assert.equal(es?.amount, '150.50');
  const en = parseCancellationCost(
    'Trip Cancel Are You Sure? Trip Cancellation Includes a cost of $12'
  );
  assert.equal(en?.amount, '12');
  assert.equal(parseCancellationCost('Atención ¿Desea cancelar el Viaje?'), null);
});

test('SEGURIDAD (estático): los taps de cancelación solo los invoca TripCancelPBO', () => {
  const appium = fileURLToPath(new URL('../../', import.meta.url));
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(`${dir}${e.name}/`)
        : e.name.endsWith('.ts') && !e.name.endsWith('.unit.ts')
          ? [`${dir}${e.name}`]
          : []
    );
  const offenders = walk(appium).filter((f) => {
    if (/TripCancelScreen\.ts$|TripCancelPBO\.ts$/.test(f)) return false;
    const code = readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    return /tapCancelCta|tapDialogConfirm/.test(code);
  });
  assert.deepEqual(offenders, []);
});

test('SEGURIDAD (estático): TripCancelScreen nunca toca «Llamar»/«Call»', () => {
  const src = readFileSync(
    fileURLToPath(new URL('./TripCancelScreen.ts', import.meta.url)),
    'utf8'
  );
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/llamar|['"]call['"]/i.test(code));
});
