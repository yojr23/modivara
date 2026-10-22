import type { CallType } from '@modivara/hospitality-contracts';

export type KeyMap = Readonly<Record<string, CallType>>;

/** Un mapa tecla -> tipo por `devices.model` (ADR-002 D4). Piloto: un único tipo, `attention`; ningún modelo declara teclas aún. */
export const KEY_MAPS: Readonly<Record<string, KeyMap>> = {};

/** El mapa vive en infraestructura: el dominio no lo importa ni conoce teclas. */
export class ButtonSignalTranslator {
  constructor(private readonly mapsByModel: Readonly<Record<string, KeyMap>> = KEY_MAPS) {}

  translate(model: string | null, buttonKey: string | null): CallType {
    return (model && buttonKey ? this.mapsByModel[model]?.[buttonKey] : undefined) ?? this.unmapped(model, buttonKey);
  }

  // OPEN (PLAN-001 Q-08): ¿una tecla no mapeada se trata como `attention` o se descarta como desconocida? Sin decidir: `attention`
  // (lo más fácil de revertir: nunca se pierde una llamada). Para descartar, lanzar aquí y capturar en el adaptador.
  private unmapped(_model: string | null, _buttonKey: string | null): CallType {
    return 'attention';
  }
}
