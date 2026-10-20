import { isReservedSlug, isValidSlug } from '@modivara/core-contracts';
import { InvalidValueError } from './errors.js';

export interface OrganizationProps {
  id: string;
  slug: string;
  name: string;
  isPlatform: boolean;
  deactivatedAt: Date | null;
}

export class Organization {
  private constructor(private props: OrganizationProps) {}

  static create(input: { id: string; slug: string; name: string; isPlatform?: boolean }): Organization {
    const isPlatform = input.isPlatform ?? false;
    const slug = input.slug;
    // El slug no se normaliza aquí: debe llegar ya en su forma canónica.
    if (!isValidSlug(slug)) {
      throw new InvalidValueError(`Invalid slug: ${slug}`);
    }
    if (!isPlatform && isReservedSlug(slug)) {
      throw new InvalidValueError(`Reserved slug: ${slug}`);
    }
    const name = input.name.trim();
    if (!name) throw new InvalidValueError('Organization name is required');
    return new Organization({ id: input.id, slug, name, isPlatform, deactivatedAt: null });
  }

  static restore(props: OrganizationProps): Organization {
    return new Organization({ ...props });
  }

  get id() { return this.props.id; }
  get slug() { return this.props.slug; }
  get name() { return this.props.name; }
  get isPlatform() { return this.props.isPlatform; }
  get deactivatedAt() { return this.props.deactivatedAt; }
  get isActive() { return this.props.deactivatedAt === null; }

  deactivate(now: Date): void {
    this.props.deactivatedAt ??= now;
  }
}
