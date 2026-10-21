import { z } from 'zod';

/**
 * API de configuración de hospitality bajo `/api/v1` (PLAN-001 F2-05…F2-07). Compartida por la API y el portal.
 * Las rutas por local llevan `:locationId` para que el guard de permisos verifique ESE local.
 */
export const HOSPITALITY_API_PATHS = {
  zones: '/locations/:locationId/zones',
  zone: '/locations/:locationId/zones/:zoneId',
  zoneDeactivate: '/locations/:locationId/zones/:zoneId/deactivate',
  tables: '/locations/:locationId/tables',
  table: '/locations/:locationId/tables/:tableId',
  tableDeactivate: '/locations/:locationId/tables/:tableId/deactivate',
  /** Admin y staff: ¿cada mesa tiene botón? y conectividad del local. Sin datos técnicos. */
  deviceStatus: '/locations/:locationId/device-status',
  // Plataforma (solo superadmin, permisos platform.*).
  platformGateways: '/platform/locations/:locationId/gateways',
  platformDevices: '/platform/locations/:locationId/devices',
  platformUnknownDevices: '/platform/locations/:locationId/unknown-devices',
  platformAssignDevice: '/platform/locations/:locationId/devices/:deviceId/assign',
  platformUnassignDevice: '/platform/locations/:locationId/devices/:deviceId/unassign',
} as const;

// OPEN: longitudes máximas (nombre 60, etiqueta 30) y rango de position no están en los documentos.
const name = z.string().trim().min(1).max(60);
const label = z.string().trim().min(1).max(30);
const position = z.number().int().min(0).max(10_000);

export const createZoneSchema = z.object({ name, position: position.optional() });
export const updateZoneSchema = z.object({ name: name.optional(), position: position.optional() }).refine((v) => Object.keys(v).length > 0, 'empty_update');
export const zoneSchema = z.object({ id: z.uuid(), name: z.string(), position: z.number().int() });

export const createTableSchema = z.object({ label, zone_id: z.uuid().nullable().optional(), position: position.optional() });
export const updateTableSchema = z
  .object({ label: label.optional(), zone_id: z.uuid().nullable().optional(), position: position.optional() })
  .refine((v) => Object.keys(v).length > 0, 'empty_update');
export const tableSchema = z.object({
  id: z.uuid(),
  label: z.string(),
  zone_id: z.uuid().nullable(),
  zone_name: z.string().nullable(),
  /** "Terraza · Mesa 3" con zona, o solo la etiqueta (TECH-001 §16.4). */
  display_name: z.string(),
  position: z.number().int(),
});

export const CONNECTIVITY_STATUSES = ['no_gateways', 'all_connected', 'some_disconnected'] as const;

/** Estado visible para admin/staff (DATA-001 §2 `hospitality.devices.status`): nunca códigos, claves ni ids técnicos. */
export const deviceStatusSchema = z.object({
  connectivity: z.enum(CONNECTIVITY_STATUSES),
  tables: z.array(z.object({ table_id: z.uuid(), has_button: z.boolean() })),
});

export const createGatewaySchema = z.object({ name });
/** La clave en claro se devuelve UNA sola vez al crearla; la base guarda su SHA-256 (DATA-001 §3). */
export const gatewayCreatedSchema = z.object({ id: z.uuid(), name: z.string(), key: z.string().min(32) });
export const gatewaySchema = z.object({ id: z.uuid(), name: z.string(), last_seen_at: z.iso.datetime({ offset: true }).nullable(), connected: z.boolean() });

export const createDeviceSchema = z.object({ code: z.string().trim().min(1).max(64), model: z.string().trim().max(64).optional() });
export const deviceSchema = z.object({ id: z.uuid(), code: z.string(), model: z.string().nullable(), table_id: z.uuid().nullable() });
export const assignDeviceSchema = z.object({ table_id: z.uuid() });
export const unknownDeviceSchema = z.object({
  device_code: z.string(),
  first_seen_at: z.iso.datetime({ offset: true }),
  last_seen_at: z.iso.datetime({ offset: true }),
  count: z.number().int().positive(),
});

export type ZoneDto = z.infer<typeof zoneSchema>;
export type TableDto = z.infer<typeof tableSchema>;
export type DeviceStatusDto = z.infer<typeof deviceStatusSchema>;
export type GatewayDto = z.infer<typeof gatewaySchema>;
export type GatewayCreatedDto = z.infer<typeof gatewayCreatedSchema>;
export type DeviceDto = z.infer<typeof deviceSchema>;
export type UnknownDeviceDto = z.infer<typeof unknownDeviceSchema>;
