import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { normalizeStorageStateLanguage } from './storage-state-locale.js';

describe('storage-state-locale', () => {
  function fixture(lang: string): string {
    const path = join(mkdtempSync(join(tmpdir(), 'ss-locale-')), 'state.json');
    writeFileSync(
      path,
      JSON.stringify({
        cookies: [{ name: 'lang', value: lang }],
        origins: [
          {
            origin: 'https://x.test',
            localStorage: [
              { name: 'carrier-0', value: 'token-sintetico' },
              { name: 'carrier-31', value: lang }
            ]
          }
        ]
      })
    );
    return path;
  }

  it('es-ar pasa a en-us y reporta el valor previo', () => {
    const path = fixture('es-ar');
    assert.deepEqual(normalizeStorageStateLanguage(path), { changed: true, previous: 'es-ar' });
    const out = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(out.origins[0].localStorage[1].value, 'en-us');
    assert.equal(out.cookies[0].value, 'en-us');
    assert.equal(out.origins[0].localStorage[0].value, 'token-sintetico');
  });

  it('ya en en-us: no cambia ni reescribe', () => {
    const path = fixture('en-us');
    assert.deepEqual(normalizeStorageStateLanguage(path), { changed: false, previous: null });
  });

  it('language es escribe es-ar; sin clave no inventa nada', () => {
    const path = fixture('en-us');
    assert.equal(normalizeStorageStateLanguage(path, 'es').changed, true);
    const empty = join(mkdtempSync(join(tmpdir(), 'ss-locale-')), 's.json');
    writeFileSync(empty, JSON.stringify({ cookies: [], origins: [] }));
    assert.deepEqual(normalizeStorageStateLanguage(empty), { changed: false, previous: null });
  });
});
