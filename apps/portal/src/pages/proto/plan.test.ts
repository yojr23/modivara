import { describe, expect, it } from 'vitest';
import { AMBER_MS, RED_MS, toneOf } from './plan';

describe('toneOf', () => {
  it('separa estado real de urgencia visual (ESP-24, ESP-25)', () => {
    expect(toneOf(undefined, 0)).toBe('idle');
    expect(toneOf('pending', AMBER_MS - 1)).toBe('new');
    expect(toneOf('pending', AMBER_MS)).toBe('waiting');
    expect(toneOf('pending', RED_MS)).toBe('late');
    expect(toneOf('in_progress', RED_MS * 3)).toBe('attending');
  });
});
