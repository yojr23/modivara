import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, UseFilters } from '@nestjs/common';
import type { RequestActor } from '@modivara/core-contracts';
import {
  COMMERCE_API_PATHS as P, createProductSchema, createStockLocationSchema, type ProductDto, type StockLocationDto, updateProductSchema,
} from '@modivara/commerce-contracts';
import {
  CreateProduct, CreateStockLocation, DeactivateProduct, ListProducts, ListStockLocations, UpdateProduct,
} from '../application/index.js';
import type { Product } from '../domain/product.js';
import type { StockLocation } from '../domain/stock-location.js';
import { CommerceErrorFilter } from './commerce-error.filter.js';
import { contextOf, CurrentActor, idOf, RequireModule, RequirePermission } from './decorators.js';

const toProduct = (p: Product): ProductDto => ({ id: p.id, name: p.name, sku: p.sku, category: p.category, unit: p.unit, active: p.isActive });
const toStockLocation = (s: StockLocation): StockLocationDto => ({ id: s.id, name: s.name, is_default: s.isDefault, active: s.isActive });

// Leer el catálogo lo necesita quien registra movimientos (stock.read); escribirlo exige catalog.manage.
@Controller()
@UseFilters(CommerceErrorFilter)
@RequireModule('commerce')
export class CatalogController {
  constructor(
    @Inject(ListProducts) private readonly listProducts: ListProducts,
    @Inject(CreateProduct) private readonly createProduct: CreateProduct,
    @Inject(UpdateProduct) private readonly updateProduct: UpdateProduct,
    @Inject(DeactivateProduct) private readonly deactivateProduct: DeactivateProduct,
    @Inject(ListStockLocations) private readonly listStockLocations: ListStockLocations,
    @Inject(CreateStockLocation) private readonly createStockLocation: CreateStockLocation,
  ) {}

  @Get(P.products)
  @RequirePermission('commerce.stock.read')
  async products(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string): Promise<ProductDto[]> {
    return (await this.listProducts.execute(contextOf(actor, locationId))).map(toProduct);
  }

  @Post(P.products)
  @RequirePermission('commerce.catalog.manage')
  async addProduct(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Body() body: unknown): Promise<ProductDto> {
    return toProduct(await this.createProduct.execute({ ...contextOf(actor, locationId), ...createProductSchema.parse(body) }));
  }

  @Patch(P.product)
  @RequirePermission('commerce.catalog.manage')
  async editProduct(
    @CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Param('productId') productId: string, @Body() body: unknown,
  ): Promise<ProductDto> {
    return toProduct(await this.updateProduct.execute({ ...contextOf(actor, locationId), productId: idOf(productId), ...updateProductSchema.parse(body) }));
  }

  @Post(P.productDeactivate)
  @HttpCode(204)
  @RequirePermission('commerce.catalog.manage')
  async removeProduct(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Param('productId') productId: string): Promise<void> {
    await this.deactivateProduct.execute({ ...contextOf(actor, locationId), productId: idOf(productId) });
  }

  @Get(P.stockLocations)
  @RequirePermission('commerce.stock.read')
  async stockLocations(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string): Promise<StockLocationDto[]> {
    return (await this.listStockLocations.execute(contextOf(actor, locationId))).map(toStockLocation);
  }

  @Post(P.stockLocations)
  @RequirePermission('commerce.catalog.manage')
  async addStockLocation(@CurrentActor() actor: RequestActor, @Param('locationId') locationId: string, @Body() body: unknown): Promise<StockLocationDto> {
    return toStockLocation(await this.createStockLocation.execute({ ...contextOf(actor, locationId), ...createStockLocationSchema.parse(body) }));
  }
}
