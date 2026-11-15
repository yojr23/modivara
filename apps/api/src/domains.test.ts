import { describe, expect, it } from 'vitest';
import { DOMAIN_NAMES, selectedDomains } from './domains.js';

describe('MODIVARA_DOMAINS', () => {
  it('sin definir o vacío: todos; con lista: esos, sin duplicados y en orden fijo', () => {
    expect(selectedDomains(undefined)).toEqual(['hospitality', 'commerce', 'analytics', 'pos']);
    expect(selectedDomains(' ')).toEqual(DOMAIN_NAMES);
    expect(selectedDomains('analytics, commerce,commerce')).toEqual(['commerce', 'analytics']);
  });

  it('un nombre desconocido falla con un mensaje claro (core no se elige: va siempre)', () => {
    expect(() => selectedDomains('commerce,caja')).toThrow('MODIVARA_DOMAINS: dominio desconocido "caja". Válidos: hospitality, commerce, analytics, pos (core va siempre).');
    expect(() => selectedDomains('core')).toThrow(/desconocido "core"/);
  });
});
