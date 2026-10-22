import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ButtonSignalTranslator } from './key-map.js';

describe('ButtonSignalTranslator', () => {
  const t = new ButtonSignalTranslator({ 'MODEL-X': { A: 'attention' } });

  it('usa el mapa del modelo', () => {
    expect(t.translate('MODEL-X', 'A')).toBe('attention');
  });

  // OPEN (Q-08): hoy una tecla no mapeada es `attention`; si se decide rechazarla, esta prueba cambia.
  it('tecla desconocida, modelo desconocido o sin tecla: attention por defecto', () => {
    expect(t.translate('MODEL-X', 'Z')).toBe('attention');
    expect(t.translate('OTRO', 'A')).toBe('attention');
    expect(t.translate('MODEL-X', null)).toBe('attention');
    expect(t.translate(null, null)).toBe('attention');
    expect(new ButtonSignalTranslator().translate('MODEL-X', 'A')).toBe('attention');
  });

  it('el dominio no importa el mapa', () => {
    const dir = new URL('../../domain/', import.meta.url);
    const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'));
    for (const f of files) expect(readFileSync(new URL(f, dir), 'utf8')).not.toMatch(/key-map|ButtonSignalTranslator/);
  });
});
