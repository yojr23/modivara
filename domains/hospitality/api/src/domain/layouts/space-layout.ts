import { newId } from '@modivara/core-contracts';
import { LAYOUT_LABEL_MAX, LAYOUT_MAX_CANVAS, LAYOUT_MAX_ELEMENTS, type LayoutElement } from '@modivara/hospitality-contracts';
import { InvalidStateError, ValidationError } from '../errors.js';

export type LayoutStatus = 'draft' | 'published' | 'archived';

export interface LayoutContent {
  canvasWidth: number;
  canvasHeight: number;
  elements: LayoutElement[];
}

export interface SpaceLayoutProps extends LayoutContent {
  id: string;
  organizationId: string;
  locationId: string;
  /** null = espacio por defecto del local. */
  zoneId: string | null;
  /** 0 mientras es borrador. */
  version: number;
  status: LayoutStatus;
  revision: number;
  createdAt: Date;
  createdBy: string | null;
  updatedAt: Date;
  updatedBy: string | null;
  publishedAt: Date | null;
  publishedBy: string | null;
}

const finite = (...n: number[]) => n.every(Number.isFinite);

/** Reglas de forma del plano que no dependen de otras tablas. Las superposiciones NO se validan (la UI advierte). */
export function validateLayoutContent({ canvasWidth, canvasHeight, elements }: LayoutContent): void {
  for (const side of [canvasWidth, canvasHeight]) {
    if (!Number.isInteger(side) || side < 1 || side > LAYOUT_MAX_CANVAS) throw new ValidationError(`Canvas sides must be integers between 1 and ${LAYOUT_MAX_CANVAS}`);
  }
  if (elements.length > LAYOUT_MAX_ELEMENTS) throw new ValidationError(`A layout holds at most ${LAYOUT_MAX_ELEMENTS} elements`);
  const ids = new Set<string>();
  const tableIds = new Set<string>();
  for (const el of elements) {
    if (ids.has(el.id)) throw new ValidationError('Duplicate element id');
    ids.add(el.id);
    if (!finite(el.x, el.y, el.rotation) || el.rotation < 0 || el.rotation >= 360) throw new ValidationError('Element position or rotation is invalid');
    // Punto de anclaje dentro del lienzo (basta con eso).
    if (el.x < 0 || el.x > canvasWidth || el.y < 0 || el.y > canvasHeight) throw new ValidationError('Element lies outside the canvas');
    if (el.type === 'label') {
      if (el.text.length > LAYOUT_LABEL_MAX) throw new ValidationError(`Label text is at most ${LAYOUT_LABEL_MAX} characters`);
      continue;
    }
    if (!finite(el.width, el.height) || el.width <= 0 || el.height <= 0) throw new ValidationError('Element size must be positive');
    if (el.type === 'area' && (!el.name.trim() || el.name.length > LAYOUT_LABEL_MAX)) throw new ValidationError(`Area name is 1 to ${LAYOUT_LABEL_MAX} characters`);
    if (el.type === 'table') {
      if (tableIds.has(el.table_id)) throw new ValidationError('A table appears twice in the layout');
      tableIds.add(el.table_id);
    }
  }
}

export class SpaceLayout {
  private constructor(private readonly props: SpaceLayoutProps) {}

  static createDraft(input: LayoutContent & { organizationId: string; locationId: string; zoneId: string | null; createdBy: string; now: Date }): SpaceLayout {
    validateLayoutContent(input);
    return new SpaceLayout({
      id: newId(),
      organizationId: input.organizationId,
      locationId: input.locationId,
      zoneId: input.zoneId,
      version: 0,
      status: 'draft',
      canvasWidth: input.canvasWidth,
      canvasHeight: input.canvasHeight,
      elements: input.elements,
      revision: 1,
      createdAt: input.now,
      createdBy: input.createdBy,
      updatedAt: input.now,
      updatedBy: input.createdBy,
      publishedAt: null,
      publishedBy: null,
    });
  }

  static restore(props: SpaceLayoutProps): SpaceLayout {
    return new SpaceLayout({ ...props });
  }

  get id() { return this.props.id; }
  get organizationId() { return this.props.organizationId; }
  get locationId() { return this.props.locationId; }
  get zoneId() { return this.props.zoneId; }
  get version() { return this.props.version; }
  get status() { return this.props.status; }
  get revision() { return this.props.revision; }
  get elements() { return this.props.elements; }

  /** Ids de las mesas dibujadas. */
  get tableIds(): string[] {
    return this.props.elements.flatMap((e) => (e.type === 'table' ? [e.table_id] : []));
  }

  /** Reemplaza el contenido del borrador y sube la revisión. */
  replaceContent(content: LayoutContent, by: string, now: Date): void {
    if (this.props.status !== 'draft') throw new InvalidStateError('Only a draft can be edited');
    validateLayoutContent(content);
    Object.assign(this.props, content, { revision: this.props.revision + 1, updatedAt: now, updatedBy: by });
  }

  /** Copia con otro conjunto de elementos (lectura filtrada de un publicado); no se persiste. */
  withElements(elements: LayoutElement[]): SpaceLayout {
    return new SpaceLayout({ ...this.props, elements });
  }

  publish(version: number, by: string, now: Date): void {
    if (this.props.status !== 'draft') throw new InvalidStateError('Only a draft can be published');
    Object.assign(this.props, { status: 'published', version, publishedAt: now, publishedBy: by, updatedAt: now, updatedBy: by });
  }

  toProps(): SpaceLayoutProps { return { ...this.props, elements: [...this.props.elements] }; }
}
