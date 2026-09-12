// Synthetic values only. Explicit values override .env.local in Next processes.
export const testEnvironment = {
  NODE_ENV: "production",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3100",
  DATABASE_URL: "postgresql://invalid:invalid@127.0.0.1:1/pmu_test",
  BETTER_AUTH_URL: "http://127.0.0.1:3100",
  BETTER_AUTH_SECRET: "test-only-not-a-deployment-secret-123456789",
  CLOUDINARY_CLOUD_NAME: "test-only",
  CLOUDINARY_API_KEY: "test-only",
  CLOUDINARY_API_SECRET: "test-only",
  NEXT_TELEMETRY_DISABLED: "1",
};
