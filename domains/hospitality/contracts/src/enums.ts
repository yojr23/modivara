/** Estados de una solicitud (DATA-001 §3). Sin estado de cancelación: requeriría un ADR (ADR-002 D4). */
export const CALL_STATUSES = ['pending', 'in_progress', 'completed'] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

/** Estados en los que la solicitud sigue viva en el tablero. */
export const ACTIVE_CALL_STATUSES = ['pending', 'in_progress'] as const satisfies readonly CallStatus[];

/** Tipos de llamado. En el piloto solo existe `attention` (ADR-002 D4). */
export const CALL_TYPES = ['attention'] as const;
export type CallType = (typeof CALL_TYPES)[number];

export const CALL_ACTIONS = ['create', 'acknowledge', 'complete'] as const;
export type CallAction = (typeof CALL_ACTIONS)[number];

export const CALL_VISIBILITIES = ['all'] as const; // extensión: 'assigned'
export type CallVisibility = (typeof CALL_VISIBILITIES)[number];

export const TRANSPORTS = ['http', 'mqtt'] as const;
export type Transport = (typeof TRANSPORTS)[number];

/** Resultado de procesar una señal de botón (DATA-001 §3, `device_event_result`). */
export const DEVICE_EVENT_RESULTS = ['call_created', 'repeat_press', 'debounced', 'unknown_device', 'unassigned_device'] as const;
export type DeviceEventResult = (typeof DEVICE_EVENT_RESULTS)[number];
