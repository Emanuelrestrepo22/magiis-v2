/**
 * Generador de spec para portal carrier V2.
 *
 * Uso:
 *   npm run scaffold:spec -- --name ReportsTrips --route /carrier/#/reports/trips \
 *                            --jira MX-1234 --priority P1 --domain reports [--portal carrier-v2] \
 *                            [--type functional|visual|a11y] [--force] [--dry]
 *
 * Output: tests/specs/<domain>/<name-kebab>.spec.ts con:
 *   - Tags: @<priority> @<type> @migration
 *   - Annotations jira + route_v2 (lo lee scripts/extract-tc-map.ts)
 *   - Import del POM correspondiente
 *   - Smoke test que valida goto + URL pattern
 */
import { resolve } from 'node:path';
import {
  parseArgs,
  requireArg,
  optionalArg,
  toPascalCase,
  toKebabCase,
  escapeRegexLiteral,
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
const fileSlug = toKebabCase(name.replace(/Page$/, ''));
const routeRegex = escapeRegexLiteral(route);

const visualBlock =
  type === 'visual'
    ? `
  test('snapshot baseline', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: '${jira}' });
    test.info().annotations.push({ type: 'route_v2', description: '${route}' });
    const screen = new ${className}(page);
    await screen.goto();
    await expect(page).toHaveScreenshot('${fileSlug}-visual.png');
  });`
    : '';

const functionalBlock =
  type === 'visual'
    ? ''
    : `
  test('${fileSlug} renderiza tras login', async ({ page }) => {
    test.info().annotations.push({ type: 'jira', description: '${jira}' });
    test.info().annotations.push({ type: 'route_v2', description: '${route}' });

    const screen = new ${className}(page);
    await screen.goto();
    await expect(page).toHaveURL(/${routeRegex}/);
  });`;

const typeTag = type === 'visual' ? '@visual' : type === 'a11y' ? '@a11y' : '@functional';

const template = `// tests/specs/${domain}/${fileSlug}.spec.ts
import { test, expect } from '../../TestBase.js';
import { ${className} } from '../../pages/${portal}/${className}.js';

test.describe('@${priority} ${typeTag} @migration ${className}', () => {${functionalBlock}${visualBlock}
});
`;

const filename = type === 'visual' ? `${fileSlug}.visual.spec.ts` : `${fileSlug}.spec.ts`;
const targetPath = resolve(repoRoot(), 'tests', 'specs', domain, filename);
writeFileSafe(targetPath, template, { force, dry });

if (!dry) {
  console.log(
    `\nSiguiente paso sugerido:\n  npm run traceability   # regenerar tc-map para incluir el nuevo spec\n`
  );
}
