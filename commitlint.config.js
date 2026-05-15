// commitlint.config.js
// Enforcement del formato del CLAUDE.md global:
//   <tipo>(<scope>): [MX-XXXX] descripcion corta
// Ejemplos validos:
//   feat(auth): [MX-1234] login carrier v2 spec
//   docs(inventory): [MX-4820] poblar inventario
//   chore(ci): actualizar workflow smoke
// Permitimos commits sin [MX-XXXX] para infra/scripts (chore, ci).
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert']
    ],
    'subject-case': [0],
    'header-max-length': [2, 'always', 120]
  }
};
