// tests/pages/shared/BasePage.unit.ts
// Unit test del reintento acotado de navegacion de BasePage (node:test, Page falso).
// Run: npx tsx --test tests/pages/shared/BasePage.unit.ts
import { test as nodeTest, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from '@playwright/test';
import { BasePage } from './BasePage.js';

process.env.NAV_RETRY_DELAY_MS = '0';

class ProbePage extends BasePage {
  open(path: string): Promise<void> {
    return this.navigate(path, 1_000);
  }
}

function fakePage(errors: Array<string | null>): { page: Page; calls: number } {
  const state = { calls: 0 };
  const page = {
    goto: () => {
      const error = errors[Math.min(state.calls++, errors.length - 1)];
      return error ? Promise.reject(new Error(error)) : Promise.resolve(null);
    }
  } as unknown as Page;
  return {
    page,
    get calls() {
      return state.calls;
    }
  };
}

afterEach(() => {
  delete process.env.NAV_RETRY;
});

const NET = 'page.goto: net::ERR_TIMED_OUT at https://apps-test.magiis.com/carrier/#/travel/create';

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('reintenta una vez si el goto falla por red y el segundo intento carga', async () => {
  const fake = fakePage([NET, null]);
  await new ProbePage(fake.page).open('/carrier/#/travel/create');
  assert.equal(fake.calls, 2);
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('no reintenta mas de una vez: si el ambiente sigue caido propaga el error', async () => {
  const fake = fakePage([NET, NET, null]);
  await assert.rejects(new ProbePage(fake.page).open('/x'), /ERR_TIMED_OUT/);
  assert.equal(fake.calls, 2);
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('no reintenta errores que no son de red', async () => {
  const fake = fakePage(['page.goto: net::ERR_CERT_AUTHORITY_INVALID at https://x/', null]);
  await assert.rejects(new ProbePage(fake.page).open('/x'), /ERR_CERT_AUTHORITY_INVALID/);
  assert.equal(fake.calls, 1);
});

// eslint-disable-next-line playwright/expect-expect -- node:test, no Playwright; usa assert
nodeTest('NAV_RETRY=0 desactiva el reintento', async () => {
  process.env.NAV_RETRY = '0';
  const fake = fakePage([NET, null]);
  await assert.rejects(new ProbePage(fake.page).open('/x'), /ERR_TIMED_OUT/);
  assert.equal(fake.calls, 1);
});
