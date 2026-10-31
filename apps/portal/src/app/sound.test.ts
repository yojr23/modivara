import { describe, expect, it } from 'vitest';
import { newPendingIds } from './sound';

describe('newPendingIds', () => {
  it('no suena en la primera carga ni con los mismos pendientes; sí con uno nuevo', () => {
    expect(newPendingIds(null, ['a', 'b'])).toEqual([]);
    expect(newPendingIds(new Set(['a', 'b']), ['a', 'b'])).toEqual([]);
    expect(newPendingIds(new Set(['a']), [])).toEqual([]);
    expect(newPendingIds(new Set(['a']), ['a', 'c'])).toEqual(['c']);
  });
});
