type Raw = { $executeRawUnsafe(sql: string): Promise<unknown> };

/** Deja vacías las bases de core y hospitality (db-test es compartida). */
export async function resetBoth(app: { get<T>(token: string): T }) {
  await app.get<Raw>('CORE_PRISMA').$executeRawUnsafe('TRUNCATE audit_log, entitlements, sessions, location_memberships, app_users, locations, organizations CASCADE');
  await app.get<Raw>('HOSPITALITY_PRISMA').$executeRawUnsafe(
    'TRUNCATE outbox_events, device_events, service_call_transitions, service_calls, device_assignments, devices, gateways, dining_tables, zones, location_settings CASCADE',
  );
}

