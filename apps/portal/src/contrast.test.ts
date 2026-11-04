import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// UX-11 — razón de contraste WCAG 2.x de los pares texto/fondo y UI/fondo que usa el portal, leída de los tokens de index.css.
const css = readFileSync(resolve(import.meta.dirname, 'index.css'), 'utf8');

function tokens(selector: string): Record<string, string> {
  const block = css.split(selector + ' {')[1]!.split('}')[0]!;
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1]!, m[2]!]));
}
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

// [primer plano, fondo, mínimo]: 4.5 texto normal; 3 UI, foco y trazos que son el único indicador.
const TEXT: [string, string][] = [
  ['fg', 'bg'], ['fg', 'surface'], ['fg', 'sunken'],
  ['fg-muted', 'bg'], ['fg-muted', 'surface'], ['fg-muted', 'sunken'],
  ['link', 'bg'], ['link', 'surface'],
  ['primary-fg', 'primary'], ['primary-fg', 'primary-hover'],
  ['pending-fg', 'pending'], ['attending-fg', 'attending'], ['danger-fg', 'danger'], ['done-fg', 'done'],
  ['danger', 'surface'], ['danger', 'bg'], ['danger', 'sunken'],
];
const UI: [string, string][] = [
  ['focus', 'bg'], ['focus', 'surface'], ['focus', 'sunken'],
  ['border-strong', 'surface'], ['border-strong', 'bg'],
  ['pending-line', 'surface'], ['pending-line', 'bg'], ['attending', 'surface'], ['danger', 'surface'],
  // `primary` sobre superficie queda fuera a propósito: el botón se identifica por su texto (1.4.11), y su texto sí se mide arriba.
];

describe.each([[':root'], ["[data-theme='dark']"]])('contraste %s', (sel) => {
  const t = { ...tokens(':root'), ...(sel === ':root' ? {} : tokens(sel)) };
  it.each(TEXT)('texto %s sobre %s ≥ 4.5', (fg, bg) => expect(ratio(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5));
  it.each(UI)('UI/foco %s sobre %s ≥ 3', (fg, bg) => expect(ratio(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(3));
});
