# Inventario MX-4820 — pantallas migradas Angular 8 -> 18

> Fuente: filtro Jira https://magiis.atlassian.net/browse/MX-4820 (tickets con estado finalizado).
> Actualización: **pendiente de extracción vía MCP de Atlassian post-reinicio**.

## Schema esperado por fila

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `key` | string | Key Jira (ej. MX-XXXX) |
| `summary` | string | Título del ticket |
| `module` | string | Sub-área del carrier portal |
| `screen_name` | string | Nombre canónico de la pantalla |
| `route_v1` | string | Path Angular 8 (`/carrier/legacy/...`) |
| `route_v2` | string | Path Angular 18 (`/carrier/v2/...`) |
| `complexity` | enum | `low` \| `medium` \| `high` |
| `priority` | enum | `P1` \| `P2` \| `P3` |
| `status` | string | Estado Jira (esperado: Done / Cerrado) |
| `manual_validated` | boolean | Marcado en QA manual |
| `assignee` | string | Responsable del ticket |
| `risk_notes` | string | Notas de riesgo para regresión |

## Tabla (placeholder)

| Key | Summary | Module | Screen | Route V1 | Route V2 | Complexity | Priority | Risk |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| _pending MCP Atlassian_ | | | | | | | | |

## Plan de extracción

Post-reinicio de Claude Code:

```text
JQL aproximado para el filtro:
  project = MX
  AND status in (Done, Closed, "Finalizado")
  AND <criterios del filtro MX-4820>
  ORDER BY priority DESC
```

1. Llamar herramienta MCP Atlassian (jira search/JQL) con el JQL exacto del filtro.
2. Para cada ticket extraer: key, summary, módulo (de etiquetas o componente), descripción.
3. Parsear de descripción / comentarios: ruta V1, ruta V2, complejidad declarada.
4. Marcar `manual_validated = true` cuando exista evidencia de QA manual aprobada.
5. Cruzar con la estimación previa `Estimacion_QA_25pantallas.xlsx` (en escritorio) si aplica.
6. Persistir resultado en este archivo + JSON normalizado en `docs/inventory/inventory.json`.
