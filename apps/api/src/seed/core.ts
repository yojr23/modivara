import type { INestApplicationContext } from '@nestjs/common';
import {
  BootstrapPlatform, CreateUser, ListUsers, ProvisionOrganization, SetLocationRoles, type ActorContext,
} from '@modivara/core-api';

type Role = 'admin' | 'staff' | 'inventory';
interface BusinessSeed {
  slug: string;
  name: string;
  location: string;
  users: Array<{ username: string; displayName: string; role: Role }>;
}

// DATA-001 §7. OPEN: el documento no fija el username del superadmin, el nombre del local ni los usuarios de bar-demo-pisos
// (se crea `admin` para poder probar el aislamiento H1); tampoco qué módulos contrata cada demo (se habilitan los tres).
const SUPERADMIN = { username: 'superadmin', displayName: 'Superadmin' };
const MODULES = ['hospitality', 'commerce', 'analytics'] as const;
const BUSINESSES: BusinessSeed[] = [
  {
    slug: 'bar-demo', name: 'Bar Demo', location: 'Principal',
    users: [
      { username: 'admin', displayName: 'Administrador', role: 'admin' },
      { username: 'barra', displayName: 'Barra', role: 'staff' },
      { username: 'mesero1', displayName: 'Mesero 1', role: 'staff' },
      { username: 'inventario1', displayName: 'Inventario 1', role: 'inventory' },
    ],
  },
  {
    slug: 'bar-demo-pisos', name: 'Bar Demo Pisos', location: 'Principal',
    users: [{ username: 'admin', displayName: 'Administrador', role: 'admin' }],
  },
];

/**
 * Solo casos de uso públicos de core. Idempotente: repetirlo no cambia el estado ni duplica la auditoría.
 * Solo para desarrollo/demo: usuarios con contraseña común conocida. Los usuarios que ya existieron (también desactivados)
 * no se recrean ni se les tocan los roles: los roles solo se fijan al crear.
 */
export async function seedCore(app: INestApplicationContext, password: string): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed:core se niega a correr con NODE_ENV=production: crea usuarios demo con una contraseña común.');
  }
  const root = await app.get(BootstrapPlatform).execute({ ...SUPERADMIN, password });
  const provision = app.get(ProvisionOrganization);
  const listUsers = app.get(ListUsers);
  const createUser = app.get(CreateUser);
  const setRoles = app.get(SetLocationRoles);

  for (const b of BUSINESSES) {
    const { organization, locations } = await provision.execute({
      actor: root, slug: b.slug, name: b.name, locations: [{ name: b.location }], modules: MODULES,
    });
    const actor: ActorContext = { ...root, actingOrganizationId: organization.id };
    const existing = await listUsers.execute({ actor, includeInactive: true });
    for (const u of b.users) {
      if (existing.some((e) => e.username === u.username)) continue;
      const user = await createUser.execute({ actor, username: u.username, displayName: u.displayName, password });
      await setRoles.execute({ actor, userId: user.id, locationId: locations[0]!.id, roles: [u.role] });
    }
  }
}
