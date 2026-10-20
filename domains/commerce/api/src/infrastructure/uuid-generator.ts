import { randomUUID } from 'node:crypto';
import type { IdGenerator } from '../application/ports/id-generator.port.js';

// OPEN: DATA-001 usa uuidv7() en BD; aquí uuid v4 de Node. ¿Generar v7 en la app o dejar el DEFAULT de la BD?
export class UuidGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}
