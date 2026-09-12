export function assertTestDatabaseUrl(value: string | undefined): string {
  if (!value) throw new Error("TEST_DATABASE_URL is required for PostgreSQL tests");
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      !/^\/pmu_test(?:_[a-z0-9_]+)?$/.test(url.pathname) || url.search || url.hash) {
    throw new Error("Tests require a loopback PostgreSQL URL with a pmu_test database and no query options");
  }
  return value;
}
