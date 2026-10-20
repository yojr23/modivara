import { MODULES, type ModuleName } from '@modivara/core-contracts';
import { InvalidValueError } from './errors.js';

export class Entitlement {
  private constructor(
    readonly organizationId: string,
    readonly module: ModuleName,
    private _enabled: boolean,
  ) {}

  static create(input: { organizationId: string; module: string; enabled?: boolean }): Entitlement {
    if (!(MODULES as readonly string[]).includes(input.module)) throw new InvalidValueError(`Unknown module: ${input.module}`);
    return new Entitlement(input.organizationId, input.module as ModuleName, input.enabled ?? true);
  }

  static restore(props: { organizationId: string; module: ModuleName; enabled: boolean }): Entitlement {
    return new Entitlement(props.organizationId, props.module, props.enabled);
  }

  get enabled() { return this._enabled; }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
  }
}
