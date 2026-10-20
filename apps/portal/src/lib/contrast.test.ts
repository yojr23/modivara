// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

function vars(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const block = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
}

const light = vars(':root');
const dark = { ...light, ...vars("[data-theme='dark']") };

// Texto sobre fondo: ≥ 4.5:1
const text: [string, string][] = [
  ['fg', 'bg'], ['fg', 'surface'], ['fg', 'sunken'],
  ['fg-muted', 'bg'], ['fg-muted', 'surface'], ['fg-muted', 'sunken'],
  ['link', 'bg'], ['link', 'surface'],
  ['primary-fg', 'primary'], ['primary-fg', 'primary-hover'],
  ['pending-fg', 'pending'], ['attending-fg', 'attending'],
  ['done-fg', 'done'], ['danger-fg', 'danger'],
];
// Componentes no textuales: ≥ 3:1
const ui: [string, string][] = [
  ['border-strong', 'bg'], ['border-strong', 'surface'],
  ['focus', 'bg'], ['focus', 'surface'],
];

describe.each([['claro', light], ['oscuro', dark]] as const)('tema %s', (_n, t) => {
  it.each(text)('texto %s sobre %s ≥ 4.5', (fg, bg) => {
    expect(contrastRatio(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(ui)('componente %s sobre %s ≥ 3', (a, b) => {
    expect(contrastRatio(t[a]!, t[b]!)).toBeGreaterThanOrEqual(3);
  });
});

it('contrastRatio: negro/blanco = 21', () => {
  expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
});
