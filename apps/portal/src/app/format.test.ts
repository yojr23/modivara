import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays, dayKey, dayStart, fmtWhen } from './format';

// Zona del local distinta a la del sistema: Bogotá (UTC−5, sin horario de verano) y Tokio (UTC+9).
afterEach(() => vi.useRealTimers());

describe('fechas en la zona del local', () => {
  it('el día calendario depende de la zona', () => {
    const t = Date.parse('2026-11-03T03:30:00Z');
    expect(dayKey(t, 'America/Bogota')).toBe('2026-11-02');
    expect(dayKey(t, 'Asia/Tokyo')).toBe('2026-11-03');
  });

  it('dayStart devuelve la medianoche del local', () => {
    expect(new Date(dayStart('2026-11-03', 'America/Bogota')).toISOString()).toBe('2026-11-03T05:00:00.000Z');
    expect(new Date(dayStart('2026-11-03', 'Asia/Tokyo')).toISOString()).toBe('2026-11-02T15:00:00.000Z');
    // Con horario de verano (Nueva York pasa a UTC−4 el 8 mar 2026).
    expect(new Date(dayStart('2026-03-09', 'America/New_York')).toISOString()).toBe('2026-03-09T04:00:00.000Z');
  });

  it('«Hoy» y «Ayer» se cuentan en el día del local', () => {
    vi.useFakeTimers({ now: Date.parse('2026-11-03T03:30:00Z') }); // en Bogotá aún es el 2 de noviembre, 22:30
    expect(fmtWhen('2026-11-03T02:10:00Z', 'America/Bogota')).toBe('Hoy 21:10');
    expect(fmtWhen('2026-11-02T02:10:00Z', 'America/Bogota')).toBe('Ayer 21:10');
    expect(fmtWhen('2026-11-03T02:10:00Z', 'Asia/Tokyo')).toBe('Hoy 11:10');
    expect(fmtWhen('2026-11-02T02:10:00Z', 'Asia/Tokyo')).toBe('Ayer 11:10');
  });

  it('addDays cruza meses y el cambio de horario sin saltarse días', () => {
    expect(addDays('2026-11-01', -1, 'America/Bogota')).toBe('2026-10-31');
    expect(addDays('2026-03-08', 1, 'America/New_York')).toBe('2026-03-09');
    expect(addDays('2026-11-01', 1, 'America/New_York')).toBe('2026-11-02'); // fin de horario de verano (día de 25 h)
  });
});
