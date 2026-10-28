export { ApiRequestError, InvalidResponseError, NetworkError, buildPath, hospitalityApi, toErrorState, type ErrorState, type TableInput, type ZoneInput } from './client.js';
export {
  errorState, hospitalityKeys, useCreateTable, useCreateZone, useDeactivateTable, useDeactivateZone,
  useDeviceStatus, useTables, useUpdateTable, useUpdateZone, useZones,
} from './hooks.js';
export * as platform from './platform.js';
export { callsApi, toCallConflict, type CallConflict, type CallHistoryQuery } from './calls.js';
export { callsKeys, mergeActive } from './realtime/cache.js';
export { RealtimeClient, defaultSocketFactory, type ConnectionStatus, type RealtimeSocket, type RealtimeState, type SocketFactory } from './realtime/client.js';
export {
  RealtimeProvider, callErrorState, useAcknowledgeCall, useActiveCalls, useCallDetail, useCallHistory, useCompleteCall, useConnectionStatus, useGatewaysStatus,
} from './realtime/hooks.js';
