/**
 * Generador de Page Object para portal carrier V2.
 *
 * Uso:
 *   npm run scaffold:page -- --name ReportsTrips --route /carrier/#/reports/trips \
 *                            --jira MX-1234 --priority P1 --domain reports \
 *                            [--portal carrier-v2] [--force] [--dry]
 *
 * Output: tests/pages/<portal>/<domain>/<Name>Page.ts segun CONVENTIONS.md §1.
 *   El dominio es el mismo que el del spec, para que una pantalla se lea igual de los dos
 *   lados (tests/specs/trips/... <-> tests/pages/carrier-v2/trips/...).
 *   - Hereda BasePage
 *   - Locators readonly en constructor
 *   - goto() + heading wait
 *   - JSDoc @jira @route @priority @type
 */
import { resolve } from 'node:path';
import {
  parseArgs,
  requireArg,
  optionalArg,
  toPascalCase,
  toKebabCase,
  writeFileSafe,
  repoRoot
} from './shared.js';

const args = parseArgs(process.argv.slice(2));

const nameRaw = requireArg(args, 'name');
const route = requireArg(args, 'route');
const jira = requireArg(args, 'jira');
const priority = optionalArg(args, 'priority', 'P1').toUpperCase();
const domain = requireArg(args, 'domain');
const portal = optionalArg(args, 'portal', 'carrier-v2');
const type = optionalArg(args, 'type', 'functional');
const force = args.force === true;
const dry = args.dry === true;

const name = toPascalCase(nameRaw);
const className = name.endsWith('Page') ? name : `${name}Page`;
const headingRegex = toKebabCase(nameRaw)
  .replace(/-/g, '|')
  .replace(/[^a-z0-9|]/g, '');

const template = `// tests/pages/${portal}/${domain}/${className}.ts
/**
 * @jira ${jira}
 * @route ${route}
 * @priority ${priority}
 * @type ${type}
 */
import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { BasePage } from '../../shared/BasePage.js';

export class ${className} extends BasePage {
  readonly mainHeading: Locator;

  constructor(page: Page) {
    super(page);
    // TODO(${jira}): ajustar el heading-regex contra el DOM real (getByRole > getByText).
    this.mainHeading = page.getByRole('heading', { name: /${headingRegex || 'titulo'}/i });
  }

  async goto(): Promise<void> {
    await this.navigate('${route}');
    await expect(this.mainHeading).toBeVisible({ timeout: 10_000 });
  }
}
`;

const targetPath = resolve(repoRoot(), 'tests', 'pages', portal, domain, `${className}.ts`);
writeFileSafe(targetPath, template, { force, dry });

if (!dry) {
  console.log(
    `\nSiguiente paso sugerido:\n  npm run scaffold:spec -- --name ${name} --route "${route}" --jira ${jira} --priority ${priority} --domain ${domain}\n` +
      `\nRecorda agregar el export al barrel tests/pages/${portal}/index.ts (el scaffold no lo toca).\n`
  );
}
