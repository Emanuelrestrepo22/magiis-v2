# Cómo corro los tests desde GitLab

Para ejecutar la automatización de **Alta de Viaje** no hace falta instalar nada,
ni clonar el repositorio, ni saber programar. Todo pasa desde la web de GitLab.

## Los 3 pasos

### 1. Abrir el formulario

En GitLab, dentro del proyecto `magiis-fe-v2-testing`:

**Build → Pipelines → botón `Run pipeline`** (arriba a la derecha).

En **Run for branch name or tag** elegí **`ci/gitlab-pipeline`**.

### 2. Elegir qué correr

Vas a ver cuatro campos con valores ya puestos. **Si no querés cambiar nada,
dejalos como están y andá al paso 3** — los valores por defecto corren la suite
completa de Nuevo Viaje y actualizan Jira.

| Campo                | Qué hace                                                                                                                     | Valor por defecto    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `QUE_CORRER`         | Qué se ejecuta. La primera opción corre toda la suite de Nuevo Viaje; las demás, un archivo puntual si querés ir más rápido. | `tests/specs/trips`  |
| `PROYECTO`           | Resolución de pantalla del navegador.                                                                                        | `carrier-v2-desktop` |
| `XRAY_EXECUTION_KEY` | El Test Execution de Xray que recibe los resultados.                                                                         | `TM-1146`            |
| `IMPORTAR_A_XRAY`    | Si querés correr los tests **sin** tocar Jira, ponelo en `no`.                                                               | `si`                 |

Apretá **`Run pipeline`**.

### 3. Mirar el resultado

El pipeline tarda unos **7 minutos**. Vas a ver tres cuadraditos en fila:

| Job                 | Qué hace                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `conectividad`      | ~15 segundos. Revisa que el ambiente de TEST esté vivo.                                                                 |
| `tests-nuevo-viaje` | Corre la suite (~6 min). Es el que más tarda. Queda en rojo si algún test falla, que es lo esperado cuando hay un bug.  |
| `importar-a-xray`   | Manda los resultados a TM-1146. Corre **siempre**, también cuando hay tests en rojo — justamente ahí es cuando importa. |

**El detalle test por test está en la pestaña `Tests`**, arriba de todo en la
página del pipeline. Ahí ves cada caso con su nombre, cuánto tardó, y —en los
que fallan— el error exacto.

---

## Cómo leer los resultados

### En GitLab

La pestaña **`Tests`** es el lugar. Muestra los casos uno por uno.

Si querés más detalle (capturas de pantalla, video del navegador, la traza
completa del fallo), está en el reporte HTML de Playwright:
**job `tests-nuevo-viaje` → panel derecho → `Download artifacts`**. Se baja un
`.zip`; descomprimilo y abrí `evidence/test/report/index.html` en el navegador.

> ⚠️ El reporte HTML **no se puede ver directamente dentro de GitLab**: hay que
> bajar el zip y abrirlo local. Es una limitación de GitLab.com, que por
> seguridad no renderiza páginas HTML guardadas como artifact.

### En Jira (TM-1146)

Abrí **[TM-1146](https://magiis.atlassian.net/browse/TM-1146)** y mirá la lista
de Test Runs. Ahí cada caso figura como **PASSED** o **FAILED**.

> ⚠️ **Importante, para no leer mal el resultado.** Lo que se actualiza es el
> **Test Run adentro de TM-1146**, no el estado del issue de cada test.
> Los TM-770, TM-783, TM-789 y compañía van a seguir diciendo
> **"Tareas por hacer"** cuando los abrís sueltos. **Eso es correcto y
> esperado**: el estado de un issue de Jira y el resultado de una ejecución son
> dos cosas distintas. La foto de la corrida se mira **siempre desde TM-1146**.

Cada corrida **pisa** el resultado anterior sobre la misma ejecución: TM-1146
refleja el estado de la **última** corrida, no un historial acumulado.

---

## Correr todo en local (por carriles)

Primero el chequeo previo: dice en segundos si la máquina puede correr la suite (Node, `.env`,
navegador, TEST arriba y, con `--hybrid`, Appium, emuladores y apps). Sale con error si algo
bloquea; no imprime valores del `.env`.

```bash
npx cross-env ENV=test npm run doctor:local              # carriles 1-4
npx cross-env ENV=test npm run doctor:local -- --hybrid  # + carril 5 (app)
```

| Carril                   | Comando                                                                                                                                                                       | Notas                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1. Unit                  | `npm run test:unit`                                                                                                                                                           | Sin red ni navegador.                                                                                          |
| 2. Web funcional         | `npx cross-env ENV=test REGION_SESSIONS=AR playwright test --grep-invert "@visual\|@e2e\|@db\|@explore" --project=carrier-v2-desktop --project=carrier-v2-laptop --workers=4` | Mismo filtro que regression en CI. `REGION_SESSIONS=AR` crea la sesión del carrier métrico.                    |
| 3. Visual                | `npm run test:visual`                                                                                                                                                         | En Windows compara contra las baselines `-win32`; las `-linux` (las de CI) solo se reproducen en Linux/Docker. |
| 4. A11y                  | `npm run test:a11y` y después `npm run a11y:gate`                                                                                                                             | El gate falla si crecen las violations respecto de `tests/fixtures/a11y-baseline.json`.                        |
| 5. Híbrido (app)         | —                                                                                                                                                                             | Pendiente: requiere `doctor:local -- --hybrid` en verde.                                                       |
| 6. Circuitos F5/FR/admin | ver la sección de abajo                                                                                                                                                       | Crean datos permanentes; solo con su gate.                                                                     |

Reglas para no ensuciar los resultados:

- **Un solo carril pesado por vez contra TEST.** Dos suites en paralelo saturan el ambiente y
  aparecen timeouts que no son bugs (2026-11-11: smoke + regression a la vez → 21 fallos falsos).
- **Evitar 09:00-10:30 ART de lunes a viernes**: es la corrida diaria agendada de GitHub Actions.
  **Tampoco correr en el horario de deploy de TEST (tarde)**: un deploy en curso tumba el ambiente
  y deja fallos que no son bugs. TEST además está apagado de 21:00 a 04:00 ART.
- Clonar el repo **fuera de OneDrive** (p. ej. `C:\dev`): ahí npm es más lento y `ALLURE=1` falla.

---

## Preparación de datos F5 en UAT (local, no corre en CI)

Para preparar viajes cerrados del circuito administrativo (alta por «Send Manual»
→ cancelar → «Administrative finalization» con el chofer del par propio de QA) y
verificar el lote pendiente antes de rendir. Se corre **a mano y con Node** (no
Bun: cuelga el pipe de Playwright en Windows). No entra en `test:smoke` ni en CI.

1. Perfil: `CIRCUIT_CARRIER=1040-uat` (AR), `1481-uat` (US) o `2021-uat` (FR), con
   `ENV=uat`. Credenciales y URL en `.env.uat` (ignorado por git); la sesión sale
   de `storage/state-carrier-<ar|us|fr>-uat.json` con `REUSE_STORAGE_STATE=1`.
   FR: copiar `state-carrier-uat-fr.json` a `state-carrier-fr-uat.json`.
2. Verificación (solo lectura, sin gates):
   `npx cross-env CIRCUIT_CARRIER=1040-uat REUSE_STORAGE_STATE=1 npm run test:f5:prep:verify`
3. Preparación (crea un viaje **permanente** por escenario; gate exacto `1`):
   `npx cross-env CIRCUIT_CARRIER=1040-uat REUSE_STORAGE_STATE=1 CIRCUIT_PREP_CREATE_TRIPS=1 F5_PREP_SCENARIOS=EF-NC-COM npm run test:f5:prep`
   Escenarios: `EF-NC-COM`, `CC`, `EF-PLAIN`, `EF-NC-ONLY`, `EF-FARE0`. Par:
   `F5_PREP_PAIR` (1481: `P1`/`P2`/`P3`; por defecto el del perfil).
4. Un escenario por par por vez: la rendición consume todo el lote del par. Verificá
   (paso 2) antes de crear el siguiente.

Nunca rinde, liquida, edita propietario/vehículo ni usa el botón «A»: una guarda de
red aborta cualquier escritura fuera de la lista permitida y el test falla. Los viajes
quedan anotados en `evidence/uat/admin-circuit-done-trips.json`; el handoff de cada
corrida en `evidence/uat/f5-prep/`.

---

## Preguntas frecuentes

**¿Puedo romper algo corriendo esto?**
No. La suite sólo lee y navega la pantalla: no crea viajes ni modifica datos. El
único caso que daría de alta un viaje real está desactivado a propósito (igual que
la preparación F5 de arriba, que exige su gate).

**Falló `conectividad` y no corrió nada.**
El ambiente de TEST está caído. El log te dice cuál de las dos capas falló:
el frontend o el backend. No es un problema de los tests ni del pipeline — hay
que esperar a que el ambiente vuelva y correr de nuevo. El servidor de TEST
además está **apagado a propósito entre las 00:00 y las 07:00 UTC**
(21:00 a 04:00 de Argentina).

**Fallaron varios tests de golpe, todos parecidos.**
Antes de reportar bugs, fijate si el primero falló al buscar el cliente. Casi
toda la pantalla depende de tener un cliente seleccionado: si esa búsqueda no
devuelve nada, se cae en cascada todo lo que viene después. Suele ser un
problema del dato en el ambiente, no de la aplicación.

**¿Por qué no corre solo cuando alguien sube código?**
A propósito. La suite pega contra el ambiente de TEST real y los minutos de
runner se pagan, así que se dispara únicamente a mano desde el formulario.

**Quiero correr sólo un archivo para ir más rápido.**
Elegí en `QUE_CORRER` una de las opciones que terminan en `.spec.ts` en vez de
la carpeta completa.

---

## Si algo se rompe y no es obvio

El pipeline y sus variables los administra quien tenga permiso de **Maintainer**
en el proyecto. Las credenciales y URLs viven en
**Settings → CI/CD → Variables**, no en la máquina de nadie: son la fuente única
para todas las corridas.
