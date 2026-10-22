import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { GATEWAY_HEARTBEAT_INTERVAL_MS } from '@modivara/hospitality-contracts';
import type { DetectGatewayHealthChanges } from '../../application/gateway-health.js';

/** Tarea periódica de F3-11: ejecuta la detección cada `intervalMs` (por defecto, el período del heartbeat). */
export class GatewayHealthMonitor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('GatewayHealthMonitor');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly detect: DetectGatewayHealthChanges,
    private readonly intervalMs: number = GATEWAY_HEARTBEAT_INTERVAL_MS,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref(); // no mantiene vivo el proceso
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    if (this.running) return; // un ciclo lento no se solapa con el siguiente
    this.running = true;
    try {
      await this.detect.execute();
    } catch (e) {
      this.logger.error(`Falló la detección de conectividad: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.running = false;
    }
  }
}
