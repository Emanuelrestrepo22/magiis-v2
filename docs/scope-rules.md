# Reglas de alcance — magiis-carrier-v2-e2e

> Estas reglas son **inmutables** para este proyecto. Cualquier agente, persona o proceso que opere sobre este repositorio debe respetarlas.

## 1. Solo frontend

Este proyecto automatiza **únicamente** la capa visual y funcional del portal carrier V2 (Angular 18).

### Permitido
- ✅ Interacciones del usuario: clicks, inputs, navegación, hover, focus, teclado.
- ✅ Validaciones funcionales: mensajes de error, deshabilitar/habilitar campos, estados.
- ✅ Validaciones visuales: screenshot diff, DOM snapshot, estructura, layout, estilos visibles.
- ✅ Comparación V1 vs V2 a nivel UI/UX.
- ✅ Setup mínimo de auth para llegar a pantallas (storageState).

### Prohibido
- ❌ Llamadas a API que no sean las que el frontend dispara naturalmente.
- ❌ Asserts sobre payloads de respuesta backend (excepto si la UI muestra ese dato).
- ❌ Validaciones de base de datos.
- ❌ Mocks de backend (usar ambiente real o stubs solo si el equipo lo decide explícitamente).
- ❌ Tests de performance, carga, seguridad.
- ❌ Cualquier prueba que requiera Appium o mobile.

## 2. V2 como objetivo, V1 como referencia

- El target de los tests es **siempre V2** (Angular 18).
- V1 (Angular 8) es **fuente de referencia** para:
  - Entender el comportamiento esperado original.
  - Detectar regresiones (algo que funcionaba en V1 y se rompió en V2).
  - Validar paridad visual cuando se acuerda mantener look & feel.

## 3. Trazabilidad obligatoria

Cada test debe declarar:
- `MX-XXXX` (ticket Jira del filtro MX-4820 que documenta la pantalla migrada).
- Módulo (carrier portal sub-área).
- Pantalla (nombre canónico).
- Tipo: `visual | functional | both`.
- Ruta V1 y ruta V2 (para diff comparativo cuando aplique).

## 4. Sin invención

- No inventar selectores: extraerlos del DOM real de V2.
- No inventar rutas: solo las documentadas en el ticket Jira o validadas en el repo V2.
- No inventar requisitos: si falta criterio de aceptación, marcar TODO + bloquear el test hasta confirmación.

## 5. Cobertura priorizada

1. **P1**: Pantallas críticas (login, dashboard, listados principales del carrier).
2. **P2**: Formularios y CRUD.
3. **P3**: Pantallas auxiliares (settings, ayuda, perfil).

Las 25 pantallas del MX-4820 se priorizarán en base a complejidad y criticidad funcional declarada en cada ticket finalizado.

## 6. Convención de commits

Respetar la convención del perfil global Emanuel Restrepo:

```
<tipo>(<scope>): [TC-ID] descripción corta
```

Ejemplos en este proyecto:
- `feat(carrier-v2/login): [MX-XXXX] spec visual+funcional pantalla login migrada`
- `docs(inventory): [MX-4820] poblar inventario de 25 pantallas finalizadas`

## 7. Convención de ramas

Respetar `magiis-branch-convention` (skill global):

- `carrier-v2/<feature>` para specs del portal carrier V2.
- `analysis/<topic>` para análisis comparativos.
- `infra/<change>` para configuración del framework.
