// Unit de ScreenEvidence + Evidence con driver/capturer falsos (sin Appium ni device).
// Run: npx tsx --test tests/mobile/appium/core/ScreenEvidence.unit.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Evidence } from './Evidence.js';
import { ScreenEvidence, mobileEvidenceRoot } from './ScreenEvidence.js';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

/** Driver falso: `saveScreenshot` escribe una cabecera PNG en la ruta pedida. */
const fakeDriver = (fail = false) =>
  ({
    saveScreenshot: async (abs: string) => {
      if (fail) throw new Error('device caído');
      writeFileSync(abs, PNG);
    }
  }) as unknown as WebdriverIO.Browser;

const tmp = () => mkdtempSync(path.join(tmpdir(), 'mobile-evidence-'));
const quiet = () => undefined;

test('mobileEvidenceRoot resuelve evidence/<env>/mobile', () => {
  assert.equal(
    mobileEvidenceRoot('uat', '/repo'),
    path.resolve('/repo', 'evidence', 'uat', 'mobile')
  );
});

test('checkpoint escribe un PNG numerado bajo evidence/<env>/mobile/<run> y devuelve ruta relativa', async () => {
  const cwd = tmp();
  try {
    const ev = Evidence.forDriver(() => fakeDriver(), 'run-1', { cwd, env: 'test', log: quiet });
    const ref = await ev.checkpoint('confirm');
    assert.equal(ref.relPath, 'evidence/test/mobile/run-1/01-checkpoint-confirm.png');
    const abs = path.join(cwd, ref.relPath);
    assert.ok(existsSync(abs));
    assert.deepEqual(readFileSync(abs), PNG);
    await ev.capture('otra cosa/rara');
    assert.equal(ev.all().length, 2);
    assert.match(ev.all()[1]!.relPath, /02-otra-cosa-rara\.png$/);
    assert.match(ev.manifest()[0]!, /01-checkpoint-confirm\.png {2}— checkpoint-confirm/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('root inyectado manda sobre env/cwd', async () => {
  const cwd = tmp();
  try {
    const shots = new ScreenEvidence(fakeDriver(), 'r', {
      cwd,
      root: path.join(cwd, 'x'),
      log: quiet
    });
    const ref = await shots.capture('a');
    assert.equal(ref.relPath, 'x/r/01-a.png');
    assert.ok(existsSync(path.join(cwd, ref.relPath)));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('attachTo adjunta >=1 PNG aunque el cuerpo del test lance (finally)', async () => {
  const cwd = tmp();
  const attached: { name: string; path: string; contentType: string }[] = [];
  const attacher = {
    attach: async (name: string, o: { path: string; contentType: string }) => {
      attached.push({ name, ...o });
    }
  };
  const ev = Evidence.forDriver(() => fakeDriver(), 'run-fail', { cwd, env: 'test', log: quiet });
  try {
    await assert.rejects(
      (async () => {
        try {
          throw new Error('el test falló antes de capturar nada');
        } finally {
          await ev.attachTo(attacher);
        }
      })(),
      /el test falló/
    );
    assert.equal(attached.length, 1);
    assert.equal(attached[0]!.name, 'final');
    assert.equal(attached[0]!.contentType, 'image/png');
    assert.ok(existsSync(attached[0]!.path));
    assert.match(
      attached[0]!.path.split(path.sep).join('/'),
      /evidence\/test\/mobile\/run-fail\/01-final\.png$/
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('finalize no duplica si ya hubo capturas y no lanza si el device no responde', async () => {
  const cwd = tmp();
  try {
    const ev = Evidence.forDriver(() => fakeDriver(), 'r', { cwd, env: 'test', log: quiet });
    await ev.checkpoint('x');
    assert.equal((await ev.finalize()).length, 1);
    const dead = Evidence.forDriver(() => fakeDriver(true), 'r2', { cwd, env: 'test', log: quiet });
    assert.deepEqual(await dead.finalize(), []);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
