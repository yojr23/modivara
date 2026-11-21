import type { DynamicModule } from '@nestjs/common';
import { AnalyticsModule } from '@modivara/analytics-api';
import { CommerceModule } from '@modivara/commerce-api';
import { HospitalityModule } from '@modivara/hospitality-api';

/**
 * Dominios opcionales que compone un host, por su nombre en `MODIVARA_DOMAINS` (core va siempre). `standalone`: sin pollers de
 * outbox ni MQTT, para comandos como `analytics:rebuild`. Sumar un dominio (p. ej. `pos`) = una entrada aquí.
 */
const DOMAIN_MODULES = {
  hospitality: (standalone: boolean) => HospitalityModule.forRoot(standalone ? { outbox: false, mqtt: null } : {}),
  commerce: (standalone: boolean) => CommerceModule.forRoot(standalone ? { outbox: false } : {}),
  analytics: () => AnalyticsModule.forRoot(),
} satisfies Record<string, (standalone: boolean) => DynamicModule>;

export type DomainName = keyof typeof DOMAIN_MODULES;
export const DOMAIN_NAMES = Object.keys(DOMAIN_MODULES) as DomainName[];

/**
 * `MODIVARA_DOMAINS=commerce,analytics` → esos dominios. Sin definir o vacío → todos (los despliegues actuales no cambian).
 * Un nombre desconocido detiene el arranque con un mensaje claro, en vez de un host sin el producto que se esperaba.
 */
export function selectedDomains(value = process.env.MODIVARA_DOMAINS): DomainName[] {
  const names = (value ?? '').split(',').map((n) => n.trim()).filter(Boolean);
  if (!names.length) return [...DOMAIN_NAMES];
  const unknown = names.filter((n) => !(DOMAIN_NAMES as string[]).includes(n));
  if (unknown.length) {
    throw new Error(`MODIVARA_DOMAINS: dominio desconocido ${unknown.map((n) => `"${n}"`).join(', ')}. Válidos: ${DOMAIN_NAMES.join(', ')} (core va siempre).`);
  }
  return DOMAIN_NAMES.filter((n) => names.includes(n));
}

/** Los módulos Nest de los dominios dados (cada uno lee sus variables de entorno; los ausentes no las piden). */
export const domainModules = (names: readonly DomainName[], standalone = false): DynamicModule[] =>
  names.map((n) => DOMAIN_MODULES[n](standalone));
