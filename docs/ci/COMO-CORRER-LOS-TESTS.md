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

| Campo | Qué hace | Valor por defecto |
| --- | --- | --- |
| `QUE_CORRER` | Qué se ejecuta. La primera opción corre toda la suite de Nuevo Viaje; las demás, un archivo puntual si querés ir más rápido. | `tests/specs/trips` |
| `PROYECTO` | Resolución de pantalla del navegador. | `carrier-v2-desktop` |
| `XRAY_EXECUTION_KEY` | El Test Execution de Xray que recibe los resultados. | `TM-1146` |
| `IMPORTAR_A_XRAY` | Si querés correr los tests **sin** tocar Jira, ponelo en `no`. | `si` |

Apretá **`Run pipeline`**.

### 3. Mirar el resultado

El pipeline tarda unos **7 minutos**. Vas a ver tres cuadraditos en fila:

| Job | Qué hace |
| --- | --- |
| `conectividad` | ~15 segundos. Revisa que el ambiente de TEST esté vivo. |
| `tests-nuevo-viaje` | Corre la suite (~6 min). Es el que más tarda. Queda en rojo si algún test falla, que es lo esperado cuando hay un bug. |
| `importar-a-xray` | Manda los resultados a TM-1146. Corre **siempre**, también cuando hay tests en rojo — justamente ahí es cuando importa. |

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

## Preguntas frecuentes

**¿Puedo romper algo corriendo esto?**
No. La suite sólo lee y navega la pantalla: no crea viajes ni modifica datos. El
único caso que daría de alta un viaje real está desactivado a propósito.

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
