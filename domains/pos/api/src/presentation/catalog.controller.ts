import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Put, UseFilters } from '@nestjs/common';
import type { RequestActor } from '@modivara/core-contracts';
import {
  createSellableItemSchema, formatScaled, MONEY_SCALE, POS_API_PATHS as P, posSettingsSchema, type PosSettingsDto, type SellableItemDto,
  updateSellableItemSchema,
} from '@modivara/pos-contracts';
import {
  CreateSellableItem, DeactivateSellableItem, GetPosSettings, ListSellableItems, UpdatePosSettings, UpdateSellableItem,
} from '../application/index.js';
import type { SellableItem } from '../domain/sellable-item.js';
import { contextOf, CurrentActor, idOf, RequireModule, RequirePermission } from './decorators.js';
import { PosErrorFilter } from './pos-error.filter.js';

/** Montos como texto decimal exacto: un bigint nunca llega a JSON. */
const toItem = (i: SellableItem): SellableItemDto => ({
  id: i.id, name: i.name, sku: i.sku, category: i.category, unit: i.unit, price: formatScaled(i.price, MONEY_SCALE), currency: i.currency, active: i.isActive,
});

// Leer catálogo y ajustes lo necesita quien vende (sales.read); cambiarlos exige catalog.manage (POS-001 §7).
@Controller()
@UseFilters(PosErrorFilter)
@RequireModule('pos')
export class CatalogController {
  constructor(
    @Inject(ListSellableItems) private readonly listItems: ListSellableItems,
    @Inject(CreateSellableItem) private readonly createItem: CreateSellableItem,
    @Inject(UpdateSellableItem) private readonly updateItem: UpdateSellableItem,
    @Inject(DeactivateSellableItem) private readonly deactivateItem: DeactivateSellableItem,
    @Inject(GetPosSettings) private readonly getSettings: GetPosSettings,
    @Inject(UpdatePosSettings) private readonly updateSettings: UpdatePosSettings,
  ) {}

  @Get(P.items)
  @RequirePermission('pos.sales.read')
  async items(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string): Promise<SellableItemDto[]> {
    return (await this.listItems.execute(contextOf(actor, locationId))).map(toItem);
  }

  @Post(P.items)
  @RequirePermission('pos.catalog.manage')
  async addItem(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Body() body: unknown): Promise<SellableItemDto> {
    return toItem(await this.createItem.execute({ ...contextOf(actor, locationId), ...createSellableItemSchema.parse(body) }));
  }

  @Patch(P.item)
  @RequirePermission('pos.catalog.manage')
  async editItem(
    @CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Param('itemId') itemId: string, @Body() body: unknown,
  ): Promise<SellableItemDto> {
    const changes = updateSellableItemSchema.parse(body);
    return toItem(await this.updateItem.execute({ ...contextOf(actor, locationId), id: idOf(itemId), changes }));
  }

  @Post(P.itemDeactivate)
  @HttpCode(204)
  @RequirePermission('pos.catalog.manage')
  async removeItem(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Param('itemId') itemId: string): Promise<void> {
    await this.deactivateItem.execute({ ...contextOf(actor, locationId), id: idOf(itemId) });
  }

  @Get(P.settings)
  @RequirePermission('pos.sales.read')
  async settings(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string): Promise<PosSettingsDto> {
    return this.getSettings.execute(contextOf(actor, locationId));
  }

  @Put(P.settings)
  @RequirePermission('pos.catalog.manage')
  async saveSettings(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Body() body: unknown): Promise<PosSettingsDto> {
    return this.updateSettings.execute({ ...contextOf(actor, locationId), ...posSettingsSchema.parse(body) });
  }
}
