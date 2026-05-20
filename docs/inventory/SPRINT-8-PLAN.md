# Sprint 8 — Settlements + Affiliate detail flows (con `:id`)

Snapshot: 2026-05-19. Primer Sprint que aborda **flujos padre-hijo** (lista → click row → detail con `:id` capturado).

## Alcance

12 rutas con parámetros `:id` distribuidas en 2 módulos:

### Settlements / Liquidations (8 rutas en 4 tipos)

Cada tipo (contractor/passenger/driver/owner) tiene 4 sub-rutas:

| Tipo | Create | Details | Last liquidation | History |
|---|---|---|---|---|
| Contractor | `/liquidations/contractors/create/:contractor-id` | `/liquidations/contractors/details/:contractor-id/:liquidation-id` | `/liquidations/contractors/last-liquidation/:contractor-id/:last-liquidation-id` | `/liquidations/contractors/history/:id` |
| Passenger | `/liquidations/passenger/create/:passenger-id` | `/liquidations/passenger/details/:passenger-id/:liquidation-id` | idem | `/liquidations/passenger/history/:id` |
| Driver | `/liquidations/drivers/create/:driver-id` | `/liquidations/drivers/details/:driver-id/:liquidation-id` | idem | `/liquidations/drivers/history/:id` |
| Owner | `/liquidations/owners/create/:owner-id` | `/liquidations/owners/details/:owner-id/:liquidation-id` | idem | `/liquidations/owners/history/:id` |

### Affiliate (3 rutas)

| Pantalla | URL | MX |
|---|---|---|
| Affiliate Liquidation Detail | `/affiliate/liquidation-detail/:id/:editMode` | MX-5646 |
| Affiliate CC Detail | `/affiliate/checking-account-detail/:checkingAccountId/:typeView` | MX-5648 |
| Affiliate Liquidations List | `/affiliate/checking-account/:checkingAccountId/liquidations/list/:typeView` | MX-5647 (con :id) |

## Patrón "flujo padre-hijo"

Cada test sigue el mismo patrón:

```typescript
test('MX-XXXX <tipo> details accesible via row click', async ({ page }) => {
  // 1. Llegar a la lista padre.
  const listPage = new SettlementsContractorListPage(page);
  await listPage.goto();
  await listPage.expectListReady();

  // 2. Validar que hay datos en TEST.
  const rows = listPage.table.getByRole('row');
  await expect(rows).not.toHaveCount(0);

  // 3. Click en la primera row.
  await rows.first().click();

  // 4. Validar redirect con :id en URL.
  await expect(page).toHaveURL(/\/contractors\/details\/[a-z0-9-]+\/[a-z0-9-]+/);

  // 5. Validar contenido del detail.
  const detailPage = new SettlementsContractorDetailPage(page);
  await detailPage.expectDetailReady();
});
```

## Bloqueador potencial — datos en TEST

Estos tests requieren que en `apps-test.magiis.com/carrier` haya:
- Al menos 1 contractor con liquidación cerrada (para `/contractors/list`).
- Al menos 1 passenger, driver, owner con liquidación (idem).
- Al menos 1 affiliate con checking account activa.

**Si las listas están vacías** (lo que vimos en CC Afiliados: tabla con "Loading..." indefinido), los tests fallarán en el step "validar que hay datos". Se documenta como **skip condicional** + bug-report a QA seed data.

## Estrategia con `@playwright/mcp` (próxima sesión)

`@playwright/mcp` se agregó al `.mcp.json` en el último commit del Sprint 7. Para activarlo:

1. **Reiniciar Claude Code** (cerrar y reabrir la app).
2. Verificar que `mcp__playwright__*` tools aparezcan en ToolSearch.
3. Usar `browser_snapshot` + `browser_navigate` + `browser_click` para discovery del flujo padre-hijo en vivo, sin escribir specs intermedios.
4. Generar POMs basados en el aria tree devuelto por Playwright MCP.
5. Comparativa vs `sidebar-discovery.spec.ts`:
   - Tiempo total de discovery por pantalla.
   - Calidad de selectores generados.
   - Esfuerzo manual de ajuste.

## Estructura POMs propuesta

```
tests/pages/carrier-v2/
├── (existentes Sprint 1-7)
└── settlements/                    (subcarpeta nueva)
    ├── SettlementsContractorDetailPage.ts
    ├── SettlementsContractorHistoryPage.ts
    ├── SettlementsPassengerDetailPage.ts
    ├── SettlementsPassengerHistoryPage.ts
    ├── SettlementsDriverDetailPage.ts
    ├── SettlementsDriverHistoryPage.ts
    ├── SettlementsOwnerDetailPage.ts
    └── SettlementsOwnerHistoryPage.ts
```

Posible `BaseSettlementDetailPage` para reusar estructura (create / details / last / history compartían `ContractorLiquidationCreateComponent` según routing).

## Estimación

| Item | Estimación |
|---|---|
| Discovery (con `@playwright/mcp` activo) | 1 hora |
| Generación 8 POMs Settlements + 3 Affiliate | 2 horas |
| Generación 11 specs P1 funcional | 1.5 horas |
| Smoke run + ajustes | 1 hora |
| Commit + push + PR | 0.5 horas |
| **TOTAL** | **~6 horas (1 sesión larga)** |

## Pre-condiciones para iniciar

- [x] Sprint 1-7 mergeado en `main` ✅
- [x] Branch `carrier-v2/sprint-8-detail-flows` creada ✅
- [ ] Claude Code reiniciado con `@playwright/mcp` activo
- [ ] Confirmar con QA seed/data que hay registros en TEST para todos los tipos
- [ ] Validar que el usuario `remises.eeuu@yopmail.com` tiene permisos para ver detail flows

## Riesgos identificados

1. **Listas vacías en TEST** → tests con `expect(rows).not.toHaveCount(0)` fallan. Mitigación: usar `.skip()` condicional o crear datos vía Seed API si dev expone.
2. **`:id` no capturable desde DOM** (si la row no es `<a href>` sino `(click)="goTo()"`) → necesita interceptar `page.url()` post-click.
3. **Permisos del usuario carrier** sobre detail pages → si hay 403/redirect a dashboard, el test falla. Mitigación: probar manualmente primero.
4. **`@playwright/mcp` no carga tras reinicio** → fallback al flujo actual con `sidebar-discovery.spec.ts`.
