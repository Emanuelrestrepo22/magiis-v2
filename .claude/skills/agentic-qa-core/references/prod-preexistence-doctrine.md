# Doctrina de preexistencia en PROD — clasificar un hallazgo antes de entregarlo

> **Doctrina canónica y compartida.** Fuente única de verdad para decidir si un
> hallazgo encontrado al ejecutar los casos de un ticket en TEST o UAT **ya
> ocurre en PRODUCCIÓN** o **lo introdujo el ticket/la versión**, y qué
> consecuencia tiene cada respuesta. Citada por `sprint-testing`,
> `regression-testing` y `test-documentation`; regla dura en `CLAUDE.md` §1 #19
> y §8 #10. No dupliques su contenido en un skill — citala.
>
> **Fuente:** decisión del QA lead, 2026-10-30. Las decisiones operativas
> marcadas como «decisión vigente, sujeta a confirmación del Team Lead» se
> adoptaron como default el mismo día y siguen en vigor hasta que el Team Lead
> las confirme o las cambie.

---

## Part 0 — Qué gobierna y qué no

Esta doctrina gobierna **el gate de entrega** de un hallazgo: nada sale hacia el
equipo (comentario del Test o del ATR, comentario en la Historia, aviso al Dev,
veredicto QA, GO/NO-GO) sin un **veredicto de preexistencia en PROD**.

No gobierna el **tipo de issue** (Bug / Defecto / Improvement): eso sigue siendo
`defect-management-doctrine.md` Part 1. Lo que hace esta doctrina es darle a esa
clasificación su **prueba empírica**: lo que decide Bug vs Defecto es si el
**comportamiento fallido** ya ocurre en PROD, no si la feature «está viva».

Tampoco gobierna cómo se deriva la cobertura (`test-design-doctrine.md`) ni la
evidencia mínima de cualquier veredicto (el gate evidence-before-verdict de
`CLAUDE.md` §8 #7, canon en `evidence-conventions.md`). Esta doctrina **extiende**
ese gate para los FAILED de hallazgos relacionados con el ticket: FAILED =
evidencia + bloque de preexistencia.

### Vocabulario canónico (un solo vocabulario en todos los archivos)

| Token | Definición operativa | Tipo de issue (defect-management Part 1) | Gate del ticket |
|---|---|---|---|
| `PREEXISTENTE` | El mismo comportamiento se observa o se demuestra hoy en PROD, con la versión desplegada allí | **Bug** (escapó) | No bloquea por sí mismo; decide el Team Lead (a)/(b); impacto en PROD analizado |
| `INTRODUCIDO` | No ocurre en PROD: la feature no existe allí, o la causa raíz está en el diff del ticket/versión, o el mismo flujo de lectura en PROD da el resultado esperado | **Defecto** (contenido) | **Bloquea** el pase a la siguiente instancia; vuelve al Dev |
| `INDETERMINADO` | No se pudo cerrar sin escribir en PROD y no hay señal concluyente en código, datos ni histórico; o PROD inaccesible; o versiones no identificables | Defecto **provisional** | Sin aprobación QA hasta la decisión TL + Dev; sin decisión al corte → se trata como `INTRODUCIDO` (Part 5) |

Reglas de vocabulario:

1. Los tres tokens van **en mayúsculas y sin traducir** en todos los archivos,
   incluidos los archivos en inglés y los JSON de los briefings
   (`"prod_preexistence": "PREEXISTENTE|INTRODUCIDO|INDETERMINADO"`).
2. Nunca usar «regresión» como sinónimo de `INTRODUCIDO` en el bloque: la
   palabra ya tiene dueño en `regression-testing` (clase `REGRESSION`), que es
   ortogonal a este veredicto (Part 8).
3. Nunca crear tokens paralelos en inglés en mayúsculas. La prosa inglesa puede
   decir "pre-existing in PROD"; el token es siempre uno de los tres de arriba.

---

## Part 1 — Disparador

**Dispara** cuando se cumplen **todas** las condiciones:

1. Se está ejecutando un Test del ATR del ticket: `sprint-testing` Stage 2,
   smoke/regresión UAT reciclados del mismo ATR, o un run de
   `regression-testing` cuya ATC cubre la historia.
2. Hay una desviación contra un AC **explícito o implícito** (Q1 de
   `defect-management-doctrine.md` Part 1 = sí). Un Improvement (Q1 = no) no
   dispara; puede informar preexistencia como dato, sin consecuencias de gate.
3. Es reproducible con **acciones reales de pantalla** (+ verificación en DB),
   no con un request armado, un body editado a mano ni DevTools. Un «caso
   armado» se registra como riesgo técnico o contrato a automatizar, no como
   hallazgo del flujo.
4. Está **relacionado con el ticket**: superficie o ACs del ticket, **o** su
   superficie de regresión (módulos que el ticket toca según su diff).

**Hallazgos cross-story** (decisión vigente, sujeta a confirmación del Team
Lead): un hallazgo en otra feature, encontrado mientras se prueba este ticket,
**también** pasa por la verificación — es lo que decide Bug vs Defecto — pero
**no gatea el ticket bajo prueba** salvo que viaje en la misma versión. Ese gate
es de release y lo lleva `regression-testing`.

**No dispara** (se clasifica y se registra, sin bloque de preexistencia):

| Clase | Ejemplos | Registro |
|---|---|---|
| Ambiente | ambiente caído, 5xx generalizados, timeouts, reportes que solo existen en TEST | Run anotado como ambiental; `ENVIRONMENT` en regresión |
| Flaky | pasa al re-ejecutar aislado sin cambio de build | `FLAKY` |
| Dato | fixture inexistente, carrier sin tarifador, dato destructivo ya consumido | «N/E — dato no disponible», con captura |
| Diseño del caso | esperado mal escrito, AC mal leído, caso que la UI no permite armar | Corregir el Test; no abrir hallazgo |
| Ticket Bug en retest | el bug objeto del ticket no está corregido: es el ticket, no un hallazgo nuevo | Plantilla de Bug NOT FIXED; los hallazgos **laterales** del retest sí disparan |

**Momento.** El bloque se publica **junto con el FAILED del run**. Si la
verificación no cierra en la sesión, se publica `INDETERMINADO` con lo
intentado: no existe un estado «pendiente» sin publicar.

**Coherencia con «el ambiente sigue el estado del ticket».** La verificación en
PROD **no es una ejecución de prueba en PROD**: es una consulta de referencia de
solo lectura. No cambia el ambiente del ticket, no acredita casos y toda
evidencia obtenida allí se rotula «PROD (lectura)».

---

## Part 2 — Árbol de decisión

```
Desviación observada ejecutando un Test del ATR del ticket (TEST | UAT)
  |
  +-- ¿Ambiente / flaky / dato / diseño del caso?  --SI--> clasificar (ambiental, FLAKY, N/E, corregir Test). FIN, sin bloque.
  |
  +-- ¿Reproducible solo con acciones reales de UI (+DB)?  --NO--> riesgo técnico / contrato automatizado. FIN, sin bloque.
  |
  +-- ¿Viola un AC explícito o implícito?  --NO--> Improvement (preexistencia opcional, informativa). FIN.
  |
  v
HALLAZGO (H-<KEY>-NN). Abrir «Verificación de preexistencia en PROD» (timebox, Part 3)
  |
  1. Fijar versiones: TEST|UAT (FE / BE / app) y PROD (FE / BE / app), con su fuente.
  2. ¿La funcionalidad existe en PROD?  --NO (feature nueva, no desplegada)--> INTRODUCIDO (nada que comparar). -> 5
  3. Métodos sin escritura, en orden (parar cuando el veredicto cierra):
       M1 código: ¿la lógica causante es idéntica en PROD (main/tag) y en develop/release?
       M2 datos PROD (réplica de lectura): ¿hay registros con la firma/síntoma persistido?
       M3 UI PROD de solo consulta / M4 API GET PROD: ¿mismo paso, mismo resultado?
       M5 histórico: Jira/Xray/baselines que ya registren el comportamiento en PROD.
  4. Veredicto (Part 4):
       PREEXISTENTE   = >=1 método con evidencia directa en PROD (M2/M3/M4/M5), o M1 idéntico + M2 precondición.
       INTRODUCIDO    = la causa está en el diff ticket/versión (M1), o PROD da el resultado esperado (M3/M4), o paso 2 = NO.
       INDETERMINADO  = nada de lo anterior cierra, o PROD inaccesible, o versiones no identificables.
  5. Publicar: FAILED en el run + bloque + evidencia lado a lado (run Xray + comentario del Test; copia en la Historia).
  6. Consecuencia (Part 5):
       PREEXISTENTE  -> aclarar al equipo; el Team Lead decide (a) fix en el ticket | (b) Bug como deuda técnica. El ticket puede avanzar.
       INTRODUCIDO   -> bloquea el pase; comentario + aviso al Dev; estado: genérico `defect_reported`, MG lo mueve el Dev/TL; re-test tras el fix.
       INDETERMINADO -> escalar TL + Dev con lo intentado; sin aprobación QA hasta la decisión; sin decisión al corte: bloquea.
```

---

## Part 3 — Métodos de verificación sin escritura

PROD es **solo lectura** durante esta verificación. Los métodos van en orden de
preferencia; se para en cuanto el veredicto cierra.

| # | Método | Qué responde | Herramienta / recurso | Evidencia que deja | Limitaciones y cuidados |
|---|---|---|---|---|---|
| M1 | **Comparación de código** PROD vs rama del ticket | ¿La causa raíz existe en la versión desplegada en PROD? ¿El ticket/versión la introduce? | Repositorio en solo lectura (compare de refs, lectura de archivo, releases, blame). Refs: `main`/tag de PROD vs `develop`/`release/vX` | SHAs de ambos refs, `archivo:línea` en cada ref, enlace al compare, hunks relevantes (o «sin hunks sobre las piezas») | Determina la causa, no siempre la manifestación. Identificar el tag/release de PROD **antes** de comparar |
| M2 | **Datos de PROD en la réplica de lectura** | ¿Hay registros históricos con la firma del defecto? ¿Con qué frecuencia? | `[DB_TOOL]` sobre `{{environments.production.db_mcp}}`; comprobar la autenticación antes de consultar; **solo SELECT** | SQL ejecutado + filas/cifras devueltas + ventana temporal; sin PII ni ids de personas | Retención limitada de algunas tablas de log, timeouts (partir la consulta por tramos); lo no persistido no es observable |
| M3 | **UI de PROD sin mutar** | ¿El mismo paso de consulta muestra el mismo comportamiento? | Cuenta de QA ya usada en el smoke de PROD; pantallas de lectura; `[AUTOMATION_TOOL]` solo para navegar y capturar | Captura con URL + timestamp, misma pantalla y mismo paso que en TEST\|UAT | **Un login puede escribir filas** (en Carrier V1 el login actualiza datos de sesión/auditoría): declararlo; preferir V2 o una cuenta ya usada en el smoke de PROD. Nunca alta, edición, cancelación ni pagos |
| M4 | **API GET de PROD** | ¿El contrato/respuesta de lectura reproduce la desviación? | `[API_TOOL]` con un GET (curl) y token de PROD **solo si el usuario lo autoriza en chat**; nunca POST/PUT/DELETE | Request (sin token) + status + campos relevantes de la respuesta | Un GET puede quedar auditado; no usar endpoints que el código declare con side-effects |
| M5 | **Histórico** | ¿El comportamiento ya está registrado en PROD? | Jira/Xray (comentarios, Tests FAILED previos), baselines bajo `docs/qa/`, smoke de PROD post-pase | Enlace o ruta + cita textual | Solo vale si registra la **misma** versión y el **mismo** comportamiento; si es anterior a un fix intermedio, no alcanza |

### Identificación de versiones (paso 1, obligatorio)

- **BE**: endpoint público `serverInfo` en PROD y en TEST/UAT.
- **FE**: `package.json` o tag del ref desplegado.
- **App móvil**: versión instalada en el dispositivo de prueba + releases/`main`
  del repositorio móvil. La versión real publicada en las tiendas no es
  verificable desde el repositorio: **declararlo**.

Cada versión va con su fuente en la línea «Versiones» del bloque (Part 7).

### Acceso a PROD — `{{environments.production.*}}`

El canon referencia el acceso de lectura a PROD por variable de proyecto
(`{{environments.production.web_url}}`, `{{environments.production.db_mcp}}`,
`{{environments.production.api_mcp}}` en `.agents/project.yaml`). **Si esas
variables están en `null`** (la plantilla se distribuye así y queda congelada
por proyecto), usar la configuración local del proyecto — `.env` y el conector
de lectura de PROD configurado en la sesión — y **nunca hardcodear** URLs, ids
de conectores ni usuarios de base en un skill, un comentario o un commit
(decisión vigente, sujeta a confirmación del Team Lead).

### Reglas PROD (binding)

1. **Solo lectura**: compare de código · SELECT en la réplica · UI de consulta ·
   API GET · histórico. Nunca crear, modificar ni borrar datos de PROD.
2. Sin fixtures ni datos nuevos en PROD; sin pagos ni gateway.
3. Ningún caso ejecutado en TEST/UAT se acredita con datos de PROD.
4. Toda evidencia obtenida en PROD se rotula «PROD (lectura)».
5. Credenciales siempre desde `.env`; nunca en el comentario, el bloque ni la
   evidencia adjunta.

### Timebox y modo agéntico

**Timebox: ≤ 60 min por hallazgo para M1 + M2** (parámetro propuesto, no regla
del QA lead). Si se agota sin cierre → `INDETERMINADO` con lo intentado.

M1, M2 y M5 los puede hacer un agente de análisis sin escrituras y sin frenar la
pasada. M3 y M4 requieren confirmación del usuario cuando implican login o token
de PROD.

---

## Part 4 — Veredicto de tres estados y confianza

| Estado | Criterio mínimo | Confianza a declarar |
|---|---|---|
| `PREEXISTENTE` | Evidencia directa en PROD del mismo comportamiento (M2 síntoma persistido · M3/M4 mismo paso → mismo resultado · M5 registro válido para la versión) **o** M1 código idéntico + M2 precondición presente | **alta** = evidencia directa; **media** = código idéntico + precondición, sin manifestación observable. Confianza baja **no** es `PREEXISTENTE` → `INDETERMINADO` |
| `INTRODUCIDO` | La causa raíz está en commits del ticket/versión que no están en PROD (M1 con SHAs) **o** la feature no existe en PROD **o** el mismo flujo de lectura en PROD da el resultado esperado | **alta** = diff + mecanismo explicado; **media** = PROD correcto pero causa no ubicada en el diff |
| `INDETERMINADO` | Lo anterior no cierra dentro del timebox; o PROD inaccesible (conector, VPN, permiso); o versiones no identificables | Siempre con «se intentó X (ref/consulta) y no alcanza porque Y» y **qué puede verificar el Dev/TL** (logs, base en tiempo real, reproducción controlada) |

Siempre se declaran también:

- la **clasificación** derivada (Bug / Defecto / Defecto provisional), y
- el **impacto en PROD** cuando es `PREEXISTENTE` (frecuencia, usuarios
  afectados, dinero) — el QA lead exige analizar el impacto en la salida a PROD
  aunque el hallazgo no bloquee.

**Caso límite que esta doctrina resuelve:** un ticket que **modifica una feature
viva** e introduce una falla. La feature es vieja, pero la falla es nueva →
`INTRODUCIDO` → Defecto bloqueante, **no** Bug.

---

## Part 5 — Consecuencias por estado

| Dimensión | `PREEXISTENTE` | `INTRODUCIDO` | `INDETERMINADO` |
|---|---|---|---|
| Run Xray del Test | `FAILED` + comentario con bloque + evidencia TEST\|UAT y PROD adjuntas | `FAILED` + bloque + evidencia | `FAILED` + bloque + evidencia de lo intentado |
| Resumen del ATR | Contar aparte: «FAILED preexistentes (no bloquean)» | «FAILED introducidos (bloquean)» | «FAILED indeterminados (escalados)» |
| Comentario en el Test | Sí | Sí | Sí |
| Comentario en el Test Plan de la campaña | Sí (visibilidad GO/NO-GO) | Sí | Sí |
| Comentario en la Historia (canal de entrega) | **Sí** | **Sí** + mención al Dev | **Sí** + mención TL y Dev |
| Tipo de issue (defect-management Part 1) | Bug | Defecto | Defecto provisional |
| Creación de issue | Solo si el TL elige (b). Genérico: `Bug` parentado al QA Defect epic + link `causes`. MG: ver Part 9 | MG: **no se crea** issue nuevo, el ticket mismo vuelve al Dev (Part 9). Genérico: `Defect` + transición `defect_reported → blocked` + link `blocks` | No se crea hasta la decisión |
| Transición del ticket | Veredicto QA: «APROBADO con hallazgo preexistente — decisión TL pendiente/registrada» (GO condicionado) | Veredicto QA: NO APROBADO. Genérico: `defect_reported`. MG: comentario + aviso; el Dev/TL mueve el estado | Sin aprobación QA; escalado TL + Dev |
| A quién se escala | Team Lead (decisión a/b) | Dev del ticket + Team Lead (aviso) | Team Lead + Dev (la verificación que QA no puede hacer) |
| GO/NO-GO de la historia | No veta; condición = decisión del TL registrada | **NO-GO** hasta fix + re-test | Condicionado hasta la decisión; NO-GO al corte si no se resuelve |
| Re-test tras el fix | Si (a): re-ejecutar el Test; la preexistencia queda registrada, no se repite | Re-ejecutar el Test; no hace falta repetir la verificación | Según la decisión |
| Stage 4 (`test-documentation`) | Si termina en Bug (b): entra por el scope **bug-driven** → Test de regresión persistente | El Test del ATR ya cubre el caso; se promueve si es regression-worthy | — |

**`INDETERMINADO` al corte** (decisión vigente, sujeta a confirmación del Team
Lead): el escalado TL + Dev es obligatorio; si no hay decisión antes del corte
de release, el hallazgo se trata como `INTRODUCIDO` y **bloquea**.

**Dos «bloqueos» distintos — no confundirlos:**

- *Bloqueo de pasada* (smoke o ambiente caído, corrupción de datos, seguridad)
  → se detiene la ejecución.
- *Bloqueo de ticket* (`INTRODUCIDO`) → el ticket no avanza, pero **la pasada
  continúa**: se terminan los Tests restantes y se publica todo junto.

---

## Part 6 — Evidencia mínima (lado a lado)

Un bloque de preexistencia sin evidencia no es un veredicto: es una opinión. El
mínimo es:

1. **Versiones** de ambos ambientes, con la fuente de cada una (Part 3).
2. **Evidencia lado a lado del mismo paso/dato**: la captura o medición de
   TEST\|UAT (`{KEY}-bug-{short-desc}.png`, Family 1 de `evidence-conventions.md`
   §2) y su contraparte de PROD (`{KEY}-preexist-prod-{mN}-{short-desc}.{ext}`,
   Family 3 del mismo archivo):
   - `.md` para mediciones de código (M1) o de base (M2), con SQL/refs y
     resultados;
   - `.png` para UI (M3);
   - `.txt` / `.har` para API (M4), sin tokens.
3. **Método(s) usados y confianza** (Part 4).
4. **Adjunto al run Xray** del Test — no solo en la carpeta `evidence/`, que
   está en `.gitignore` y nadie que lea el ATR puede ver. Es el mismo principio
   del gate evidence-before-verdict (`CLAUDE.md` §8 #7), aplicado a la
   contraparte de PROD.

Una verificación no visual (código, base) **igual** produce un artefacto: la
medición escrita. «No había nada que capturar» nunca es motivo para publicar un
estado sin evidencia.

---

## Part 7 — Plantillas

### 7.1 Bloque Jira «Verificación de preexistencia en PROD»

Va en el run del ATR, en el Test, en el Test Plan y en la Historia. Encabezado
fijo — sirve de marcador para deduplicar y para auditar consistencia:
`Verificación de preexistencia en PROD · <fecha> · <ESTADO>`.

```
Verificación de preexistencia en PROD · 2026-10-30 · PREEXISTENTE
Hallazgo: H-MG-1234-01 — <una línea: qué pasa y en qué paso>
Trazabilidad: ticket MG-1234 · Test TM-1456 · ATR TM-1450 · AC-3
Versiones: TEST FE 2.0.21 / BE 1.72.21 / app 2.6.17 (serverInfo, package.json) — PROD FE 2.0.20 / BE 1.72.20 / app 2.6.14 (serverInfo, tag main, release)
Método(s): M1 código (main@<sha> vs develop@<sha>, <archivo> L835–870 idéntico) · M2 DB PROD (lectura): <SQL resumido> → 363/684 filas (30 días)
Resultado en PROD: <qué se observó/consultó y qué devolvió, con cifras>
Resultado en TEST|UAT: <mismo paso/dato, qué devolvió>
Confianza: media — código idéntico + precondición en datos; manifestación en pantalla no observable desde logs
Clasificación: Bug (comportamiento ya en PROD; doctrina defect-management Part 1)
Impacto en PROD: <frecuencia / usuarios / dinero>
Consecuencia: no bloquea por sí mismo. Decisión del Team Lead: (a) corregir dentro de MG-1234 · (b) Bug como deuda técnica para otra versión. Sin decisión registrada el ticket queda «APROBADO con hallazgo preexistente».
Evidencia: MG-1234-bug-<x>.png (TEST) · MG-1234-preexist-prod-m2-<x>.md (PROD, lectura) — adjuntas al run TM-1456
```

Variantes de la línea **Consecuencia**:

- `INTRODUCIDO`: «Bloquea el pase a la siguiente instancia. Vuelve al Dev
  <nombre> para corrección; QA re-ejecuta el Test tras el fix. QA no transiciona
  el ticket; se solicita moverlo a «Tareas por hacer».»
- `INDETERMINADO`: «No verificable en PROD sin escribir. Se intentó <M1/M2/…:
  ref/consulta> y no alcanza porque <motivo>. Pendiente de <Dev/TL>: <qué puede
  verificar (logs, base en tiempo real, reproducción controlada)>. El ticket no
  se da por aprobado hasta esa decisión.»

Reglas del bloque:

- Español con tildes; encabezado exacto; un bloque por hallazgo.
- Sin credenciales ni tokens; sin ids de personas.
- Publicar en UTF-8 y re-leer el comentario para confirmar que no quedó doble
  codificación (`Ã`, `Â`).
- Si el run ya tiene comentario, **componer** (el comentario del run se
  reemplaza, no es un hilo): no pisar la evidencia ya publicada.

### 7.2 Sección del bug report

```
## Preexistencia en PROD
- Estado: PREEXISTENTE | INTRODUCIDO | INDETERMINADO
- Versiones comparadas: TEST|UAT <FE/BE/app> vs PROD <FE/BE/app> (fuentes)
- Método(s) y resultado en PROD: …
- Confianza y límites: …
- Impacto en PROD (si PREEXISTENTE): …
- Decisión del Team Lead: (a) | (b) | pendiente — fecha / quién
- Detalle: <ruta del análisis, p. ej. docs/qa/…/preexistencia-prod-<slug>-<fecha>.md>
```

Va entre `## Root Cause` y `## Workaround` del reporte. Es la misma forma que ya
usa el precedente `docs/qa/automation-stock/fr-1901/DEFECT-driver-app-oferta-vieja-2026-10-20.md`
(sección «Preexistencia en PROD»): el precedente se vuelve plantilla.

### 7.3 Líneas para el ATR y el footer de sesión

- **ATR (resumen)**:
  `FAILED: N — preexistentes P (no bloquean; decisión TL …) · introducidos I (bloquean; Dev …) · indeterminados U (escalados a …)`.
- **Session footer** (`session-footer-contract.md` Part 2, «Testing levels touched»):
  `- PROD (read-only verification) — M1 code compare main↔develop, M2 2 SELECT on PROD replica; no writes`.
  Sin hallazgos: `- PROD (read-only verification) — none (no findings)`.

### 7.4 Campos JSON para briefings (Stage 2/3 y clasificación de regresión)

```
"prod_preexistence": "PREEXISTENTE|INTRODUCIDO|INDETERMINADO",
"preexistence_methods": ["M1","M2"],
"preexistence_confidence": "alta|media|baja",
"versions": { "test_or_uat": { "fe": "...", "be": "...", "app": "..." }, "prod": { "fe": "...", "be": "...", "app": "..." }, "sources": "..." },
"prod_evidence_paths": ["<PBI_FOLDER>/evidence/<KEY>-preexist-prod-m2-<x>.md"],
"escalation": { "to": "team_lead|dev|both", "pending": "<qué falta>" }
```

---

## Part 8 — Impacto en GO/NO-GO

### Nivel historia (`sprint-testing` Stage 3)

El veredicto QA del ticket se deriva del **peor estado abierto**:

| Estados abiertos | Veredicto QA |
|---|---|
| Algún `INTRODUCIDO` | NO APROBADO / FAILED — bloquea |
| Algún `INDETERMINADO` (sin `INTRODUCIDO`) | Condicionado hasta la decisión TL + Dev; NO-GO al corte si no se resuelve |
| Solo `PREEXISTENTE` | APROBADO con hallazgo preexistente (`PASSED WITH ISSUES` / GO condicionado a la decisión TL registrada) |

La auditoría de consistencia previa al GO suma una columna: **cada FAILED citado
tiene su bloque de preexistencia publicado** (en el run y en la Historia).

### Nivel release (`regression-testing`)

Se agrega el **atributo** `prod_preexistence` a toda falla de clase
`REGRESSION` y a toda `NEW TEST` confirmada como defecto real. No es una sexta
categoría: la precedencia de clases de `regression-testing` no cambia.

| Clase · atributo | Impacto release | Acción |
|---|---|---|
| `REGRESSION · INTRODUCIDO` | Veto duro (release blocker) | NO-GO; Defecto; vuelve al Dev |
| `REGRESSION · PREEXISTENTE` | No veta; se lista en «Pre-existing in PROD (n)» con impacto y decisión TL | CAUTION si la severidad es HIGH/CRITICAL; Bug como deuda si el TL elige (b) |
| `REGRESSION · INDETERMINADO` | CAUTION con dueño y fecha | Escalar; NO-GO al corte si sigue abierto |
| `NEW TEST` confirmada | Mismo tratamiento, tras confirmar que es defecto real | — |

---

## Part 9 — Notas de instancia MG (MAGIIS)

Leer junto con `defect-management-mg-instance-map.md`. En MG, QA gestiona solo
entidades Xray; sobre `Historia` / `Error` / `Epic` / `Tarea` solo lee y comenta.

1. **Canal de entrega** (decisión vigente, sujeta a confirmación del Team Lead):
   el bloque se publica como comentario en el **Test**, el **Test Plan** de la
   campaña **y la Historia**, más un aviso al Dev por Teams. Es una excepción
   explícita al «no comentar la Historia» del instance map Part 7: la decisión
   del Team Lead (`PREEXISTENTE` / `INDETERMINADO`) y la devolución al Dev
   (`INTRODUCIDO`) ocurren en la Historia.
2. **QA nunca transiciona ni enlaza** la Historia (`CLAUDE.md` #16). En un
   `INTRODUCIDO`, QA comenta y avisa; el **Dev o el Team Lead** mueve el ticket
   (`TEST → Tareas por hacer`).
3. **Bug de un `PREEXISTENTE` con decisión (b)** (decisión vigente, sujeta a
   confirmación del Team Lead): QA redacta el ticket; el `Error` se crea **solo
   con OK explícito por caso** del TL o del PO (instance map Part 8). La
   decisión (b) del TL **no equivale por sí sola** a autorización de creación.
4. **Acceso a PROD**: ver Part 3 «Acceso a PROD». Los datos concretos del
   conector de lectura y de las cuentas viven en la configuración local
   (`.env`) y en la memoria del proyecto, nunca en el repositorio.

---

## Part 10 — Anti-patrones

```
[x] Entregar un FAILED o un hallazgo sin su veredicto de preexistencia      -> Part 1: el bloque sale con el FAILED
[x] Escribir en PROD (alta, edición, pago, login con side-effects no declarado) para obtener el veredicto -> Part 3: solo lectura
[x] Decidir Bug vs Defecto por suposición («la feature ya está viva»)        -> Part 0 + defect-management Part 1 Q2
[x] Llamar «regresión» a un INTRODUCIDO en el bloque                         -> Part 0: un solo vocabulario
[x] Bloquear el ticket por un PREEXISTENTE sin decisión del Team Lead        -> Part 5: no bloquea por sí mismo
[x] Firmar una Historia con un INTRODUCIDO abierto                           -> Part 8: NO APROBADO
[x] Dejar un INDETERMINADO sin escalar ni registrar lo intentado             -> Part 4: «se intentó X y no alcanza porque Y»
[x] Detener la pasada por un INTRODUCIDO                                     -> Part 5: bloquea el ticket, no la pasada
[x] Transicionar la Historia en MG para «devolverla al Dev»                  -> Part 9: comentario + aviso; mueve el Dev/TL
[x] Evidencia de PROD solo en la carpeta evidence/                           -> Part 6: adjunta al run Xray
[x] Acreditar un caso de TEST/UAT con datos de PROD                          -> Part 3: regla PROD 3
[x] URLs, ids de conectores o credenciales de PROD en el bloque o el repo    -> Part 3: {{environments.production.*}} / .env
```

---

## Part 11 — Gate (checklist)

Correr antes de publicar cualquier FAILED de un hallazgo relacionado con el
ticket y antes de entregar el veredicto. Cada ítem se responde SÍ o N/A
justificado.

```
[ ] TRIGGER     ¿Es un hallazgo real (UI real, viola AC, relacionado con el ticket) y no ambiente/flaky/dato/diseño? (Part 1)
[ ] VERSIONS    ¿Versiones TEST|UAT y PROD fijadas, con su fuente? (Part 3)
[ ] READ-ONLY   ¿Ninguna escritura en PROD; side-effects de login declarados o evitados? (Part 3)
[ ] METHODS     ¿Métodos M1–M5 aplicados en orden, dentro del timebox? (Part 3)
[ ] VERDICT     ¿Estado PREEXISTENTE / INTRODUCIDO / INDETERMINADO con criterio y confianza? (Part 4)
[ ] EVIDENCE    ¿Evidencia lado a lado TEST|UAT vs PROD adjunta al run Xray? (Part 6)
[ ] BLOCK       ¿Bloque «Verificación de preexistencia en PROD» publicado en run + Test + Test Plan + Historia? (Part 7, Part 9)
[ ] CONSEQUENCE ¿Consecuencia aplicada según el estado (no bloquear / bloquear / retener)? (Part 5)
[ ] ESCALATION  ¿Team Lead / Dev avisados según el estado, con lo intentado si es INDETERMINADO? (Part 5)
```

---

## Precedentes

- **`PREEXISTENTE`** —
  `docs/qa/automation-stock/fr-1901/preexistencia-prod-oferta-vieja-2026-10-21.md`:
  código idéntico entre `main` y `develop` + precondición presente en la réplica
  de PROD; confianza alta en el código, media en la manifestación. Es el patrón
  «M1 idéntico + M2 precondición».
- **`INTRODUCIDO`** — UAT-H-1622-01 (logout al abrir una pantalla por un 401 del
  BFF): la causa estaba en commits de la release que no estaban en `main`.
  Análisis fuera del repositorio (memoria del proyecto).

---

## Snippet para briefings (componente 7 — Rules)

> **PROD pre-existence (mandatory, canon `agentic-qa-core/references/prod-preexistence-doctrine.md`):**
> for every confirmed ticket-related finding (real UI actions, violates an
> explicit/implied AC, observed while executing the ATR in TEST or UAT) return
> `prod_preexistence` = `PREEXISTENTE` | `INTRODUCIDO` | `INDETERMINADO` with
> `preexistence_methods`, `preexistence_confidence`, `versions` (both
> environments, with sources) and `prod_evidence_paths` (Family 3 artefacts,
> verified on disk). PROD is READ-ONLY: code compare, read-replica SELECT,
> read-only UI, API GET, history — never create/modify PROD data, never
> payments; declare any login side-effect. Environment, flaky, test-data and
> test-design failures do not trigger the verification. Do not transition or
> link product tickets; report the verdict and let the orchestrator publish.
