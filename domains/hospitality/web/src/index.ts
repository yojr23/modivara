export { ApiRequestError, InvalidResponseError, NetworkError, buildPath, hospitalityApi, toErrorState, type ErrorState, type TableInput, type ZoneInput } from './client.js';
export {
  errorState, hospitalityKeys, useCreateTable, useCreateZone, useDeactivateTable, useDeactivateZone,
  useDeviceStatus, useTables, useUpdateTable, useUpdateZone, useZones,
} from './hooks.js';
export * as platform from './platform.js';
