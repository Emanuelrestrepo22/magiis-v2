# Inventario de branches V2 carrier - magiis-fe-carrier-v2

Snapshot: 2026-05-18 19:37 | Fuente: GitLab API project 64829657 | Total: 115 branches en 110 MX ids unicos.

Cada branch feature/MX-XXXX-suffix representa un ticket Jira en estado finalizado o en review. El portal V2 deployado en apps-test.magiis.com integra el merge de estas branches en develop (no visible en GitLab API publica).

## Customers (7 branches)

| MX | branch | autor | fecha | titulo |
| --- | --- | --- | --- | --- |
| MX-5725 | `feature/MX-5725-client-create` | repo.magiis | 2026-05-14 | fix(MX-5726): rework mutual exclusion using (change) + setValue emi... |
| MX-5727 | `feature/MX-5727-client-contractor-list` | SanaLaMente | 2026-05-12 | fix(MX-5727): update empty state translation key in client and cont... |
| MX-5724 | `feature/MX-5724-client-list` | repo.magiis | 2026-05-11 | fix(MX-5724): add table_header_client_type to en-us.json |
| MX-5197 | `feature/MX-5197-client-list` | SanaLaMente | 2026-04-23 | feat(MX-5197): unify client list with type filter + polish |
| MX-5170 | `feature/MX-5170-client-edit` | SanaLaMente | 2026-04-23 | chore(MX-5170): GAP-008 remove dead toaster-container comment |
| MX-5195 | `feature/MX-5195-client-contractor` | SanaLaMente | 2026-04-23 | fix(MX-5195): use correct i18n keys for confirmation messages and l... |
| MX-5596 | `feature/MX-5596-reports-ranking-clients` | darcknico | 2026-04-14 | feat(MX-5596): implement reports-ranking-clients migration |

## Owners (11 branches)

| MX | branch | autor | fecha | titulo |
| --- | --- | --- | --- | --- |
| MX-5601 | `feature/MX-5601-owner-report` | Cristian | 2026-05-07 | MX-5601 igualar alto de cards KPI con min-height uniforme |
| MX-5699 | `feature/MX-5699-owner-liquidation-detail` | SanaLaMente | 2026-04-27 | feat(settlements): add OwnerLiquidationDetailComponent for MX-5699 |
| MX-5697 | `feature/MX-5697-owner-liquidation-create` | Cristian | 2026-04-24 | feat(MX-5699): fix 5 GAPs in owner-liquidation-detail mode |
| MX-5696 | `feature/MX-5696-owner-liquidation-history` | Cristian | 2026-04-23 | feat(MX-5696): migrate owner-liquidation-history page |
| MX-5695 | `feature/MX-5695-owner-checking-account-detail` | Cristian | 2026-04-22 | feat(MX-5695): migrate owner-checking-account-detail page |
| MX-5625 | `feature/MX-5625-checking-accounts-owners` | darcknico | 2026-04-22 | fix(MX-5625): segunda revision |
| MX-5624 | `feature/MX-5624-owner-liquidation` | darcknico | 2026-04-22 | fix(MX-5624) segunda revision |
| MX-5683 | `feature/MX-5683-owner-edit` | Cristian | 2026-04-20 | feat(owner-edit): implement edit mode for FormOwnerComponent [MX-5683] |
| MX-5680 | `feature/MX-5680-owner-add` | Cristian | 2026-04-20 | feat(owner-add): implement FormOwnerComponent â Alta Propietarios... |
| MX-5666 | `feature/MX-5666-owner-heat-map` | repo.magiis | 2026-04-17 | feat(MX-5666): migrate owner-heat-map page |
| MX-5604 | `feature/MX-5604-owner-list` | darcknico | 2026-04-15 | feat(MX-5604): migrate owner-list page to Angular 18 |

## Drivers (5 branches)

| MX | branch | autor | fecha | titulo |
| --- | --- | --- | --- | --- |
| MX-5692 | `feature/MX-5692-driver-checking-account` | Cristian | 2026-04-22 | fix(MX-5692): fix modal cancel and form validation binding in drive... |
| MX-5690 | `feature/MX-5690-driver-advances-list` | repo.magiis | 2026-04-21 | fix(MX-5690): fix grid load using userId + add refresh button (ACT-... |
| MX-5690 | `feature/MX-5690-pay-drivers-advancements` | Cristian | 2026-04-21 | fix(auth-interceptor): exclude assets/i18n from auth check [MX-5690] |
| MX-5603 | `feature/MX-5603-checking-accounts-drivers` | Cristian | 2026-04-21 | fix(i18n): fix translation keys not loading for checking-accounts-d... |
| MX-5582 | `feature/MX-5582-driver-liquidation` | darcknico | 2026-04-16 | feat(MX-5582): migrate driver liquidation page to Angular 18 |

## Vehicles (2 branches)

| MX | branch | autor | fecha | titulo |
| --- | --- | --- | --- | --- |
| MX-5605 | `feature/MX-5605-report-vehicles-ranking` | darcknico | 2026-04-27 | feat(MX-5605): segunda revision |
| MX-5627 | `feature/MX-5627-settings-transport-types` | darcknico | 2026-04-23 | feat(MX-5627): segunda revision |

## Settlements (4 branches)

| MX | branch | autor | fecha | titulo |
| --- | --- | --- | --- | --- |
| MX-5623 | `feature/MX-5623-contractor-liquidation` | darcknico | 2026-04-20 | feat(MX-5623): migrate contractor-liquidation page to Angular 18 |
| MX-5647 | `feature/MX-5647-affiliate-liquidations-list` | darcknico | 2026-04-10 | feat(MX-5647): migrate affiliate liquidations list page |
| MX-5646 | `feature/MX-5646-affiliate-liquidation-detail` | darcknico | 2026-04-10 | feat(MX-5646): implement affiliate-liquidation-detail page migration |
| MX-5602 | `feature/MX-5602-passenger-liquidation` | repo.magiis | 2026-04-10 | feat(MX-5602): migrate passenger-liquidation page |

## CreditAccounts (3 branches)

| MX | branch | autor | fecha | titulo |
| --- | --- | --- | --- | --- |
| MX-5554 | `feature/MX-5554-affiliate-checking-account` | repo.magiis | 2026-04-14 | fix |
| MX-5574 | `feature/MX-5574-gnet-credit-accounts` | darcknico | 2026-04-13 | feat(MX-5574): migrate credit accounts page to Angular 18 |
| MX-5648 | `feature/MX-5648-affiliate-checking-account-detail` | repo.magiis | 2026-04-09 | feat(MX-5648): implement affiliate-checking-account-detail migration |

## Reports (15 branches)

| MX | branch | autor | fecha | titulo |
| --- | --- | --- | --- | --- |
| MX-5629 | `feature/MX-5629-reports-corporate-services` | darcknico | 2026-04-23 | fix(MX-5629): segunda revision |
| MX-5565 | `feature/MX-5565-reports-transaction-tracking` | darcknico | 2026-04-09 | feat(MX-5565): migrate reports-transaction-tracking page to Angular 18 |
| MX-5632 | `feature/MX-5632-reports-cost-center` | repo.magiis | 2026-04-09 | feat(MX-5632): migrate reports-cost-center page |
| MX-5562 | `feature/MX-5562-reports-cash-flow` | darcknico | 2026-04-08 | feat(MX-5562): migrate reports-cash-flow page to Angular 18 |
| MX-5569 | `feature/MX-5569-reports-documentation` | darcknico | 2026-04-08 | feat(MX-5569): migrate reports-documentation page to Angular 18 |
| MX-5563 | `feature/MX-5563-reports-daily` | darcknico | 2026-04-08 | feat(MX-5563): migrate reports-daily page to Angular 18 |
| MX-5593 | `feature/MX-5593-reports-individual-ca-travels` | repo.magiis | 2026-04-07 | feat(MX-5593): migrate reports-individual-ca-travels page |
| MX-5561 | `feature/MX-5561-reports-debt-aging` | darcknico | 2026-04-07 | feat(MX-5561): migrate reports-debt-aging to Angular 18 |
| MX-5566 | `feature/MX-5566-reports-taxes-and-fees` | darcknico | 2026-04-07 | feat(MX-5566): migrate reports-taxes-and-fees page to Angular 18 |
| MX-5560 | `feature/MX-5560-reports-tips` | darcknico | 2026-04-07 | feat(MX-5560): migrate reports-tips page to Angular 18 |
| MX-5568 | `feature/MX-5568-reports-payment-flow` | darcknico | 2026-04-07 | feat(MX-5568): migrate reports-payment-flow page to Angular 18 |
| MX-5571 | `feature/MX-5571-reports-agency-commissions` | darcknico | 2026-04-06 | fix(MX-5571): icon replacements, calendar button and ng-select fix ... |
| MX-5570 | `feature/MX-5570-surrenders-report` | darcknico | 2026-04-06 | fix(MX-5570): replace fa icons with mdi equivalents in surrenders-r... |
| MX-5438 | `feature/MX-5438-reports-daily` | repo.magiis | 2026-03-28 | feat(MX-5438): migrate reports-daily page to Angular 18 |
| MX-5440 | `feature/MX-5440-reports-documentation` | repo.magiis | 2026-03-28 | feat(MX-5440): migrate reports-documentation page to Angular 18 |

## Integrations (9 branches)

| MX | branch | autor | fecha | titulo |
| --- | --- | --- | --- | --- |
| MX-5717 | `feature/MX-5717-integrations-ivr` | repo.magiis | 2026-05-07 | feat(MX-5717): implement IvrIntegrationComponent |
| MX-5694 | `feature/MX-5694-integrations-whatsapp-business` | repo.magiis | 2026-05-06 | feat(MX-5694): implement WhatsappBusinessIntegrationComponent |
| MX-5670 | `feature/MX-5670-integrations-csv` | repo.magiis | 2026-05-05 | feat(MX-5670): implement ViewIntegrationComponent (Logs de aplicaci... |
| MX-5678 | `feature/MX-5678-integrations-mailchimp` | Cristian | 2026-04-17 | feat(integrations-mailchimp): complete migration to Angular 18 [MX-... |
| MX-5677 | `feature/MX-5677-integrations-signal` | Cristian | 2026-04-17 | feat(integrations-signal): complete migration to Angular 18 [MX-5677] |
| MX-5676 | `feature/MX-5676-integrations-whatsapp` | Cristian | 2026-04-17 | feat(integrations-whatsapp): complete migration to Angular 18 [MX-5... |
| MX-5675 | `feature/MX-5675-integrations-social-media` | Cristian | 2026-04-17 | feat(integrations-social-media): complete migration to Angular 18 [... |
| MX-5671 | `feature/MX-5671-integrations-plugin-web-reservation` | Cristian | 2026-04-17 | feat(integrations-plugin-web-reservation): complete migration to An... |
| MX-5597 | `feature/MX-5597-global-integrations` | darcknico | 2026-04-15 | feat(MX-5597): implement global-integrations marketplace page |

## Settings (9 branches)

| MX | branch | autor | fecha | titulo |
| --- | --- | --- | --- | --- |
| MX-5630 | `feature/MX-5630-settings-travel-fare-rules` | darcknico | 2026-04-23 | feat(MX-5630): segunda revision |
| MX-5610 | `feature/MX-5610-settings-parameters` | SanaLaMente | 2026-04-21 | fix(MX-5610): remove 13 phantom UI blocks inherited from v1 HTML co... |
| MX-5614 | `feature/MX-5614-zones` | darcknico | 2026-04-21 | feat(MX-5614): migrate zones configuration page |
| MX-5628 | `feature/MX-5628-travel-fare-list` | repo.magiis | 2026-04-21 | feat(MX-5628): migrate travel-fare-list to Angular 18 |
| MX-5620 | `feature/MX-5620-settings-profiles` | SanaLaMente | 2026-04-16 | fix(MX-5620): fix modal button disabled state and table column widths |
| MX-5611 | `feature/MX-5611-settings-services-type` | Cristian | 2026-04-16 | fix(settings-services-type): fix 3 confirmed test failures [MX-5611] |
| MX-5615 | `feature/MX-5615-settings-preferences` | repo.magiis | 2026-04-09 | feat(MX-5615): implement settings-preferences page migration |
| MX-5633 | `feature/MX-5633-settings-profiles-access` | repo.magiis | 2026-04-09 | fix(MX-5633): fix 5 known issues in settings-profiles-access |
| MX-5575 | `feature/MX-5575-settings-other-costs` | darcknico | 2026-04-08 | feat(MX-5575): migrate other costs page to Angular 18 |

## Infrastructure ( branches)

| MX | branch | autor | fecha | titulo |
| --- | --- | --- | --- | --- |
| MX-5631 | `feature/MX-5631-travel-mapper` | repo.magiis | 2026-04-20 | fix(MX-5631): replace per-tab click handlers with ngbNav navChange ... |

## Other (49 branches)

| MX | branch | autor | fecha | titulo |
| --- | --- | --- | --- | --- |
| MX-5715 | `feature/MX-5715` | Jorge Rankov | 2026-05-18 | MX-5715 Fallback metaApp en envs preprod/uat/prod |
| MX-5732 | `feature/MX-5732` | Jorge Rankov | 2026-05-17 | MX-5732 Sprint 8 FE: overview cards + top-routes + consent history ... |
| MX-5735 | `feature/MX-5735` | SanaLaMente | 2026-05-12 | refactor: remove unused LabelAddClient import and method from Multi... |
| MX-5712 | `feature/MX-5712` | Erno | 2026-05-11 | feat(channels): add Channels section to carrier sidebar |
| MX-5713 | `feature/MX-5713` | SanaLaMente | 2026-05-06 | Actualizar versiÃ³n a 2.0.3 en package.json y footer; mejorar tÃ­tu... |
| MX-5608 | `feature/MX-5608-affiliate-os-agreement-received` | SanaLaMente | 2026-04-21 | fix(MX-5608): add search label below input to align with select cap... |
| MX-5626 | `feature/MX-5626-affiliate-os-agreement-requested` | SanaLaMente | 2026-04-20 | feat(MX-5626): apply V2 Table Standard to affiliate-os-agreement-re... |
| MX-5619 | `feature/MX-5619-areas` | darcknico | 2026-04-20 | feat(MX-5619): migrate areas settings page to Angular 18 |
| MX-5679 | `feature/MX-5679-travel-dashboard` | SanaLaMente | 2026-04-20 | fix(MX-5679): column visibility on tab 0 + add missing row icons |
| MX-5622 | `feature/MX-5622-travel-create` | SanaLaMente | 2026-04-17 | feat(travel-create): implement progressive disclosure for vehicle s... |
| MX-5621 | `feature/MX-5621-melita-ai-branches` | darcknico | 2026-04-17 | feat(MX-5621): implement melita-ai-branches page migration |
| MX-5607 | `feature/MX-5607-affiliate-request` | Cristian | 2026-04-16 | fix(affiliate-request): use [ngValue]=null for filter dropdowns [MX... |
| MX-5613 | `feature/MX-5613-branches` | darcknico | 2026-04-15 | feat(MX-5613): migrate branches (Sucursales) page to Angular 18 |
| MX-5595 | `feature/MX-5595-email-templates` | darcknico | 2026-04-14 | feat(MX-5595): migrate email-templates page (PersonalizaciÃ³n de e-... |
| MX-5594 | `feature/MX-5594-affiliate-offering` | darcknico | 2026-04-14 | feat(MX-5594): implement affiliate-offering page migration |
| MX-5531 | `feature/MX-5531-travel-unpaid-list` | repo.magiis | 2026-04-13 | Merge branch 'feature/MX-5531-travel-unpaid-list' of gitlab.com:rep... |
| MX-5564 | `feature/MX-5564-pay-travels` | darcknico | 2026-04-13 | feat(MX-5564): add print_surrender_driver PDF and Lato font loading |
| MX-5609 | `feature/MX-5609-gnet-farm-out` | repo.magiis | 2026-04-10 | feat(MX-5609): implement gnet-farm-out page migration |
| MX-5529 | `feature/MX-5529-travel-list` | darcknico | 2026-04-09 | feat(MX-5529) |
| MX-5553 | `feature/MX-5553-segment-travels` | darcknico | 2026-04-08 | feat(MX-5553): migrate segment-travels report to Angular 18 |
| MX-5600 | `feature/MX-5600-dashboard` | repo.magiis | 2026-04-08 | feat(MX-5600): implement Operations Control dashboard (carrier dash... |
| MX-5559 | `feature/MX-5559-map-viewer` | darcknico | 2026-04-07 | feat(MX-5559): implement map-viewer page with Leaflet + Firebase RTDB |
| MX-5573 | `feature/MX-5573-gnet-farm-in` | darcknico | 2026-04-07 | feat(MX-5573): migrate farm-in page to Angular 18 |
| MX-5572 | `feature/MX-5572-travel-quotes` | darcknico | 2026-04-06 | feat: add refresh button below table in quotes-list |
| MX-5537 | `feature/MX-5537-travel-recurring` | repo.magiis | 2026-04-01 | commit recurring web |
| MX-5552 | `feature/MX-5552-travel-list` | darcknico | 2026-03-27 | fix(MX-5552): Fix travel-list open issues (permission check, i18n, ... |
| MX-5533 | `feature/MX-5533-atc-profile` | sanalamente | 2026-03-24 | fix(MX-5533): fix status toggle checkbox revert and warranty check ... |
| MX-5497 | `feature/MX-5497` | sanalamente | 2026-03-20 | feat(identity-service): extract permissions from JWT user_access cl... |
| MX-5641 | `feature/MX-5641-travel-detail` | Aldo martinez | 2026-03-18 | Merge branch 'test' into 'release/v2.0.1' |
| MX-5195 | `feature/MX-5195` | Omegatroy | 2026-02-10 | MX-5195 Se arreglo las traducciones en la tabla de cliente/contract... |
| MX-5390 | `feature/MX-5390` | sanalamente | 2026-02-09 | feat(pagination): implement reusable table pagination component and... |
| MX-5389 | `feature/MX-5389` | sanalamente | 2026-02-02 | feat: add column resizing functionality to driver and vehicle lists |
| MX-5427 | `feature/MX-5427` | sanalamente | 2026-02-02 | feat: add column resizing functionality to driver and vehicle lists |
| MX-5156 | `feature/MX-5156` | darcknico | 2026-01-15 | MX-5156 CRUD DRIVER - labels faltantes |
| MX-5337 | `feature/MX-5337` | sanalamente | 2026-01-08 | feat(vehicle-report): add VehicleReportService for generating PDF r... |
| MX-5165 | `feature/MX-5165` | Luis Orellano | 2025-11-10 | fix import checking-account-detail |
| MX-5170 | `feature/MX-5170` | Luis Orellano | 2025-10-22 | Merge branch 'feature/MX-5164' into release/v2.0.0 |
| MX-5164 | `feature/MX-5164` | Luis Orellano | 2025-10-22 | MX-5164 migrada pantalla de cuentas corrientes de clientes |
| MX-5157 | `feature/MX-5157` | Luis Orellano | 2025-10-21 | MX-5157 fix hardcode migrated |
| MX-5135 | `feature/MX-5135` | darcknico | 2025-10-16 | MX-5135 FRONT - Migrar Perfiles de Acceso con nueva estructura |
| MX-5113 | `feature/MX-5113_MX-5105` | Luis Orellano | 2025-10-07 | MX-5113 agregado nuevo icon para dropdown melita |
| MX-5113 | `feature/MX-5113` | Luis Orellano | 2025-10-02 | MX-5113 agregado filter de chat y notif en sidebar, y mycompnay con... |
| MX-5105 | `feature/MX-5105` | darcknico | 2025-09-30 | MX-5105 Funcionalidades de I10N y I18n para el translate y moneda -... |
| MX-5100 | `feature/MX-5100` | Luis Orellano | 2025-09-30 | MX-5100 migrado chat, servicios y nuevo look and feel |
| MX-5049 | `feature/MX-5049` | Luis Orellano | 2025-09-24 | MX-5049 filtro de localstorage para angular 5 por carrier |
| MX-4821 | `feature/MX-4821_update` | Luis Orellano | 2025-09-08 | MX-4821- avances alta de viaje y ajustes de proyecto y menu |
| MX-4888 | `feature/MX-4888` | darcknico | 2025-08-28 | MX-4888 demas listados |
| MX-4470 | `feature/MX-4470` | darcknico | 2025-06-19 | MX-4470 arreglado key de session faltante |
| MX-4821 | `feature/MX-4821` | Luis Orellano | 2025-06-17 | cambio base url |


