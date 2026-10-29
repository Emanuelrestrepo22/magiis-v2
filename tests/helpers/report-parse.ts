// tests/helpers/report-parse.ts
// Parseo de archivos descargados desde los reportes del carrier V2 (SOLO LECTURA).
// Alcance real (inventario FE magiis-fe-carrier-v2 develop, 2026-10-21): el front exporta CSV solo en
// Aging, Taxes & Fees, Individual CA Travels, Cost Center (CSV `;` con BOM UTF-8). El resto de los
// reportes exporta PDF (jsPDF en cliente o PDF del servidor). No hay XLSX en ninguna pantalla y el
// repo no tiene dependencia de lectura de planillas, por eso aqui solo hay CSV + texto de PDF.
// El texto de PDF se extrae con `pdftotext` (poppler) SI esta instalado; si no, devuelve null y el
// llamador valida solo la estructura (cabecera %PDF y tamano).
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Quita el BOM UTF-8 inicial (el front antepone ﻿ a todos los CSV). */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Delimitador del CSV: el que mas aparece en la primera linea entre `;` `,` y tab. */
export function detectDelimiter(text: string): string {
  const firstLine = stripBom(text).split(/\r?\n/, 1)[0] ?? '';
  const candidates = [';', ',', '\t'];
  let best = ';';
  let bestCount = -1;
  for (const candidate of candidates) {
    const count = firstLine.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** CSV -> matriz de celdas (soporta comillas dobles, comillas escapadas "" y saltos CRLF/LF). */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const source = stripBom(text);
  const sep = delimiter ?? detectDelimiter(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Descarta lineas totalmente vacias (CSV con salto final).
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

/** Primera fila = encabezados (en minuscula, sin espacios dobles); el resto, objetos por encabezado. */
export function csvToObjects(matrix: readonly string[][]): Array<Record<string, string>> {
  if (matrix.length === 0) return [];
  const headers = matrix[0].map((h) => h.trim().replace(/\s+/g, ' ').toLowerCase());
  return matrix.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (cells[idx] ?? '').trim();
    });
    return obj;
  });
}

export function readCsvFile(path: string): {
  matrix: string[][];
  rows: Array<Record<string, string>>;
} {
  const matrix = parseCsv(readFileSync(path, 'utf8'));
  return { matrix, rows: csvToObjects(matrix) };
}

const CURRENCY_GLYPHS = /[€$£¥]|\b(?:EUR|USD|ARS|GBP)\b/gi;

/**
 * Importe con formato local -> numero. Acepta `€ 3 120,80`, `$ 2.728,00`, `1,234.56`, `-3091.94`,
 * NBSP y NNBSP como separador de miles. El separador decimal es el ULTIMO `,` o `.` que tenga 1-2
 * digitos detras (si tiene 3 digitos detras se toma como separador de miles). Devuelve null si no hay numero.
 */
export function parseMoney(text: string | number | null | undefined): number | null {
  if (typeof text === 'number') return Number.isFinite(text) ? text : null;
  if (text === null || text === undefined) return null;
  const cleaned = text
    .replace(CURRENCY_GLYPHS, '')
    .replace(/[\s\u00a0\u202f]/g, '')
    .trim();
  if (!/\d/.test(cleaned)) return null;
  const negative = /^\(.*\)$/.test(cleaned) || cleaned.startsWith('-');
  const digits = cleaned.replace(/[()+-]/g, '');
  const lastComma = digits.lastIndexOf(',');
  const lastDot = digits.lastIndexOf('.');
  const lastSep = Math.max(lastComma, lastDot);
  let normalized: string;
  if (lastSep === -1) {
    normalized = digits;
  } else {
    const decimals = digits.length - lastSep - 1;
    // 1-2 digitos tras el ultimo separador = decimales; 3 o mas = separador de miles.
    const isDecimal = decimals > 0 && decimals <= 2;
    normalized = isDecimal
      ? `${digits.slice(0, lastSep).replace(/[.,]/g, '')}.${digits.slice(lastSep + 1)}`
      : digits.replace(/[.,]/g, '');
  }
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

export type CurrencyGlyph = '€' | '$' | '£' | '¥' | 'EUR' | 'USD' | 'ARS' | 'GBP';

/** Simbolos/codigos de moneda presentes en un texto (para observaciones de formato). */
export function detectCurrencyGlyphs(text: string): CurrencyGlyph[] {
  const found = new Set<string>();
  for (const match of text.matchAll(CURRENCY_GLYPHS)) found.add(match[0].toUpperCase());
  return [...found] as CurrencyGlyph[];
}

export function isPdfBuffer(buffer: Buffer): boolean {
  return buffer.length > 8 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

let pdftotextAvailable: boolean | undefined;

export function hasPdftotext(): boolean {
  if (pdftotextAvailable === undefined) {
    pdftotextAvailable = spawnSync('pdftotext', ['-v'], { encoding: 'utf8' }).error === undefined;
  }
  return pdftotextAvailable;
}

/** Texto del PDF con `pdftotext -layout`; null si el binario no existe o el PDF no se pudo leer. */
export function extractPdfText(path: string): string | null {
  if (!hasPdftotext()) return null;
  const result = spawnSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout;
}

/**
 * Como se imprime un importe en el texto de un PDF:
 *  - 'whole': el numero esta entero en una celda.
 *  - 'wrapped': con separador de miles tipo espacio, la celda se parte en dos renglones
 *    («2» / «828,00» para 2 828,00); se detecta la cabeza y la cola como tokens sueltos.
 *  - null: no aparece.
 */
export type AmountMatch = 'whole' | 'wrapped' | null;

export function findAmountInText(text: string, amount: number): AmountMatch {
  const target = Math.round(amount * 100);
  // Un importe = grupos de miles separados por espacio/NBSP/punto/coma + decimales opcionales; dos importes
  // contiguos («54,00  54,00») son dos tokens, no uno.
  const tokenRe = /-?\d{1,3}(?:[\s\u00a0\u202f.,]\d{3})+(?:[.,]\d{1,2})?|-?\d+(?:[.,]\d{1,2})?/g;
  for (const match of text.matchAll(tokenRe)) {
    const value = parseMoney(match[0]);
    if (value !== null && Math.round(value * 100) === target) return 'whole';
  }
  const abs = Math.abs(amount);
  if (abs >= 1000) {
    const head = String(Math.floor(abs / 1000));
    const tailInt = String(Math.floor(abs % 1000)).padStart(3, '0');
    const decimals = Math.round((abs - Math.floor(abs)) * 100);
    const dec = String(decimals).padStart(2, '0');
    const decimalPart = decimals === 0 ? '(?:[.,]00)?' : '[.,]' + dec;
    const tailRe = new RegExp('(?<![\\d.,])' + tailInt + decimalPart + '(?!\\d)');
    const headRe = new RegExp('(?<![\\d.,])' + head + '(?![.,]?\\d)');
    if (headRe.test(text) && tailRe.test(text)) return 'wrapped';
  }
  return null;
}

/** True si el texto del PDF contiene el importe (entero o partido en dos renglones). */
export function textContainsAmount(text: string, amount: number): boolean {
  return findAmountInText(text, amount) !== null;
}
