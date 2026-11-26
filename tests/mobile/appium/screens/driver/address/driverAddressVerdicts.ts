/**
 * driverAddressVerdicts — veredictos PUROS de los guards del buscador de direcciones de la app Chofer (MG-117).
 * Sin driver ni I/O: reciben mediciones ya recolectadas y devuelven `Evaluation` (mismo contrato que las probes de
 * la app Pasajero, `screens/passenger/address/probes/types.ts`, que se REUTILIZAN para las conductas B1/B2/B4/B6).
 *
 * Aquí solo viven los veredictos que el Chofer necesita y las probes de PAX no cubren:
 *   TM-651 contrato del request (sin `radius` ni `language`), TM-656 / TM-657 piso de 3 caracteres,
 *   TM-663 rotación del token (el buscador del Chofer es un modal que se CIERRA al seleccionar),
 *   TM-664 estado vacío controlado, TM-665 degradación sin caer a Google, y el orden «caché antes que aeropuerto».
 *
 * Disciplina heredada de V1 (campaña MG-117, ATR TM-668): cero requests NUNCA es PASS; lo que no se pudo medir es
 * `SIN_DATOS` / `NO_EJERCIDO`, nunca verde; todo veredicto lleva lo medido.
 */

import type { MinLengthSample } from '../../passenger/address/probes/MinLengthProbe.js';
import { hasQueryParam, queryParam } from '../../passenger/address/probes/measure.js';
import type {
  Evaluation,
  EvidenceLevel,
  ProbeResult,
  Verdict
} from '../../passenger/address/probes/types.js';

/** Resultado de un caso del Chofer: mismo contrato que el `CaseResult` de V1, con la clave de Xray resuelta. */
export type DriverCaseResult = {
  /** Key de Xray (`TM-nnn`), `ORDEN(sin-key)` o un marcador (`PRECONDICION`). */
  key: string;
  title: string;
  status: Verdict;
  verdict: string;
  level: EvidenceLevel;
  measured: Record<string, unknown>;
};

/** Caso sin Test en Xray (hueco de cobertura del Chofer): no se inventa una key (ver el spec). */
export const ORDER_CASE_KEY = 'ORDEN(sin-key)';

export function caseFrom(
  key: string,
  title: string,
  evaluation: Evaluation,
  measured: Record<string, unknown> = {},
  level: EvidenceLevel = 'real-ui'
): DriverCaseResult {
  return {
    key,
    title,
    status: evaluation.status,
    verdict: evaluation.detail,
    level,
    measured
  };
}

/** Adapta el resultado de una probe de PAX (B1/B2/B4/B6) a la key de Xray del Chofer. */
export function caseFromProbe(key: string, title: string, probe: ProbeResult): DriverCaseResult {
  return caseFrom(
    key,
    title,
    { status: probe.status, detail: probe.detail },
    probe.measured,
    probe.level
  );
}

// ---------------------------------------------------------------- TM-651 · contrato del request

/**
 * TM-651 — el request lleva `address` + `latitude` + `longitude` y NO lleva `radius` ni `language`.
 * Código (develop, `get-magiis-autocomplete.command.ts`): el sesgo de 10 km lo aplica el backend; el cliente no
 * envía radius ni language. Las coordenadas salen del ORIGEN del viaje: sin las dos, el backend no aplica sesgo.
 */
export function evaluateRequestContract(urls: readonly string[]): Evaluation {
  if (urls.length === 0) {
    return { status: 'SIN_DATOS', detail: 'Cero requests para inspeccionar el contrato.' };
  }
  const url = String(urls[urls.length - 1]);
  const address = queryParam(url, 'address');
  const hasLat = hasQueryParam(url, 'latitude') && queryParam(url, 'latitude') !== '';
  const hasLng = hasQueryParam(url, 'longitude') && queryParam(url, 'longitude') !== '';
  const forbidden = ['radius', 'language'].filter((p) => hasQueryParam(url, p));
  if (!address) {
    return { status: 'FAIL', detail: 'El request no lleva el parámetro address.' };
  }
  if (!hasLat || !hasLng) {
    return {
      status: 'FAIL',
      detail: `Faltan coordenadas del origen (latitude=${hasLat ? 'sí' : 'no'}, longitude=${hasLng ? 'sí' : 'no'}). El backend solo aplica sesgo si llegan LAS DOS.`
    };
  }
  if (forbidden.length > 0) {
    return {
      status: 'FAIL',
      detail: `El request lleva parámetros fuera de contrato: ${forbidden.join(', ')}.`
    };
  }
  return {
    status: 'PASS',
    detail: `address="${address}" con latitude y longitude; sin radius ni language.`
  };
}

// ---------------------------------------------------------------- TM-656 / TM-657 · piso de 3 caracteres

export const MIN_CHARS_DRIVER = 3;

const sampleAt = (
  perLength: readonly MinLengthSample[],
  length: number
): MinLengthSample | undefined => perLength.find((p) => p.length === length);

/**
 * Deriva los DOS casos del piso desde UNA sola medición por longitud (1..n caracteres):
 *   TM-656 con 2 caracteres NO consulta · TM-657 con exactamente 3 SÍ consulta.
 * TM-656 exige además que alguna longitud >= 3 haya consultado (prueba de vida): «cero requests» sobre un campo
 * inerte no es evidencia de que el piso funciona.
 */
export function deriveMinLengthCases(perLength: readonly MinLengthSample[]): {
  tm656: Evaluation;
  tm657: Evaluation;
} {
  const two = sampleAt(perLength, MIN_CHARS_DRIVER - 1);
  const three = sampleAt(perLength, MIN_CHARS_DRIVER);
  const alive = perLength.some((p) => p.length >= MIN_CHARS_DRIVER && p.calls > 0);

  const tm656: Evaluation =
    !two || two.calls < 0
      ? { status: 'SIN_DATOS', detail: 'El campo no aceptó 2 caracteres: no hay medición.' }
      : two.calls > 0
        ? { status: 'FAIL', detail: `Con 2 caracteres se dispararon ${two.calls} llamada(s).` }
        : !alive
          ? {
              status: 'SIN_DATOS',
              detail:
                'Cero llamadas con 2 caracteres, pero ninguna longitud >= 3 consultó: no se distingue «respeta el piso» de «el campo no consulta nunca».'
            }
          : {
              status: 'PASS',
              detail: 'Cero llamadas con 2 caracteres y el campo consulta desde 3.'
            };

  const tm657: Evaluation =
    !three || three.calls < 0
      ? { status: 'SIN_DATOS', detail: 'El campo no aceptó 3 caracteres: no hay medición.' }
      : three.calls === 0
        ? {
            status: 'FAIL',
            detail:
              'Con 3 caracteres no se disparó ninguna llamada: el piso es mayor que el del AC (3, habilita el IATA).'
          }
        : { status: 'PASS', detail: `Con 3 caracteres se dispararon ${three.calls} llamada(s).` };

  return { tm656, tm657 };
}

// ---------------------------------------------------------------- TM-664 · estado vacío

export type EmptyStateMeasurements = {
  term: string;
  calls: number;
  httpStatus: number | undefined;
  rows: number;
  parseError: string | null;
  itemsOnScreen: number;
  loaders: readonly string[];
  errors: readonly string[];
  fieldUsable: boolean;
};

/** TM-664 — término sin resultados: HTTP 200 con lista vacía, sin items, sin spinner, sin error, campo operativo. */
export function evaluateEmptyState(m: EmptyStateMeasurements): Evaluation {
  if (m.calls === 0) {
    return { status: 'SIN_DATOS', detail: 'Cero requests: no se ejerció la respuesta vacía.' };
  }
  if (m.parseError) {
    return {
      status: 'FAIL',
      detail: `El cuerpo de la respuesta no es JSON válido: ${m.parseError}.`
    };
  }
  if (m.httpStatus !== undefined && m.httpStatus !== 200) {
    return {
      status: 'FAIL',
      detail: `Un término sin coincidencias devolvió HTTP ${m.httpStatus}: debe expresarse como contenido vacío, no como error.`
    };
  }
  if (m.rows > 0 || m.itemsOnScreen > 0) {
    return {
      status: 'FAIL',
      detail: `Se esperaba lista vacía y hubo ${m.rows} fila(s) en la respuesta y ${m.itemsOnScreen} item(s) en pantalla.`
    };
  }
  if (m.errors.length > 0) {
    return { status: 'FAIL', detail: `Apareció un aviso de error: ${m.errors.join(' | ')}` };
  }
  if (m.loaders.length > 0) {
    return {
      status: 'FAIL',
      detail: `Quedó un indicador de carga visible: ${m.loaders.join(', ')}`
    };
  }
  if (!m.fieldUsable) {
    return { status: 'FAIL', detail: 'El campo quedó inutilizable tras la respuesta vacía.' };
  }
  return {
    status: 'PASS',
    detail:
      'HTTP 200 con lista vacía: sin items, sin spinner, sin error, y el campo sigue operativo.'
  };
}

// ---------------------------------------------------------------- ORDEN · caché cercana antes que aeropuerto

export type OrderRow = {
  mainText?: string;
  source?: string;
  airport?: boolean;
  latitude?: string | null;
  longitude?: string | null;
};

/** Distancia real en km (haversine). Comparar grados confunde «misma ciudad» con «mismo punto». */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const rad = (d: number): number => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export type OrderMeasurements = {
  term: string;
  calls: number;
  rows: readonly OrderRow[];
  origin: { lat: number; lng: number } | null;
};

/** Las filas con sus distancias al origen (null si no hay origen o coordenadas), para dejar el orden auditable. */
export function describeOrder(
  m: OrderMeasurements
): Array<{ mainText?: string; source?: string; km: number | null }> {
  return m.rows.map((r) => {
    const la = Number(r.latitude);
    const lo = Number(r.longitude);
    const ok =
      m.origin !== null &&
      Number.isFinite(m.origin.lat) &&
      Number.isFinite(m.origin.lng) &&
      r.latitude !== null &&
      r.latitude !== undefined &&
      r.longitude !== null &&
      r.longitude !== undefined &&
      Number.isFinite(la) &&
      Number.isFinite(lo);
    return {
      mainText: r.mainText,
      source: r.source,
      km: ok && m.origin ? Math.round(distanceKm(m.origin.lat, m.origin.lng, la, lo)) : null
    };
  });
}

/**
 * Las direcciones de CACHÉ (locales) deben ir por delante de los aeropuertos lejanos. En PAX el equivalente es
 * TM-727 (reproducido en 5 entornos, backend, no bloqueante); en el Chofer el caso no tiene Test (hueco de MG-931).
 */
export function evaluateOrder(m: OrderMeasurements): Evaluation {
  if (m.calls === 0) {
    return { status: 'SIN_DATOS', detail: `Cero requests con "${m.term}".` };
  }
  if (m.rows.length === 0) {
    return { status: 'SIN_DATOS', detail: 'Respuesta vacía: no hay orden que evaluar.' };
  }
  const iAirport = m.rows.findIndex((r) => r.source === 'AIRPORT' || r.airport === true);
  const iCache = m.rows.findIndex((r) => r.source === 'CACHE');
  if (iAirport === -1) {
    return {
      status: 'NO_EJERCIDO',
      detail:
        'No se devolvieron aeropuertos para este término: no hay precedencia que evaluar (no es un verde).'
    };
  }
  if (iCache === -1) {
    return {
      status: 'NO_EJERCIDO',
      detail:
        'Solo aeropuertos y ninguna dirección de caché: no hay con qué comparar la precedencia (no es un verde).'
    };
  }
  const d = describeOrder(m);
  if (iAirport < iCache) {
    const a = d[iAirport];
    const c = d[iCache];
    return {
      status: 'FAIL',
      detail: `La posición ${iAirport} es el aeropuerto "${a?.mainText}"${a?.km !== null && a?.km !== undefined ? ` (a ${a.km} km)` : ''}, por delante de la primera dirección de caché "${c?.mainText}"${c?.km !== null && c?.km !== undefined ? ` (a ${c.km} km)` : ''}, que aparece recién en la posición ${iCache}.`
    };
  }
  return {
    status: 'PASS',
    detail: `La primera dirección de caché está en la posición ${iCache}, antes del primer aeropuerto (${iAirport}).`
  };
}

// ---------------------------------------------------------------- TM-663 · rotación del token

export type DriverTokenRotationMeasurements = {
  typed: boolean;
  tokensBefore: readonly string[];
  /** `null` = no había predicción para tocar; `undefined` = no se llegó a esa etapa. */
  picked?: string | null;
  /** El modal de búsqueda se cerró tras seleccionar (así lo hace la app: `modalController.dismiss(place)`). */
  searchClosed?: boolean;
  /** Se pudo reabrir el buscador desde la fila de destino. */
  reopened?: boolean;
  typedAfter?: boolean;
  tokensAfter?: readonly string[];
};

const distinct = (v: readonly string[]): string[] => [...new Set(v.filter(Boolean))];

/**
 * TM-663 — tras seleccionar una predicción, la búsqueda siguiente usa un sessionToken NUEVO (CA-30: la selección
 * cierra la sesión y `geocode` descarta el token). A diferencia de PAX, el buscador del Chofer es un modal que se
 * cierra al elegir: «reabrir» forma parte de la medición. Si no se completa la secuencia es NO_EJERCIDO.
 */
export function evaluateDriverTokenRotation(m: DriverTokenRotationMeasurements): Evaluation {
  if (!m.typed) {
    return { status: 'SIN_DATOS', detail: 'El campo no aceptó texto: no hay token que observar.' };
  }
  const before = distinct(m.tokensBefore);
  if (before.length === 0) {
    return {
      status: 'SIN_DATOS',
      detail: 'La primera búsqueda no produjo ninguna llamada con sessionToken.'
    };
  }
  if (m.picked === undefined || m.picked === null) {
    return {
      status: 'NO_EJERCIDO',
      detail:
        'No había ninguna predicción para seleccionar: sin selección no hay rotación que medir.'
    };
  }
  if (!m.searchClosed) {
    return {
      status: 'NO_EJERCIDO',
      detail:
        'Se tocó una predicción pero el buscador no se cerró: la selección no se concretó (límite del harness).'
    };
  }
  if (!m.reopened || !m.typedAfter) {
    return {
      status: 'NO_EJERCIDO',
      detail:
        'No se pudo reabrir el buscador tras seleccionar: el token nuevo se emite al volver a entrar.'
    };
  }
  const after = distinct(m.tokensAfter ?? []);
  if (after.length === 0) {
    return {
      status: 'SIN_DATOS',
      detail: 'La búsqueda posterior no produjo ninguna llamada con sessionToken.'
    };
  }
  if (after.some((t) => before.includes(t))) {
    return {
      status: 'FAIL',
      detail: `El token no rotó tras seleccionar (antes ${before.join(',')}; después ${after.join(',')}): la sesión anterior sigue abierta.`
    };
  }
  return {
    status: 'PASS',
    detail: `El token rotó: ${before.join(',')} antes, ${after.join(',')} después.`
  };
}

// ---------------------------------------------------------------- TM-665 · degradación sin caer a Google

export type DegradationScenario = {
  name: string;
  /** Veces que la regla de falla hizo match; `null` = no se pudo leer. */
  faultHits: number | null;
  /** Recursos nuevos de Google por Resource Timing; `-1` = la sonda no estuvo disponible. */
  googleNewResources: number;
  googleXhr: number;
  itemsOnScreen: number;
  loaderVisible: boolean;
  errorShown: boolean;
};

/**
 * TM-665 — ante un 5xx / error de red del endpoint propio, la app degrada de forma controlada y NO consulta a
 * Google. Es evidencia de MECANISMO (falla inyectada por JS, nivel `mechanism`): un FAIL no se reporta como bug sin
 * reproducir con backend real caído. Un escenario cuya regla nunca hizo match NO ejerció nada (medido 24/11/2026 en
 * la disponibilidad: la respuesta sintética puede no llegarle al HttpClient de la app): es NO_EJERCIDO, no verde.
 */
export function evaluateDegradation(scenarios: readonly DegradationScenario[]): Evaluation {
  if (scenarios.length === 0) {
    return { status: 'SIN_DATOS', detail: 'No se ejecutó ningún escenario de falla.' };
  }
  const google = scenarios.reduce((n, s) => n + Math.max(0, s.googleNewResources) + s.googleXhr, 0);
  if (google > 0) {
    return {
      status: 'FAIL',
      detail: `Ante el fallo del endpoint propio la app consultó Google (${google} recurso(s)/request(s)): es el riesgo económico que la épica busca eliminar.`
    };
  }
  const unreliable = scenarios.filter((s) => s.googleNewResources < 0).map((s) => s.name);
  if (unreliable.length > 0) {
    return {
      status: 'SIN_DATOS',
      detail: `La sonda de Resource Timing no estuvo disponible en ${unreliable.join(', ')}: «cero recursos» no distingue «no llamó» de «no se pudo medir».`
    };
  }
  const noHit = scenarios.filter((s) => !s.faultHits).map((s) => s.name);
  if (noHit.length === scenarios.length) {
    return {
      status: 'NO_EJERCIDO',
      detail: `Ninguna regla de falla hizo match (${noHit.join(', ')}): la falla inyectada no llegó a la app y el caso no se ejerció.`
    };
  }
  const stuck = scenarios.filter((s) => s.loaderVisible).map((s) => s.name);
  const partial = noHit.length > 0 ? ` Sin match (no ejercidos): ${noHit.join(', ')}.` : '';
  return {
    status: 'PASS',
    detail: `Cero tráfico a Google en ${scenarios.length} escenario(s).${
      stuck.length > 0
        ? ` OBSERVACIÓN no bloqueante: indicador de carga visible en ${stuck.join(', ')}.`
        : ''
    }${partial}`
  };
}
