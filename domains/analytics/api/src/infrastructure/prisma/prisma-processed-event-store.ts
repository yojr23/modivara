import type { ProcessedEventStore } from '../../application/index.js';
import type { Db } from './db.js';

export class PrismaProcessedEventStore implements ProcessedEventStore {
  constructor(private readonly db: Db) {}

  async has(eventId: string): Promise<boolean> {
    return (await this.db.processedEvent.count({ where: { eventId } })) > 0;
  }

  async add(eventId: string, eventType: string): Promise<boolean> {
    // ON CONFLICT DO NOTHING: ante un reclamo concurrente sin confirmar espera a su commit y devuelve 0.
    const { count } = await this.db.processedEvent.createMany({ data: [{ eventId, eventType }], skipDuplicates: true });
    return count === 1;
  }

  async clear(): Promise<void> {
    await this.db.processedEvent.deleteMany();
  }
}
