import type { ProcessedEventStore } from '../../application/index.js';
import type { Db } from './db.js';

export class PrismaProcessedEventStore implements ProcessedEventStore {
  constructor(private readonly db: Db) {}

  async has(eventId: string): Promise<boolean> {
    return (await this.db.processedEvent.count({ where: { eventId } })) > 0;
  }

  async add(eventId: string, eventType: string): Promise<void> {
    await this.db.processedEvent.createMany({ data: [{ eventId, eventType }], skipDuplicates: true });
  }

  async clear(): Promise<void> {
    await this.db.processedEvent.deleteMany();
  }
}
