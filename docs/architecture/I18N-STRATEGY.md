# Estrategia i18n — correr la misma suite en EN y ES

> **Estado: NOTA DE DISEÑO. No implementado.**
> Destino: Fase 3 del saneamiento, junto con la creación de `tests/data/carrier-v2/screens.ts`.
> Hoy la suite es **100% inglés** y así debe mantenerse hasta que esto se implemente.

## Por qué existe este documento

El portal carrier V2 se sirve en inglés y en español según la cuenta. Hoy los POMs
**aparentan** soportar ambos idiomas: casi todos los `headingRegex` tienen una alternativa
en español.

```ts
// tests/pages/carrier-v2/clients/ClientListPage.ts
protected get headingRegex(): RegExp {
  return /^customers management$|^gesti[oó]n de clientes$/i;
}
```

Esas alternativas **no fueron verificadas contra el DOM real**: se escribieron por traducción
directa del inglés. Cuando se corrió la suite contra una cuenta con locale español
(2026-08-31), fallaron sistemáticamente.

### Evidencia medida

Headings reales capturados de los artifacts de fallo (`evidence/test/playwright-artifacts/*/error-context.md`):

| Pantalla   | Regex del POM                                          | Heading real en ES                       | Por qué no matchea                                                                                 |
| ---------- | ------------------------------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Customers  | `/^customers management$\|^gesti[oó]n de clientes$/i`  | `Clientes / Gestión Pasajeros`           | vocabulario distinto (_Pasajeros_ ≠ _clientes_) **y** anclajes `^…$` vs formato breadcrumb `X / Y` |
| Drivers    | `/^drivers$\|^conductores$/i`                          | `Choferes / Gestión de Choferes`         | _Choferes_ ≠ _conductores_                                                                         |
| Owners     | `/^owners management$\|^gesti[oó]n de propietarios$/i` | `Propietarios / Gestión de Propietarios` | el texto está, pero los anclajes `^…$` lo rechazan                                                 |
| Map Viewer | —                                                      | `Visor de Mapa`                          | —                                                                                                  |

Tres modos de fallo distintos: **vocabulario adivinado**, **anclajes incompatibles con el
formato breadcrumb**, y POMs escritos contra la UI en inglés.

> **Decisión tomada (2026-08-31)**: en la Fase 1 se limpian los regex dejándolos
> **correctos y solo en inglés**. Las alternativas en español se eliminan en vez de
> corregirse: mantenerlas a medias da una falsa sensación de soporte bilingüe. El soporte
> real queda pendiente y documentado acá.

## Objetivo

Correr **la misma suite** contra un carrier en inglés o en español **sin duplicar specs**.

## Diseño propuesto

### 1. Diccionario de labels por locale en el registry

Extender `tests/data/carrier-v2/screens.ts` (el registry que centraliza ruta, prioridad y
trazabilidad por pantalla) con labels por idioma.

**Forma: objeto con clave semántica estable. Nunca un array posicional.**

```ts
// tests/data/carrier-v2/screens.ts
export const SCREENS = {
  drivers: {
    route: '/carrier/#/driver/list',
    priority: 'P1',
    labels: {
      heading: { en: 'Drivers', es: 'Choferes' },
      newButton: { en: 'New Driver', es: 'Nuevo Chofer' }
    }
  }
} as const;
```

Un array posicional (`['Drivers', 'Choferes']`) rompe en silencio si alguien reordena o
inserta un idioma. La clave semántica (`heading`, `newButton`) hace el acceso explícito y
tipable, y permite agregar un tercer idioma sin tocar nada existente.

Los POMs pasarían de tener el texto embebido a leerlo del registry:

```ts
// en vez de:  protected get headingRegex() { return /^drivers$|^conductores$/i; }
// quedaría:   SCREENS.drivers.labels.heading[locale]
```

### 2. Regla de oro: localizar ≠ verificar

Esta es la parte importante del diseño, y limita bastante cuánto diccionario hace falta.

| Para                                                                   | Usar                                                                                               | Por qué                                                                     |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Localizar** un elemento (click, fill, esperar que exista)            | Selector **independiente del idioma**: `data-testid`, `role` + atributo estable, `formcontrolname` | Un test que hace click en un botón no necesita saber cómo se llama el botón |
| **Verificar** que el texto mostrado es el correcto en el idioma actual | El diccionario de locale                                                                           | Acá el string _es_ lo que se está testeando                                 |

El diagnóstico del repo ya identificó que **la palanca de mayor impacto es pedirle a Dev que
agregue `data-testid`**, no reescribir POMs — hoy hay 59 `getByRole` contra 40 `.locator(css)`,
y los CSS crudos existen precisamente porque el portal no expone roles ni labels estables
(ver `docs/qa/release-v2.0.4/a11y-audit-results.md`: 64 nodos `button-name`, 19 `label`).

Cuanto más avance ese pedido, **menos diccionario hace falta**: el i18n deja de ser un
problema de localización y queda reducido a los pocos tests que verifican texto visible.

### 3. Ejecución: projects de Playwright, no specs duplicados

El repo ya usa `projects` para separar viewports y suites (`carrier-v2-desktop`,
`carrier-v2-laptop`, `visual`, `codegen`). El mismo mecanismo sirve acá:

```
carrier-v2-desktop-en   → credenciales EN, locale 'en'
carrier-v2-desktop-es   → credenciales ES, locale 'es'
```

Cada project inyecta qué locale usar (vía fixture o `use`), y los specs se escriben una sola
vez. En CI se elige qué projects correr por suite: por ejemplo smoke en ambos idiomas, y
regression solo en el primario, para no duplicar el tiempo de nightly.

Encaja con `resolveCredentials(region)` de `tests/config/runtime.ts`, que ya resuelve
`USER_CARRIER_<REGION>` por región.

### 4. Antes de escribir una sola traducción a mano

**Confirmar si el frontend Angular ya tiene sus propios archivos de i18n.** Es lo típico con
`ngx-translate` o Angular i18n: un `en.json` / `es.json` real en el repo del frontend.

Hay indicios fuertes de que existen — varios comentarios del código ya referencian claves de
traducción concretas:

- `tests/pages/shared/BaseListPage.ts:96` → `{{ 'table_footer_common.show' | translate }}`
- `global-setup.ts:41` → _"El submit lleva texto i18n `login.sign_in`"_
- `docs/inventory/INVENTORY-V2-BRANCHES.md` → commits del tipo _"add table_header_client_type to en-us.json"_, _"use correct i18n keys"_

Ese último confirma que hay un **`en-us.json`** en el repo del frontend
(`magiis-fe-carrier-v2`, ver `.agents/project.yaml`).

Si esos archivos son accesibles, **son la fuente de verdad correcta** para poblar el
diccionario. Reescribir las traducciones a mano garantiza que se desincronicen la próxima vez
que Dev cambie un label — que es exactamente el fallo que este documento está registrando.

Opciones, de mejor a peor:

1. Generar `screens.ts` desde los `en-us.json` / `es.json` del frontend con un script
   (`scripts/`), regenerable cuando Dev los cambie.
2. Copiar los strings a mano desde esos archivos, dejando registrada la clave i18n de origen.
3. Escribirlos a mano leyendo la UI. **Último recurso** — es lo que produjo el problema actual.

## Qué NO hacer

- **No** corregir a medias los regex en español que hay hoy. O se implementa el diseño
  completo, o quedan solo en inglés y el gap queda documentado (que es el estado elegido).
- **No** duplicar specs por idioma.
- **No** inventar traducciones. Aplica `docs/scope-rules.md` §4 ("Sin invención"): igual que
  no se inventan selectores, no se inventan strings de UI.

## Precondiciones para implementarlo

1. Que exista `tests/data/carrier-v2/screens.ts` (Fase 3).
2. Acceso a los archivos i18n del frontend, o confirmación de que no existen.
3. Una cuenta de carrier por idioma, ambas operativas.
   > Nota (2026-08-31): la cuenta EN de TEST está trabada en el gate de términos y condiciones
   > del primer login (`/carrier/#/authentication/login/terms`, 2 checkboxes + botón "Ok"),
   > que impide llegar al dashboard. Resolver antes de cualquier trabajo multi-locale.
4. Decisión de producto: ¿ambos idiomas son soportados oficialmente y hay que regresionarlos,
   o el español es incidental? Eso define si esto vale el esfuerzo.
