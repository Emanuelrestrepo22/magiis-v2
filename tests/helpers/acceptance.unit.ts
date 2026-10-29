import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TestInfo } from '@playwright/test';
import {
  AC,
  acAnnotation,
  acLabel,
  knownIssue,
  noteAnnotation,
  observation,
  verifyAc,
  type AcId,
  type StepRunner
} from './acceptance.js';

type Attachment = { name: string; body: string };

function fakeInfo(): {
  info: TestInfo;
  annotations: Array<{ type: string; description?: string }>;
  attachments: Attachment[];
  errors: unknown[];
} {
  const annotations: Array<{ type: string; description?: string }> = [];
  const attachments: Attachment[] = [];
  const errors: unknown[] = [];
  const info = {
    annotations,
    errors,
    attach: async (name: string, opts: { body: string }) => {
      attachments.push({ name, body: opts.body });
    }
  } as unknown as TestInfo;
  return { info, annotations, attachments, errors };
}

const titles: string[] = [];
const runStep: StepRunner = async (title, body) => {
  titles.push(title);
  return body();
};
const ID = 'AC-FR-01' as AcId;

describe('acceptance (registro)', () => {
  it('ids unicos con formato AC-FR-NN consecutivo y titulo no vacio', () => {
    const ids = Object.keys(AC);
    assert.ok(ids.length > 0);
    ids.forEach((id, i) => {
      assert.match(id, /^AC-FR-\d{2,}$/);
      assert.equal(id, `AC-FR-${String(i + 1).padStart(2, '0')}`);
      assert.ok(AC[id as AcId].trim().length > 0);
    });
    assert.equal(new Set(ids).size, ids.length);
  });

  it('etiqueta y anotaciones', () => {
    assert.equal(acLabel(ID), `${ID}: ${AC[ID]}`);
    assert.deepEqual(acAnnotation(ID, 'PASS'), { type: 'ac', description: `${ID} PASS` });
    assert.equal(noteAnnotation('known-issue', ID, 'nota').type, 'known-issue');
    assert.match(noteAnnotation('observation', ID, 'nota').description, /nota$/);
  });
});

describe('acceptance (helpers)', () => {
  it('verifyAc PASS: step con el id, anotacion y evidencia', async () => {
    const { info, annotations, attachments } = fakeInfo();
    const out = await verifyAc(info, ID, () => ({ travelId: 7 }), runStep);
    assert.deepEqual(out, { travelId: 7 });
    assert.equal(titles.at(-1), acLabel(ID));
    assert.deepEqual(annotations, [acAnnotation(ID, 'PASS')]);
    assert.equal(attachments[0].name, `ac-${ID}`);
    const body = JSON.parse(attachments[0].body) as { status: string; evidence: unknown };
    assert.equal(body.status, 'PASS');
    assert.deepEqual(body.evidence, { travelId: 7 });
  });

  it('verifyAc FAIL: anota, adjunta el error y relanza', async () => {
    const { info, annotations, attachments } = fakeInfo();
    await assert.rejects(
      verifyAc(
        info,
        ID,
        () => {
          throw new Error('boom');
        },
        runStep
      ),
      /boom/
    );
    assert.deepEqual(annotations, [acAnnotation(ID, 'FAIL')]);
    assert.equal((JSON.parse(attachments[0].body) as { error: string }).error, 'boom');
  });

  it('verifyAc FAIL por errores soft acumulados (el step no lanza)', async () => {
    const { info, annotations, errors } = fakeInfo();
    await verifyAc(
      info,
      ID,
      () => {
        errors.push(new Error('soft'));
      },
      runStep
    );
    assert.deepEqual(annotations, [acAnnotation(ID, 'FAIL')]);
  });

  it('knownIssue y observation solo anotan', () => {
    const { info, annotations } = fakeInfo();
    knownIssue(info, ID, 'POST 500');
    observation(info, ID, 'PCT no se recalcula');
    assert.deepEqual(
      annotations.map((a) => a.type),
      ['known-issue', 'observation']
    );
    assert.match(annotations[0].description ?? '', /POST 500$/);
  });
});
