// tests/helpers/zone-coverage.ts
// ¿Una coordenada cae dentro de un area de las zonas de cotizacion del carrier? (MG-1132 PK-5, TM-1838:
// «cotizar por distancia, fuera de toda zona»). Puro: lee las filas de `CARRIER_AREAS` ya consultadas (solo SELECT).
// Formatos medidos en TEST: circulo `{lat,lng,radio}` y poligono `[{lat,lng};{lat,lng};…]`. El radio del circulo
// esta en KILOMETROS (confirmado en el front: `add-update-zone.component.ts:717` y
// `CarrierAreasService.getCircleArea`, `radiusKm`). Las areas por codigo postal (tipo Z)
// no tienen geometria evaluable y se devuelven como `null`.
export type AreaRow = {
  AREA_TYPE: string | null;
  CIRCLE: string | null;
  POLYGON: string | null;
  ZIPCODE: number | null;
};

export type Coordinate = { lat: number; lng: number };

const NUMBER = /-?\d+(?:\.\d+)?(?:e-?\d+)?/gi;

function numbers(text: string): number[] {
  return (text.match(NUMBER) ?? []).map(Number);
}

/** Distancia grande-circulo en km. */
export function haversineKm(a: Coordinate, b: Coordinate): number {
  const rad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Vertices `{lat,lng}` de un poligono `[{lat,lng};{lat,lng};…]`. */
export function parsePolygon(text: string): Coordinate[] {
  const values = numbers(text);
  const points: Coordinate[] = [];
  for (let i = 0; i + 1 < values.length; i += 2)
    points.push({ lat: values[i], lng: values[i + 1] });
  return points;
}

/** Punto en poligono por trazado de rayo. */
export function pointInPolygon(point: Coordinate, polygon: Coordinate[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses =
      a.lat > point.lat !== b.lat > point.lat &&
      point.lng < ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (crosses) inside = !inside;
  }
  return inside;
}

/**
 * `true` si la coordenada cae en el area; `false` si no; `null` si el area no tiene geometria evaluable
 * (codigo postal). `circleMargin` multiplica el radio del circulo: margen de seguridad del llamador (la unidad ya es km), no una
 * correccion de unidad.
 */
export function coordinateInArea(
  coordinate: Coordinate,
  area: AreaRow,
  circleMargin = 1
): boolean | null {
  if (area.CIRCLE) {
    const [lat, lng, radius] = numbers(area.CIRCLE);
    return haversineKm(coordinate, { lat, lng }) <= radius * circleMargin;
  }
  if (area.POLYGON) return pointInPolygon(coordinate, parsePolygon(area.POLYGON));
  return null;
}
