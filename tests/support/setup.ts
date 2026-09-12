import { vi } from "vitest";

// Never load .env.local or fall back to an application database in test code.
process.env.DATABASE_URL = "postgresql://invalid:invalid@127.0.0.1:1/pmu_test";
process.env.NEXT_PUBLIC_APP_URL = "http://127.0.0.1:3100";
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3100";
process.env.BETTER_AUTH_SECRET = "test-only-not-a-deployment-secret-123456789";
process.env.CLOUDINARY_CLOUD_NAME = "test-only";
process.env.CLOUDINARY_API_KEY = "test-only";
process.env.CLOUDINARY_API_SECRET = "test-only";

// Fail closed on accidental HTTP calls; suites must explicitly mock the adapter.
vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("External HTTP disabled in tests"))));
vi.mock("@/lib/cloudinary", () => ({
  uploadToCloudinary: vi.fn(() => Promise.reject(new Error("Configure an upload mock"))),
  deleteFromCloudinary: vi.fn(() => Promise.reject(new Error("Configure a deletion mock"))),
}));
