// Superficie pública: módulo, casos de uso, tipos de puertos y el adaptador de pulsación.
// Las entidades y demás internos de domain/ e infrastructure/ no se exportan.
export { HospitalityModule } from './hospitality.module.js';

export { AcknowledgeCall, type CallActionInput } from './application/acknowledge-call.js';
export { CompleteCall } from './application/complete-call.js';
export { AssignDevice, ListUnknownDevices, RegisterDevice, UnassignDevice, type UnknownDevice } from './application/devices.js';
export { CreateGateway, type ConnectivityStatus, GetConnectivity, type GatewayConnectivity, RecordHeartbeat } from './application/gateways.js';
export { type ActiveCallView, ListActiveCalls } from './application/list-active-calls.js';
export { RegisterButtonPress } from './application/register-button-press.js';
export { type ActorContext, type PermittedContext, type TenantContext } from './application/support.js';
export { CreateTable, CreateZone, DeactivateTable, RenameTable } from './application/zones-and-tables.js';

export type {
  ButtonPressStore,
  ButtonPressTx,
  CallChange,
  ById,
  DeviceAssignmentRepository,
  DeviceEventRepository,
  DeviceRepository,
  DiningTableRepository,
  GatewayRepository,
  IoTInputPort,
  NormalizedPress,
  NotificationPort,
  PressOutcome,
  Scope,
  ServiceCallRepository,
  UnknownDeviceCode,
  ZoneRepository,
} from './application/ports/index.js';

export { ButtonSignalTranslator, GatewayPressAdapter, InvalidGatewayKeyError, type KeyMap } from './infrastructure/gateway-press.adapter.js';
