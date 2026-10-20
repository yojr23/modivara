import { describe, expect, it } from 'vitest';
import {
  customerSlugSchema,
  loginRequestSchema,
  loginResponseSchema,
  passwordSchema,
  RESERVED_SLUGS,
  sessionActorSchema,
  slugSchema,
  usernameSchema,
} from './identity.js';

const uuid = '0197c0de-0000-7000-8000-000000000001';

describe('passwordSchema', () => {
  it.each(['Abcdefg1', 'Zzzzzzz9zz'])('acepta %s', (p) => expect(passwordSchema.safeParse(p).success).toBe(true));
  it.each(['Abcde1', 'abcdefg1', 'Abcdefgh', '', 'A1' + 'x'.repeat(200)])('rechaza %s', (p) =>
    expect(passwordSchema.safeParse(p).success).toBe(false),
  );
});

describe('usernameSchema', () => {
  it('normaliza a minúsculas y recorta', () => expect(usernameSchema.parse('  Maria.Lopez ')).toBe('maria.lopez'));
  it.each(['ab', 'a'.repeat(33), 'con espacio', 'ñandú'])('rechaza %s', (u) =>
    expect(usernameSchema.safeParse(u).success).toBe(false),
  );
});

describe('slugSchema y customerSlugSchema', () => {
  it('acepta slugs válidos y normaliza', () => expect(slugSchema.parse('Bar-El-Sol')).toBe('bar-el-sol'));
  it.each(['ab', '-bar', 'bar-', 'bar--sol', 'bar_sol', 'a'.repeat(41)])('rechaza %s', (s) =>
    expect(slugSchema.safeParse(s).success).toBe(false),
  );
  it('slugSchema acepta reservados (el login a labs es legítimo)', () => expect(slugSchema.safeParse('labs').success).toBe(true));
  it.each(RESERVED_SLUGS)('customerSlugSchema rechaza el reservado %s', (s) =>
    expect(customerSlugSchema.safeParse(s).success).toBe(false),
  );
  it('customerSlugSchema acepta uno normal', () => expect(customerSlugSchema.safeParse('bar-sol').success).toBe(true));
});

describe('DTOs', () => {
  it('login normaliza slug y username', () => {
    expect(loginRequestSchema.parse({ slug: 'Bar-Sol', username: 'ANA', password: 'x' })).toEqual({
      slug: 'bar-sol',
      username: 'ana',
      password: 'x',
    });
  });
  it('login no aplica la política de contraseña pero exige no vacía', () => {
    expect(loginRequestSchema.safeParse({ slug: 'bar-sol', username: 'ana', password: '' }).success).toBe(false);
  });
  it('el actor no admite campos sensibles (se descartan)', () => {
    const actor = sessionActorSchema.parse({
      user_id: uuid,
      organization_id: uuid,
      username: 'ana',
      display_name: 'Ana',
      is_owner: false,
      is_platform: false,
      acting_organization_id: null,
      password_hash: 'secreto',
    });
    expect(actor).not.toHaveProperty('password_hash');
  });
  it('valida la respuesta de login', () => {
    const actor = { user_id: uuid, organization_id: uuid, username: 'ana', display_name: 'Ana', is_owner: true, is_platform: false, acting_organization_id: null };
    expect(loginResponseSchema.safeParse({ actor, expires_at: '2026-11-18T10:00:00Z' }).success).toBe(true);
    expect(loginResponseSchema.safeParse({ actor, expires_at: 'mañana' }).success).toBe(false);
  });
});
