import { MODULES, ValidationError, type ModuleName } from '@modivara/core-contracts';

export interface EntitlementProps {
  organizationId: string;
  module: ModuleName;
  enabled: boolean;
}

export class Entitlement {
  private constructor(private props: EntitlementProps) {}

  static create(input: { organizationId: string; module: string; enabled?: boolean }): Entitlement {
    if (!(MODULES as readonly string[]).includes(input.module)) throw new ValidationError(`Unknown module: ${input.module}`);
    return new Entitlement({ organizationId: input.organizationId, module: input.module as ModuleName, enabled: input.enabled ?? true });
  }

  static restore(props: EntitlementProps): Entitlement {
    return new Entitlement({ ...props });
  }

  get organizationId() { return this.props.organizationId; }
  get module() { return this.props.module; }
  get enabled() { return this.props.enabled; }

  setEnabled(enabled: boolean): void {
    this.props.enabled = enabled;
  }
}
