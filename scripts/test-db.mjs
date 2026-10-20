// URLs de la base de pruebas (servicio db-test, perfil "test" de docker-compose.yml). Un rol por dominio.
export const TEST_DB_PORT = 55432;
export const testDatabaseUrl = (domain) =>
  `postgresql://${domain}_app:test@127.0.0.1:${TEST_DB_PORT}/modivara_test?schema=${domain}`;
