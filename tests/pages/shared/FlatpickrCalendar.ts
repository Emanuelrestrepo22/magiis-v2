// tests/pages/shared/FlatpickrCalendar.ts
// Componente del calendario flatpickr que usa el portal (`mwlFlatpickr`): fecha única (Reporte
// Diario) y rango (`app-magiis-ranges-date-picker`: Owner Report y rankings).
//
// Es agnóstico del idioma: el calendario de rango sale SIEMPRE en español (Octubre, Lun…) aunque
// el portal esté en inglés, y el de fecha única sigue al portal. Por eso no se ancla a
// `aria-label="May 6, 2026"`: se navega leyendo `.cur-month` + `.cur-year` (mapa bilingüe de
// meses) y el día se elige por su número dentro del mes visible.
//
// Uso: abrir el calendario con un click en el `.input-group` del picker y después
//   const calendar = new FlatpickrCalendar(page);
//   await calendar.pickDate({ year: 2026, month: 5, day: 6 });      // fecha única
//   await calendar.pickRange(from, to);                              // rango
import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export interface CalendarDate {
  year: number;
  /** Mes 1-12. */
  month: number;
  day: number;
}

// Orden = índice de mes 0-11. Cada entrada acepta inglés y español.
const MONTH_NAMES: readonly (readonly string[])[] = [
  ['january', 'enero'],
  ['february', 'febrero'],
  ['march', 'marzo'],
  ['april', 'abril'],
  ['may', 'mayo'],
  ['june', 'junio'],
  ['july', 'julio'],
  ['august', 'agosto'],
  ['september', 'septiembre', 'setiembre'],
  ['october', 'octubre'],
  ['november', 'noviembre'],
  ['december', 'diciembre']
];

function monthIndexOf(label: string): number {
  const normalized = label.trim().toLowerCase();
  return MONTH_NAMES.findIndex((names) => names.includes(normalized));
}

export class FlatpickrCalendar {
  readonly root: Locator;
  readonly currentMonth: Locator;
  readonly currentYear: Locator;
  readonly previousMonth: Locator;
  readonly nextMonth: Locator;
  /** Días del mes visible (excluye los de relleno del mes anterior/siguiente). */
  readonly days: Locator;

  constructor(page: Page) {
    // Un solo calendario abierto a la vez: el del picker que se acaba de clickear.
    this.root = page.locator('.flatpickr-calendar.open');
    this.currentMonth = this.root.locator('.cur-month');
    this.currentYear = this.root.locator('.cur-year');
    this.previousMonth = this.root.locator('.flatpickr-prev-month');
    this.nextMonth = this.root.locator('.flatpickr-next-month');
    this.days = this.root.locator('.flatpickr-day:not(.prevMonthDay):not(.nextMonthDay)');
  }

  /** Navega con las flechas hasta el mes pedido (máx. 60 pasos: el calendario nunca queda lejos). */
  async gotoMonth(year: number, month: number): Promise<void> {
    await expect(this.root).toBeVisible();
    for (let step = 0; step < 60; step++) {
      const shownMonth = monthIndexOf(await this.currentMonth.innerText());
      const shownYear = Number(await this.currentYear.inputValue());
      expect(
        shownMonth,
        'el mes visible del calendario debe ser reconocible'
      ).toBeGreaterThanOrEqual(0);
      const diff = year * 12 + (month - 1) - (shownYear * 12 + shownMonth);
      if (diff === 0) return;
      await (diff < 0 ? this.previousMonth : this.nextMonth).click();
    }
    throw new Error(`El calendario no llegó a ${year}-${month}`);
  }

  /** Elige un día del mes visible. */
  async pickDay(day: number): Promise<void> {
    await this.days.getByText(String(day), { exact: true }).click();
  }

  /** Fecha única: navega al mes y elige el día. */
  async pickDate(date: CalendarDate): Promise<void> {
    await this.gotoMonth(date.year, date.month);
    await this.pickDay(date.day);
  }

  /**
   * Rango: elige desde y hasta. El segundo click cierra el rango y dispara las consultas del
   * front; quien llama debe registrar la espera de red ANTES de invocar este método.
   */
  async pickRange(from: CalendarDate, to: CalendarDate): Promise<void> {
    await this.gotoMonth(from.year, from.month);
    await this.pickDay(from.day);
    await this.gotoMonth(to.year, to.month);
    await this.pickDay(to.day);
  }
}

/** `2026-05-06` → fecha del calendario. */
export function calendarDateFromIso(iso: string): CalendarDate {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day };
}
