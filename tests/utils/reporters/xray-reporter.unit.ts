// tests/utils/reporters/xray-reporter.unit.ts
// Unit test del reporter Xray de punta a punta (node:test -- sin runner de Playwright):
// se alimenta onTestEnd con TestCase/TestResult falsos y se lee el JSON que escribe onEnd.
// Sufijo .unit.ts para que Playwright (testDir ./tests, testMatch por defecto) NO lo
// recoja como spec. `test` se importa como `nodeTest` y cada caso lleva un eslint-disable
// puntual de playwright/expect-expect (mismo criterio que xray-consolidate.unit.ts).
// Run: npx tsx --test tests/utils/reporters/xray-consolidate.unit.ts tests/utils/reporters/xray-reporter.unit.ts
import { test as nodeTest, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FullResult, TestCase, TestResult } from '@playwright/test/reporter';
import XrayReporter, { redactJsonText } from './xray-reporter.js';

// Valores falsos, solo para verificar que la redacción los elimina.
const FAKE_TOKEN = 'FAKE_TOKEN_NOT_REAL_0123456789';
const FAKE_PASSWORD = 'fake-password-not-real';

interface FakeAnnotation {
  type: string;
  description?: string;
}

interface Emitted {
  testExecutionKey?: string;
  tests: {
    testKey: string;
    status: string;
    comment?: string;
    evidence?: { data: string; filename: string; contentType: string }[];
  }[];
}

const tmpDirs: string[] = [];
const ENV_KEYS = ['XRAY_KEY_ALLOWLIST', 'XRAY_EXECUTION_KEY'] as const;

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  while (tmpDirs.length > 0) rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
});

function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'xray-reporter-unit-'));
  tmpDirs.push(dir);
  return dir;
}

function fakeTest(title: string, annotations: FakeAnnotation[], retries = 0): TestCase {
  return {
    title,
    annotations,
    retries,
    parent: { project: () => ({ name: 'carrier-v2-desktop' }) }
  } as unknown as TestCase;
}

function fakeResult(
  status: TestResult['status'],
  opts: {
    annotations?: FakeAnnotation[];
    attachments?: TestResult['attachments'];
    error?: string;
    retry?: number;
    duration?: number;
  } = {}
): TestResult {
  return {
    status,
    retry: opts.retry ?? 0,
    startTime: new Date('2026-09-29T12:00:00.000Z'),
    duration: opts.duration ?? 1500,
    annotations: opts.annotations ?? [],
    attachments: opts.attachments ?? [],
    error: opts.error ? { message: opts.error } : undefined
  } as unknown as TestResult;
}

async function runWithStatus(
  feed: (r: XrayReporter) => void
): Promise<{ out: Emitted; endStatus: string | undefined }> {
  const outputFile = join(tmp(), 'xray-results.json');
  const reporter = new XrayReporter({ outputFile });
  // Silencia el resumen (y los avisos) que el reporter imprime en onEnd.
  const silenced = mock.method(console, 'log', () => undefined);
  const silencedWarn = mock.method(console, 'warn', () => undefined);
  let endStatus: string | undefined;
  try {
    feed(reporter);
    endStatus = (await reporter.onEnd({ status: 'passed' } as FullResult))?.status;
  } finally {
    silenced.mock.restore();
    silencedWarn.mock.restore();
  }
  return { out: JSON.parse(readFileSync(outputFile, 'utf-8')) as Emitted, endStatus };
}

async function run(feed: (r: XrayReporter) => void): Promise<Emitted> {
  return (await runWithStatus(feed)).out;
}

/** Adjunto png mínimo (el gate de evidencia exige ≥1 adjunto para emitir PASSED/FAILED). */
function png(name: string): TestResult['attachments'][number] {
  return { name, contentType: 'image/png', body: Buffer.from(`png-${name}`) };
}

function decode(data: string): string {
  return Buffer.from(data, 'base64').toString('utf-8');
}

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('PASSED lleva comment de medición y evidence png + json redactado', async () => {
  const dir = tmp();
  const pngPath = join(dir, 'alta-otros-costos.png');
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  writeFileSync(pngPath, pngBytes);
  const medicion = JSON.stringify({
    travelId: 123,
    otherCosts: [{ id: 27, type: 'FIJO', value: 100 }],
    headers: { Authorization: `Bearer ${FAKE_TOKEN}` },
    token: FAKE_TOKEN,
    nested: { password: FAKE_PASSWORD, note: `access_token=${FAKE_TOKEN}` }
  });

  const out = await run((r) =>
    r.onTestEnd(
      fakeTest('TC103: Validar alta con otros costos', [{ type: 'tms', description: 'TM-1084' }]),
      fakeResult('passed', {
        annotations: [
          {
            type: 'xray_comment',
            description: 'Ambiente uat, carrier 1481: API devolvió 2 conceptos, total 250 USD'
          },
          { type: 'known-defect', description: 'D1 (preexistente)' }
        ],
        attachments: [
          { name: 'alta', contentType: 'image/png', path: pngPath },
          {
            name: 'medicion-TM-1084',
            contentType: 'application/json',
            body: Buffer.from(medicion)
          },
          { name: 'trace', contentType: 'application/zip', body: Buffer.from('zip') }
        ]
      })
    )
  );

  assert.equal(out.tests.length, 1);
  const [t] = out.tests;
  assert.equal(t.testKey, 'TM-1084');
  assert.equal(t.status, 'PASSED');
  assert.ok(t.comment?.startsWith('Veredicto: PASSED'));
  assert.match(t.comment ?? '', /TC103: Validar alta con otros costos \[carrier-v2-desktop\]/);
  assert.match(t.comment ?? '', /API devolvió 2 conceptos, total 250 USD/);
  assert.match(t.comment ?? '', /D1 \(preexistente\)/);
  assert.match(
    t.comment ?? '',
    /Evidencia adjunta: alta-otros-costos\.png, medicion-TM-1084\.json/
  );

  assert.equal(t.evidence?.length, 2, 'el zip no es evidencia');
  const [png, json] = t.evidence ?? [];
  assert.deepEqual(
    { filename: png.filename, contentType: png.contentType },
    { filename: 'alta-otros-costos.png', contentType: 'image/png' }
  );
  assert.deepEqual(Buffer.from(png.data, 'base64'), pngBytes);
  assert.equal(json.filename, 'medicion-TM-1084.json');
  assert.equal(json.contentType, 'application/json');
  const jsonText = decode(json.data);
  assert.ok(!jsonText.includes(FAKE_TOKEN), 'el token no debe llegar a Xray');
  assert.ok(!jsonText.includes(FAKE_PASSWORD), 'el password no debe llegar a Xray');
  const parsed = JSON.parse(jsonText) as Record<string, unknown>;
  assert.equal(parsed.travelId, 123);
  assert.deepEqual(parsed.otherCosts, [{ id: 27, type: 'FIJO', value: 100 }]);
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('key fuera de XRAY_KEY_ALLOWLIST se descarta; las de la lista se emiten', async () => {
  process.env.XRAY_KEY_ALLOWLIST = ' TM-1084 , TM-1085 ';
  const out = await run((r) => {
    r.onTestEnd(
      fakeTest('caso A', [{ type: 'tms', description: 'TM-1084' }]),
      fakeResult('passed')
    );
    r.onTestEnd(
      fakeTest('caso ajeno', [{ type: 'tms', description: 'TM-9999' }]),
      fakeResult('passed')
    );
    r.onTestEnd(fakeTest('[TM-1085] caso B', []), fakeResult('failed', { error: 'boom' }));
  });
  assert.deepEqual(out.tests.map((t) => t.testKey).sort(), ['TM-1084', 'TM-1085']);
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('allowlist vacía = sin filtro', async () => {
  process.env.XRAY_KEY_ALLOWLIST = ' , ';
  const out = await run((r) =>
    r.onTestEnd(fakeTest('caso', [{ type: 'tms', description: 'TM-9999' }]), fakeResult('passed'))
  );
  assert.deepEqual(
    out.tests.map((t) => t.testKey),
    ['TM-9999']
  );
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest(
  'un skip no degrada una key ya ejecutada (en cualquier orden) ni aporta evidencia',
  async () => {
    const skipAttachment: TestResult['attachments'] = [
      { name: 'skip', contentType: 'image/png', body: Buffer.from('skip-png') }
    ];
    const out = await run((r) => {
      r.onTestEnd(
        fakeTest('antes', [{ type: 'tms', description: 'TM-1277' }]),
        fakeResult('skipped', {
          annotations: [{ type: 'skip', description: 'regla de negativos pendiente de PO' }],
          attachments: skipAttachment
        })
      );
      r.onTestEnd(
        fakeTest('ejecutado', [{ type: 'tms', description: 'TM-1277' }]),
        fakeResult('passed', {
          annotations: [{ type: 'xray_comment', description: '500 acepta, 2000 bloquea' }],
          attachments: [{ name: 'modal-tope', contentType: 'image/png', body: Buffer.from('png') }]
        })
      );
      r.onTestEnd(
        fakeTest('después', [{ type: 'tms', description: 'TM-1277' }]),
        fakeResult('skipped', { annotations: [{ type: 'skip', description: 'otro motivo' }] })
      );
    });
    const [t] = out.tests;
    assert.equal(t.status, 'PASSED');
    assert.match(t.comment ?? '', /500 acepta, 2000 bloquea/);
    assert.match(t.comment ?? '', /regla de negativos pendiente de PO/);
    assert.deepEqual(
      t.evidence?.map((e) => e.filename),
      ['modal-tope.png']
    );
  }
);

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('todas las corridas skip -> TODO con motivo, sin evidencia', async () => {
  const out = await run((r) =>
    r.onTestEnd(
      fakeTest('negativos', [{ type: 'tms', description: 'TM-1279' }]),
      fakeResult('skipped', {
        annotations: [{ type: 'skip', description: 'regla de negativos pendiente de PO' }]
      })
    )
  );
  const [t] = out.tests;
  assert.equal(t.status, 'TODO');
  assert.ok(t.comment?.startsWith('Veredicto: TODO'));
  assert.match(t.comment ?? '', /regla de negativos pendiente de PO/);
  assert.equal(t.evidence, undefined);
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('FAILED: error redactado, evidencia del fallo primero y tope de 3 adjuntos', async () => {
  const pngs = (prefix: string, n: number): TestResult['attachments'] =>
    Array.from({ length: n }, (_, i) => ({
      name: `${prefix}-${i}`,
      contentType: 'image/png',
      body: Buffer.from(`${prefix}${i}`)
    }));
  const out = await run((r) => {
    r.onTestEnd(
      fakeTest('ok', [{ type: 'tms', description: 'TM-1086' }]),
      fakeResult('passed', { attachments: pngs('ok', 2) })
    );
    r.onTestEnd(
      fakeTest('ko', [{ type: 'tms', description: 'TM-1086' }]),
      fakeResult('failed', {
        error: `request failed\n  - authorization: Bearer ${FAKE_TOKEN}`,
        attachments: pngs('ko', 2)
      })
    );
  });
  const [t] = out.tests;
  assert.equal(t.status, 'FAILED');
  assert.ok(!(t.comment ?? '').includes(FAKE_TOKEN));
  assert.match(t.comment ?? '', /request failed/);
  assert.deepEqual(
    t.evidence?.map((e) => e.filename),
    ['ko-0.png', 'ko-1.png', 'ok-0.png']
  );
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('FAILED + 3 filas ok: evidencia de la fila fallida primero y tope 3', async () => {
  const json: TestResult['attachments'][number] = {
    name: 'medicion-ko',
    contentType: 'application/json',
    body: Buffer.from('{"v":"ko"}')
  };
  const out = await run((r) => {
    for (const n of ['a', 'b', 'c']) {
      r.onTestEnd(
        fakeTest(n, [{ type: 'tms', description: 'TM-1402' }]),
        fakeResult('passed', { attachments: [png(`ok-${n}`)] })
      );
    }
    r.onTestEnd(
      fakeTest('ko', [{ type: 'tms', description: 'TM-1402' }]),
      fakeResult('failed', { error: 'boom', attachments: [png('ko-grid'), json] })
    );
  });
  const names = out.tests[0].evidence?.map((e) => e.filename) ?? [];
  // consolidated measurement first, then the failing row's evidence (png + json), cap 3.
  assert.deepEqual(names, ['medicion-consolidada-TM-1402.json', 'ko-grid.png', 'medicion-ko.json']);
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('PASSED con 4 filas: exactamente 3 adjuntos', async () => {
  const out = await run((r) => {
    for (const n of ['a', 'b', 'c', 'd']) {
      r.onTestEnd(
        fakeTest(n, [{ type: 'tms', description: 'TM-1402' }]),
        fakeResult('passed', { attachments: [png(`p-${n}`)] })
      );
    }
  });
  assert.equal(out.tests[0].evidence?.length, 3);
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('dos tests con la misma key publican el png de AMBAS filas aunque haya json', async () => {
  const json = (n: string): TestResult['attachments'][number] => ({
    name: `medicion-${n}`,
    contentType: 'application/json',
    body: Buffer.from(`{"v":"${n}"}`)
  });
  const out = await run((r) => {
    r.onTestEnd(
      fakeTest('variante A', [{ type: 'tms', description: 'TM-1402' }]),
      fakeResult('passed', { attachments: [png('a-grid'), json('a')] })
    );
    r.onTestEnd(
      fakeTest('variante B', [{ type: 'tms', description: 'TM-1402' }]),
      fakeResult('passed', { attachments: [png('b-grid'), json('b')] })
    );
  });
  const names = out.tests[0].evidence?.map((e) => e.filename) ?? [];
  assert.ok(names.includes('a-grid.png'), 'falta el png de la variante A');
  assert.ok(names.includes('b-grid.png'), 'falta el png de la variante B');
  assert.equal(names.length, 3, 'respeta el tope: 2 png + 1 json');
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('evidencia duplicada por contenido entre filas se publica una sola vez', async () => {
  const same = (name: string): TestResult['attachments'][number] => ({
    name,
    contentType: 'image/png',
    body: Buffer.from('mismo-contenido')
  });
  const out = await run((r) => {
    r.onTestEnd(
      fakeTest('uno', [{ type: 'tms', description: 'TM-1402' }]),
      fakeResult('passed', { attachments: [same('x-1')] })
    );
    r.onTestEnd(
      fakeTest('dos', [{ type: 'tms', description: 'TM-1402' }]),
      fakeResult('passed', { attachments: [same('x-2')] })
    );
  });
  assert.deepEqual(
    out.tests[0].evidence?.map((e) => e.filename),
    ['x-1.png']
  );
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('comment se recorta a 1500 caracteres conservando el veredicto', async () => {
  const out = await run((r) =>
    r.onTestEnd(
      fakeTest('largo', [{ type: 'tms', description: 'TM-1087' }]),
      fakeResult('passed', {
        annotations: [{ type: 'xray_comment', description: 'x'.repeat(3000) }],
        attachments: [png('largo')]
      })
    )
  );
  const [t] = out.tests;
  assert.ok((t.comment ?? '').length <= 1500);
  assert.ok(t.comment?.startsWith('Veredicto: PASSED'));
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('redactJsonText: JSON inválido cae a redacción de texto', async () => {
  const out = redactJsonText(`no-json "token": "${FAKE_TOKEN}"`);
  assert.ok(!out.includes(FAKE_TOKEN));
});

// Token con forma de JWT, falso (payload {"exp":1}); solo para verificar el tachado por forma.
const FAKE_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjF9.ZmFrZV9zaWduYXR1cmVfbm90X3JlYWw';

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('skip final con retries > 0 igual produce fila (TM-1279 explícito)', async () => {
  const out = await run((r) =>
    r.onTestEnd(
      fakeTest('negativos', [{ type: 'tms', description: 'TM-1279' }], 1),
      fakeResult('skipped', {
        annotations: [{ type: 'skip', description: 'regla de negativos pendiente de PO' }]
      })
    )
  );
  assert.equal(out.tests.length, 1);
  assert.equal(out.tests[0].status, 'TODO');
  assert.match(out.tests[0].comment ?? '', /regla de negativos pendiente de PO/);
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('fallo intermedio con retry pendiente se descarta; el PASSED final se marca', async () => {
  const out = await run((r) => {
    r.onTestEnd(
      fakeTest('flaky', [{ type: 'tms', description: 'TM-1084' }], 1),
      fakeResult('failed', { error: 'primer intento', attachments: [png('ko')] })
    );
    r.onTestEnd(
      fakeTest('flaky', [{ type: 'tms', description: 'TM-1084' }], 1),
      fakeResult('passed', { retry: 1, attachments: [png('ok')] })
    );
  });
  const [t] = out.tests;
  assert.equal(t.status, 'PASSED');
  assert.match(t.comment ?? '', /reintento 1: el intento previo NO pasó/);
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('PASSED o FAILED sin evidencia: veredicto retenido como TODO y exit failed', async () => {
  const { out, endStatus } = await runWithStatus((r) => {
    r.onTestEnd(
      fakeTest('sin adjuntos ok', [{ type: 'tms', description: 'TM-1085' }]),
      fakeResult('passed', { annotations: [{ type: 'xray_comment', description: 'medido' }] })
    );
    r.onTestEnd(
      fakeTest('sin adjuntos ko', [{ type: 'tms', description: 'TM-1086' }]),
      fakeResult('failed', { error: 'boom en fixture' })
    );
  });
  assert.equal(endStatus, 'failed');
  assert.equal(out.tests.length, 2);
  for (const t of out.tests) {
    assert.equal(t.status, 'TODO', `${t.testKey} no debe salir con veredicto`);
    assert.match(t.comment ?? '', /Veredicto retenido: la corrida dio (PASSED|FAILED)/);
    assert.equal(t.evidence, undefined);
  }
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('con evidencia en todas las keys onEnd no fuerza failed', async () => {
  const { endStatus } = await runWithStatus((r) =>
    r.onTestEnd(
      fakeTest('ok', [{ type: 'tms', description: 'TM-1084' }]),
      fakeResult('passed', { attachments: [png('ok')] })
    )
  );
  assert.equal(endStatus, undefined);
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('skip al final de un test ejecutado conserva la medición que cita', async () => {
  const out = await run((r) =>
    r.onTestEnd(
      fakeTest('negativos', [{ type: 'tms', description: 'TM-1279' }]),
      fakeResult('skipped', {
        annotations: [
          { type: 'skip', description: 'regla de negativos pendiente de PO' },
          { type: 'xray_comment', description: 'A/B/C ejecutadas: +57' }
        ],
        attachments: [
          { name: 'medicion-TM-1279', contentType: 'application/json', body: Buffer.from('{}') }
        ]
      })
    )
  );
  const [t] = out.tests;
  assert.equal(t.status, 'TODO');
  assert.deepEqual(
    t.evidence?.map((e) => e.filename),
    ['medicion-TM-1279.json']
  );
  assert.match(t.comment ?? '', /A\/B\/C ejecutadas: \+57/);
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('JSON adjunto: claves con token por substring y JWT suelto se redactan', async () => {
  const medicion = JSON.stringify({
    sessionToken: FAKE_TOKEN,
    authToken: FAKE_TOKEN,
    'carrier-0': FAKE_JWT,
    nested: { note: `cabecera Bearer ${FAKE_TOKEN}` },
    travelId: 7
  });
  const out = await run((r) =>
    r.onTestEnd(
      fakeTest('redaccion', [{ type: 'tms', description: 'TM-1087' }]),
      fakeResult('passed', {
        attachments: [
          { name: 'medicion', contentType: 'application/json', body: Buffer.from(medicion) }
        ]
      })
    )
  );
  const text = decode(out.tests[0].evidence?.[0].data ?? '');
  assert.ok(!text.includes(FAKE_TOKEN), 'ningún token por nombre de clave');
  assert.ok(!text.includes(FAKE_JWT), 'ningún JWT suelto');
  assert.equal((JSON.parse(text) as { travelId: number }).travelId, 7);
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('error con Bearer o JWT suelto se redacta en el comment', async () => {
  const out = await run((r) =>
    r.onTestEnd(
      fakeTest('ko', [{ type: 'tms', description: 'TM-1090' }]),
      fakeResult('failed', {
        error: `respuesta {"originToken":"${FAKE_JWT}"} y Bearer ${FAKE_TOKEN}`,
        attachments: [png('ko')]
      })
    )
  );
  const comment = out.tests[0].comment ?? '';
  assert.ok(!comment.includes(FAKE_JWT));
  assert.ok(!comment.includes(FAKE_TOKEN));
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('recorte: conserva veredicto, línea de Limpieza y lista de adjuntos', async () => {
  const out = await run((r) =>
    r.onTestEnd(
      fakeTest('ko largo', [{ type: 'tms', description: 'TM-1091' }]),
      fakeResult('failed', {
        error: 'e'.repeat(3000),
        annotations: [
          { type: 'xray_comment', description: 'm'.repeat(2000) },
          { type: 'xray_comment', description: 'Limpieza: nada · ERRORES: viaje 99: 400.' }
        ],
        attachments: [png('evid')]
      })
    )
  );
  const comment = out.tests[0].comment ?? '';
  assert.ok(comment.length <= 1500);
  assert.ok(comment.startsWith('Veredicto: FAILED'));
  assert.match(comment, /Limpieza: nada · ERRORES: viaje 99: 400\./);
  assert.match(comment, /Evidencia adjunta: evid\.png/);
});

// --- Capa 1 del plan de remediación de flaky (2026-10-08): clasificación de ambiente ---

const GOTO_TIMEOUT =
  'page.goto: net::ERR_TIMED_OUT at https://apps-test.magiis.com/carrier/#/travel/create';

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest(
  'intento previo caído por red + reintento OK → PASSED clasificado env-flaky (caso TC162 del 06/10)',
  async () => {
    const out = await run((r) => {
      r.onTestEnd(
        fakeTest('TC162 Destino Abierto', [{ type: 'tms', description: 'TM-603' }], 2),
        fakeResult('failed', { error: GOTO_TIMEOUT, attachments: [png('ko')] })
      );
      r.onTestEnd(
        fakeTest('TC162 Destino Abierto', [{ type: 'tms', description: 'TM-603' }], 2),
        fakeResult('passed', { retry: 1, attachments: [png('ok')] })
      );
    });
    const [t] = out.tests;
    assert.equal(t.status, 'PASSED');
    assert.match(
      t.comment ?? '',
      /Clasificación: env-flaky \(intento previo con net::ERR_TIMED_OUT\)/
    );
    assert.match(t.comment ?? '', /el intento previo falló por el ambiente, net::ERR_TIMED_OUT/);
  }
);

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest(
  'intento previo caído por asercion + reintento OK → sigue siendo flaky del test, sin env-flaky',
  async () => {
    const out = await run((r) => {
      r.onTestEnd(
        fakeTest('flaky real', [{ type: 'tms', description: 'TM-604' }], 1),
        fakeResult('failed', {
          error: 'expect(locator).toBeEnabled() failed',
          attachments: [png('ko')]
        })
      );
      r.onTestEnd(
        fakeTest('flaky real', [{ type: 'tms', description: 'TM-604' }], 1),
        fakeResult('passed', { retry: 1, attachments: [png('ok')] })
      );
    });
    const [t] = out.tests;
    assert.equal(t.status, 'PASSED');
    assert.doesNotMatch(t.comment ?? '', /env-flaky|Clasificación/);
    assert.match(t.comment ?? '', /reintento 1: el intento previo NO pasó/);
  }
);

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest(
  'annotation env-retry de BasePage sin retry de Playwright → PASSED clasificado env-flaky',
  async () => {
    const out = await run((r) => {
      r.onTestEnd(
        fakeTest('TC163', [{ type: 'tms', description: 'TM-604' }]),
        fakeResult('passed', {
          attachments: [png('ok')],
          annotations: [
            {
              type: 'env-retry',
              description:
                'navegacion a /carrier/#/travel/create sin respuesta del servidor (net::ERR_TIMED_OUT); reintentada una vez'
            }
          ]
        })
      );
    });
    const [t] = out.tests;
    assert.equal(t.status, 'PASSED');
    assert.match(
      t.comment ?? '',
      /Clasificación: env-flaky \(navegacion a \/carrier\/#\/travel\/create sin respuesta/
    );
  }
);

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest(
  'resultado final caído por red → TODO con clasificación de ambiente, nunca FAILED',
  async () => {
    const out = await run((r) => {
      r.onTestEnd(
        fakeTest('TC162', [{ type: 'tms', description: 'TM-603' }]),
        fakeResult('failed', { error: GOTO_TIMEOUT, attachments: [png('ko')] })
      );
    });
    const [t] = out.tests;
    assert.equal(t.status, 'TODO');
    assert.match(
      t.comment ?? '',
      /Clasificación: ambiente \(net::ERR_TIMED_OUT en la navegación inicial\)/
    );
    assert.match(t.comment ?? '', /ambiente sin respuesta \(net::ERR_TIMED_OUT/);
  }
);

const SLOW_LOAD = {
  type: 'env-slow-load',
  description:
    'Nuevo Viaje tardo 28s en quedar listo; timeout del test extendido 18s (exceso sobre 10s) [loadMs=28000]'
};

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest(
  'timeout global con annotation env-slow-load → FAILED (sin clasificacion de ambiente)',
  async () => {
    const out = await run((r) => {
      r.onTestEnd(
        fakeTest('TC166', [{ type: 'tms', description: 'TM-607' }]),
        fakeResult('timedOut', {
          error: 'Test timeout of 78000ms exceeded.',
          attachments: [png('ko')],
          annotations: [SLOW_LOAD],
          duration: 78_000
        })
      );
    });
    assert.equal(out.tests[0].status, 'FAILED');
    assert.doesNotMatch(out.tests[0].comment ?? '', /Clasificación: ambiente/);
  }
);

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('carga lenta con falla de asercion real → sigue FAILED (no se enmascara)', async () => {
  const out = await run((r) => {
    r.onTestEnd(
      fakeTest('TC166', [{ type: 'tms', description: 'TM-607' }]),
      fakeResult('failed', {
        error: 'expect(locator).toBeHidden() failed',
        attachments: [png('ko')],
        annotations: [SLOW_LOAD]
      })
    );
  });
  assert.equal(out.tests[0].status, 'FAILED');
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('timeout global sin carga lenta registrada → sigue FAILED', async () => {
  const out = await run((r) => {
    r.onTestEnd(
      fakeTest('TC166', [{ type: 'tms', description: 'TM-607' }]),
      fakeResult('timedOut', {
        error: 'Test timeout of 60000ms exceeded.',
        attachments: [png('ko')]
      })
    );
  });
  assert.equal(out.tests[0].status, 'FAILED');
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest(
  'una corrida caída por red no degrada a otra corrida de la misma key que pasó',
  async () => {
    const out = await run((r) => {
      r.onTestEnd(
        fakeTest('TC162 desktop', [{ type: 'tms', description: 'TM-603' }]),
        fakeResult('failed', { error: GOTO_TIMEOUT, attachments: [png('ko')] })
      );
      r.onTestEnd(
        fakeTest('TC162 mobile', [{ type: 'tms', description: 'TM-603' }]),
        fakeResult('passed', { attachments: [png('ok')] })
      );
    });
    const [t] = out.tests;
    assert.equal(t.status, 'PASSED');
    assert.match(
      t.comment ?? '',
      /Clasificación: env-flaky \(otra corrida de la key cayó con net::ERR_TIMED_OUT\)/
    );
  }
);

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest(
  'ambiente caído en global-setup → no se escribe resultado y se borra el de la corrida anterior',
  async () => {
    const outputFile = join(tmp(), 'xray-results.json');
    writeFileSync(outputFile, '{"tests":[{"testKey":"TM-1","status":"PASSED"}]}', 'utf-8');
    process.env.MAGIIS_ENVIRONMENT_DOWN = '1';
    const reporter = new XrayReporter({ outputFile });
    const silencedWarn = mock.method(console, 'warn', () => undefined);
    try {
      const end = await reporter.onEnd({ status: 'failed' } as FullResult);
      assert.equal(end?.status, 'failed');
    } finally {
      silencedWarn.mock.restore();
      delete process.env.MAGIIS_ENVIRONMENT_DOWN;
    }
    assert.throws(() => readFileSync(outputFile, 'utf-8'), /ENOENT/);
  }
);

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest(
  'key con 3 filas: json consolidado con TODAS las mediciones aunque 3 png llenen el tope',
  async () => {
    const json = (n: string): TestResult['attachments'][number] => ({
      name: `medicion-${n}`,
      contentType: 'application/json',
      body: Buffer.from(`{"travelId":"${n}"}`)
    });
    const out = await run((r) => {
      for (const n of ['a', 'b', 'c']) {
        r.onTestEnd(
          fakeTest(`fila ${n}`, [{ type: 'tms', description: 'TM-1402' }]),
          fakeResult('passed', { attachments: [png(`grid-${n}`), json(n)] })
        );
      }
    });
    const ev = out.tests[0].evidence ?? [];
    assert.equal(ev.length, 3);
    assert.equal(ev[0].filename, 'medicion-consolidada-TM-1402.json');
    const parsed = JSON.parse(decode(ev[0].data)) as {
      rows: { title: string; measurements: { data: { travelId: string } }[] }[];
    };
    assert.deepEqual(
      parsed.rows.map((r) => [r.title, r.measurements[0].data.travelId]),
      [
        ['fila a', 'a'],
        ['fila b', 'b'],
        ['fila c', 'c']
      ]
    );
  }
);

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest(
  'key con 3 filas de medición larga: el comment conserva un tramo de CADA fila',
  async () => {
    const out = await run((r) => {
      for (const n of ['uno', 'dos', 'tres']) {
        r.onTestEnd(
          fakeTest(`fila ${n}`, [{ type: 'tms', description: 'TM-1402' }]),
          fakeResult('passed', {
            annotations: [{ type: 'xray_comment', description: `ROW-${n} ${'x'.repeat(900)}` }],
            attachments: [png(`g-${n}`)]
          })
        );
      }
    });
    const comment = out.tests[0].comment ?? '';
    assert.ok(comment.length <= 1500);
    for (const n of ['uno', 'dos', 'tres']) assert.match(comment, new RegExp(`ROW-${n}`));
    assert.match(comment, /Evidencia adjunta:/);
  }
);

// --- known-issue / observation (circuito FR 1901) ---

const KI_90 =
  'AC-FR-90 KI: THOUSANDS_SEPARATOR=SPACE en FR → 500 en la confirmación: POST 500: rendición persistida';
const OBS_64 = 'AC-FR-64 Observación PO Q1: al editar tarifa el PCT no se recalcula: no se asevera';

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest(
  'known-issue: un test que pasó en Playwright se acredita FAILED con AC y nota',
  async () => {
    const out = await run((r) =>
      r.onTestEnd(
        fakeTest('FR-S1: validar-circuito', [{ type: 'tms', description: 'TM-1449' }]),
        fakeResult('passed', {
          annotations: [{ type: 'known-issue', description: KI_90 }],
          attachments: [png('ac-AC-FR-90')]
        })
      )
    );
    const [t] = out.tests;
    assert.equal(t.testKey, 'TM-1449');
    assert.equal(t.status, 'FAILED');
    assert.match(t.comment ?? '', /^Veredicto: FAILED/);
    assert.match(t.comment ?? '', /Defecto conocido \(1\)/);
    assert.match(t.comment ?? '', /AC-FR-90 KI: THOUSANDS_SEPARATOR/);
    assert.match(t.comment ?? '', /Evidencia adjunta: ac-AC-FR-90\.png/);
  }
);

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('observation: se anexa al comment y NO cambia el estado', async () => {
  const out = await run((r) =>
    r.onTestEnd(
      fakeTest('FR-S2: validar-circuito', [{ type: 'tms', description: 'TM-1482' }]),
      fakeResult('passed', {
        annotations: [{ type: 'observation', description: OBS_64 }],
        attachments: [png('ac-AC-FR-64')]
      })
    )
  );
  const [t] = out.tests;
  assert.equal(t.status, 'PASSED');
  assert.match(t.comment ?? '', /Observaciones al PO \(no cambian el estado del run\)/);
  assert.match(t.comment ?? '', /AC-FR-64 Observación PO Q1/);
  assert.doesNotMatch(t.comment ?? '', /Defecto conocido/);
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('known-issue + observation juntos: FAILED y ambas secciones', async () => {
  const out = await run((r) =>
    r.onTestEnd(
      fakeTest('FR-S2', [{ type: 'tms', description: 'TM-1482' }]),
      fakeResult('passed', {
        annotations: [
          { type: 'known-issue', description: KI_90 },
          { type: 'observation', description: OBS_64 }
        ],
        attachments: [png('ev')]
      })
    )
  );
  const [t] = out.tests;
  assert.equal(t.status, 'FAILED');
  assert.match(t.comment ?? '', /AC-FR-90/);
  assert.match(t.comment ?? '', /AC-FR-64/);
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('known-issue en una fila omitida no degrada la key ni acredita FAILED', async () => {
  const out = await run((r) => {
    r.onTestEnd(
      fakeTest('FR-SET-3 ejecutado', [{ type: 'tms', description: 'TM-1465' }]),
      fakeResult('passed', { attachments: [png('ok')] })
    );
    r.onTestEnd(
      fakeTest('FR-SET-4 omitido', [{ type: 'tms', description: 'TM-1465' }]),
      fakeResult('skipped', {
        annotations: [
          { type: 'known-issue', description: KI_90 },
          { type: 'skip', description: 'requiere FR_CONFIRM_SETTLEMENT=1' }
        ]
      })
    );
  });
  const [t] = out.tests;
  assert.equal(t.status, 'PASSED');
  assert.doesNotMatch(t.comment ?? '', /Defecto conocido/);
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('known-issue en una fila de una key con varias filas: peor estado = FAILED', async () => {
  const out = await run((r) => {
    r.onTestEnd(
      fakeTest('EDM-CASH-FARE-UP', [{ type: 'tms', description: 'TM-1486' }]),
      fakeResult('passed', { attachments: [png('a')] })
    );
    r.onTestEnd(
      fakeTest('EDM-CC-FARE-UP', [{ type: 'tms', description: 'TM-1486' }]),
      fakeResult('passed', {
        annotations: [{ type: 'known-issue', description: KI_90 }],
        attachments: [png('b')]
      })
    );
  });
  const [t] = out.tests;
  assert.equal(t.status, 'FAILED');
  assert.match(t.comment ?? '', /AC-FR-90/);
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('known-issue + error real: sigue FAILED y conserva el error', async () => {
  const out = await run((r) =>
    r.onTestEnd(
      fakeTest('R2', [{ type: 'tms', description: 'TM-1493' }]),
      fakeResult('failed', {
        error: 'Expected 15968.3 received 15914.3',
        annotations: [{ type: 'known-issue', description: KI_90 }],
        attachments: [png('r2')]
      })
    )
  );
  const [t] = out.tests;
  assert.equal(t.status, 'FAILED');
  assert.match(t.comment ?? '', /Expected 15968\.3/);
  assert.match(t.comment ?? '', /AC-FR-90/);
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('muchas notas: el comment respeta el tope y conserva veredicto y adjuntos', async () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    type: i % 2 === 0 ? 'known-issue' : 'observation',
    description: `AC-FR-${90 + i} ${'detalle largo '.repeat(40)}`
  }));
  const out = await run((r) =>
    r.onTestEnd(
      fakeTest('R3', [{ type: 'tms', description: 'TM-1494' }]),
      fakeResult('passed', { annotations: many, attachments: [png('r3')] })
    )
  );
  const [t] = out.tests;
  assert.equal(t.status, 'FAILED');
  assert.ok((t.comment ?? '').length <= 1500, `largo ${(t.comment ?? '').length}`);
  assert.match(t.comment ?? '', /^Veredicto: FAILED/);
  assert.match(t.comment ?? '', /Evidencia adjunta: r3\.png/);
  assert.match(t.comment ?? '', /\(\+1 más\)/);
});

// ---- Varias keys por test (spec compuesto): cada key con su propio estado ----

const S1_ANN: FakeAnnotation[] = [
  { type: 'tms', description: 'TM-1449' },
  { type: 'tms', description: 'TM-1445' },
  { type: 'tms_acs', description: 'TM-1445: AC-FR-01, AC-FR-02, AC-FR-03, AC-FR-04, AC-FR-05' },
  { type: 'tms', description: 'TM-1447' },
  { type: 'tms_acs', description: 'TM-1447: AC-FR-06, AC-FR-07, AC-FR-08' }
];
const byKey = (out: Emitted, key: string): Emitted['tests'][number] =>
  out.tests.find((t) => t.testKey === key) as Emitted['tests'][number];

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest(
  'multi-key: un test emite un resultado por key; sin tms_acs usa el estado del test',
  async () => {
    const out = await run((r) =>
      r.onTestEnd(
        fakeTest('FR-S1', [
          { type: 'tms', description: 'TM-1449' },
          { type: 'tms', description: 'TM-1445' }
        ]),
        fakeResult('passed', { attachments: [png('s1')] })
      )
    );
    assert.deepEqual(out.tests.map((t) => t.testKey).sort(), ['TM-1445', 'TM-1449']);
    assert.ok(out.tests.every((t) => t.status === 'PASSED'));
  }
);

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest(
  'multi-key: cada key toma solo sus AC (FAIL de otro AC no la degrada) y lista sus ACs',
  async () => {
    const out = await run((r) =>
      r.onTestEnd(
        fakeTest('FR-S1', S1_ANN),
        fakeResult('failed', {
          error: 'boom en AC-FR-07',
          annotations: [
            ...['01', '02', '03', '04', '05'].map((n) => ({
              type: 'ac',
              description: `AC-FR-${n} PASS`
            })),
            { type: 'ac', description: 'AC-FR-06 PASS' },
            { type: 'ac', description: 'AC-FR-07 FAIL' }
          ],
          attachments: [
            png('s1'),
            { name: 'ac-AC-FR-07', contentType: 'application/json', body: Buffer.from('{"x":1}') }
          ]
        })
      )
    );
    assert.equal(byKey(out, 'TM-1449').status, 'FAILED');
    assert.equal(byKey(out, 'TM-1445').status, 'PASSED');
    assert.match(
      byKey(out, 'TM-1445').comment ?? '',
      /ACs de la key \(5\): AC-FR-01 PASS; AC-FR-02 PASS/
    );
    assert.equal(byKey(out, 'TM-1447').status, 'FAILED');
    assert.match(byKey(out, 'TM-1447').comment ?? '', /AC-FR-07 FAIL; AC-FR-08 sin ejecutar/);
    // La evidencia del AC ajeno no se cuela en la key de «alta».
    assert.ok(!(byKey(out, 'TM-1445').evidence ?? []).some((e) => /ac-AC-FR-07/i.test(e.filename)));
  }
);

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('multi-key: TODO si ninguno de sus ACs se ejecuto (el test cayo antes)', async () => {
  const out = await run((r) =>
    r.onTestEnd(
      fakeTest('FR-S1', S1_ANN),
      fakeResult('failed', {
        error: 'preflight roto',
        annotations: [{ type: 'ac', description: 'AC-FR-01 PASS' }],
        attachments: [png('s1')]
      })
    )
  );
  assert.equal(byKey(out, 'TM-1445').status, 'PASSED');
  assert.equal(byKey(out, 'TM-1447').status, 'TODO');
  assert.match(byKey(out, 'TM-1447').comment ?? '', /ninguno de los ACs de la key/);
  assert.equal(byKey(out, 'TM-1449').status, 'FAILED');
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('multi-key: known-issue se atribuye por key segun el AC citado', async () => {
  const ki = (id: string): FakeAnnotation => ({
    type: 'known-issue',
    description: `${id} detalle: defecto`
  });
  const passAll = ['01', '02', '03', '04', '05', '06', '07', '08'].map((n) => ({
    type: 'ac',
    description: `AC-FR-${n} PASS`
  }));
  const out = await run((r) => {
    // AC-FR-90 no pertenece a ninguna key con ACs: solo degrada a la key sin ACs (TM-1449).
    r.onTestEnd(
      fakeTest('FR-S1 a', S1_ANN),
      fakeResult('passed', { annotations: [...passAll, ki('AC-FR-90')], attachments: [png('a')] })
    );
  });
  assert.equal(byKey(out, 'TM-1449').status, 'FAILED');
  assert.match(byKey(out, 'TM-1449').comment ?? '', /Defecto conocido \(1\)/);
  assert.equal(byKey(out, 'TM-1445').status, 'PASSED');
  assert.equal(byKey(out, 'TM-1447').status, 'PASSED');
  assert.doesNotMatch(byKey(out, 'TM-1447').comment ?? '', /Defecto conocido/);

  // known-issue sobre un AC de TM-1447 (aunque el test pase): solo esa key queda FAILED.
  const out2 = await run((r) =>
    r.onTestEnd(
      fakeTest('FR-S1 b', S1_ANN),
      fakeResult('passed', { annotations: [...passAll, ki('AC-FR-08')], attachments: [png('b')] })
    )
  );
  assert.equal(byKey(out2, 'TM-1447').status, 'FAILED');
  assert.match(byKey(out2, 'TM-1447').comment ?? '', /Defecto conocido \(1\)/);
  assert.equal(byKey(out2, 'TM-1445').status, 'PASSED');
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest(
  'multi-key: test omitido deja todas las keys en TODO y la allowlist filtra por key',
  async () => {
    process.env.XRAY_KEY_ALLOWLIST = 'TM-1445,TM-1447';
    const out = await run((r) =>
      r.onTestEnd(
        fakeTest('FR-S1', S1_ANN),
        fakeResult('skipped', { annotations: [{ type: 'skip', description: 'sin gate' }] })
      )
    );
    assert.deepEqual(out.tests.map((t) => t.testKey).sort(), ['TM-1445', 'TM-1447']);
    assert.ok(out.tests.every((t) => t.status === 'TODO'));
  }
);
