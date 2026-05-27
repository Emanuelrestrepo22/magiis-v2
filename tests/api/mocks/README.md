# tests/api/mocks — Mocking de red (FW-009)

Helpers para interceptar respuestas del backend con `route.fulfill` y estabilizar
specs que dependen de datos volatiles.

## Helpers disponibles (`listMock.ts`)

| Helper                                         | Uso                                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------------- |
| `mockListResponse(page, urlPattern, payload)`  | Devuelve un fixture determinista para requests GET que matcheen el patron. |
| `mockErrorResponse(page, urlPattern, status?)` | Simula error (500/403/...) para cubrir empty/error states.                 |

## Cuando mockear (y cuando no)

**Mockear si:**

- Un visual spec falla intermitente porque la pantalla muestra datos que cambian
  (saldos, fechas, contadores). Mockear -> baseline estable.
- Un edge case (lista vacia, error 500, 403 sin permisos) es dificil de provocar
  via UI real.

**NO mockear si:**

- El objetivo del spec es validar que el frontend consume bien el backend real
  (integracion). Mockear ahi esconde bugs reales.
- Un smoke `@P1` de "la pantalla carga" — debe pegarle al backend real.

## Ejemplo completo

```ts
import { test, expect } from '../../TestBase.js';
import { ClientListPage } from '../../pages/carrier-v2/ClientListPage.js';
import { mockListResponse } from '../../api/mocks/listMock.js';
import clients from '@data/carrier-v2/clients/sample-clients.example.json' assert { type: 'json' };

test('@visual lista de clientes con dataset fijo', async ({ page }) => {
  await mockListResponse(page, /\/api\/.*\/clients/, clients);
  const list = new ClientListPage(page);
  await list.goto();
  await expect(page).toHaveScreenshot('client-list-fixed.png');
});
```

> El patron de URL (`/\/api\/.*\/clients/`) es ilustrativo. Confirmar el endpoint
> real del backend carrier V2 antes de usar en un spec productivo (capturar con
> `page.on('request')` o el Network tab durante discovery).

## Estado FW-009

Scaffold inicial con 2 helpers genericos. Ningun spec los consume todavia. Se
adoptan cuando un visual spec concreto necesite estabilizar datos volatiles.
