import { CONTEXT_LABEL_MAX } from '@modivara/pos-contracts';
import { describe, expect, it } from 'vitest';
import { tableContextLabel } from './hospitality-pos.js';

describe('tableContextLabel', () => {
  it('antepone la zona y acorta la zona, nunca la mesa, si no cabe', () => {
    expect(tableContextLabel('Mesa 3', null)).toBe('Mesa 3');
    expect(tableContextLabel('5', 'Terraza')).toBe('Terraza · 5');
    const long = tableContextLabel('Mesa 30 junto a la ventana grande', 'Z'.repeat(60));
    expect(long).toHaveLength(CONTEXT_LABEL_MAX);
    expect(long.endsWith(' · Mesa 30 junto a la ventana grande')).toBe(true);
  });
});
