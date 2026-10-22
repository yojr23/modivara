/** Transición de conectividad de un local (no el estado: solo se emite al cambiar). */
export interface GatewayHealthChange {
  organizationId: string;
  locationId: string;
  /** false = «Botones desconectados»; true = «reconectados». */
  connected: boolean;
  disconnectedGatewayIds: string[];
}

/** Aviso a la sala del local (Socket.IO). Un solo aviso por transición. */
export interface GatewayHealthNotifier {
  connectivityChanged(change: GatewayHealthChange): Promise<void>;
}
