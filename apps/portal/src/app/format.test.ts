import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays, agoLabel, bucketLabel, dayKey, dayStart, fmtWhen } from './format';

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

  it('las cubetas de métricas se rotulan en la zona del local, no en la del navegador', () => {
    // Medianoche del 24 oct en Bogotá = 05:00Z; en Tokio ya es la tarde del 24 y en Los Ángeles aún el 23.
    expect(bucketLabel('2026-10-24T05:00:00Z', 'day', 'America/Bogota')).toBe(bucketLabel('2026-10-24T12:00:00Z', 'day', 'UTC'));
    expect(bucketLabel('2026-10-24T05:00:00Z', 'day', 'America/Los_Angeles')).not.toBe(bucketLabel('2026-10-24T05:00:00Z', 'day', 'America/Bogota'));
    expect(bucketLabel('2026-10-25T02:00:00Z', 'hour', 'America/Bogota')).toBe('21 h');
  });

  it('addDays cruza meses y el cambio de horario sin saltarse días', () => {
    expect(addDays('2026-11-01', -1, 'America/Bogota')).toBe('2026-10-31');
    expect(addDays('2026-03-08', 1, 'America/New_York')).toBe('2026-03-09');
    expect(addDays('2026-11-01', 1, 'America/New_York')).toBe('2026-11-02'); // fin de horario de verano (día de 25 h)
  });
});

describe('agoLabel', () => {
  it.each([[40_000, 'hace 40 s'], [5 * 60_000, 'hace 5 min'], [3 * 3600_000, 'hace 3 h'], [2 * 86_400_000, 'hace 2 d'], [-5, 'hace 0 s']])('%i ms', (d, out) => expect(agoLabel(0, d)).toBe(out));
});
