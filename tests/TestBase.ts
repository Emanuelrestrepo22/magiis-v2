// tests/TestBase.ts
// Re-export central de fixtures + helpers para uso uniforme en specs.
// Pattern: `import { test, expect } from '../../TestBase.js';`
import { test as authTest, expect } from './fixtures/authFixture.js';

export const test = authTest;
export { expect };
export * from './helpers/index.js';
