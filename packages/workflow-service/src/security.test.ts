import { describe, expect, it } from "vitest";

import {
  consumeRateLimit,
  getCanonicalAppOrigin,
  readServerEnv,
  shouldRequireEmailDelivery,
  shouldRequireProcessorSecret,
  shouldRequireStripe,
} from "./index.js";

describe("environment helpers", () => {
  it("normalizes the canonical origin and supports explicit production requirements", () => {
    const env = readServerEnv({
      NODE_ENV: "production",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      SUPABASE_DOCUMENT_BUCKET: "documents",
      SUPABASE_SIGNATURE_BUCKET: "signatures",
      EASYDRAFT_APP_ORIGIN: "https://easydraftdocs.app///",
      EASYDRAFT_REQUIRE_STRIPE: "true",
      EASYDRAFT_REQUIRE_EMAIL_DELIVERY: "true",
    });

    expect(getCanonicalAppOrigin(env)).toBe("https://easydraftdocs.app");
    expect(shouldRequireStripe(env)).toBe(true);
    expect(shouldRequireEmailDelivery(env)).toBe(true);
    expect(shouldRequireProcessorSecret(env)).toBe(true);
  });

  it("keeps stricter requirements off by default in development", () => {
    const env = readServerEnv({
      NODE_ENV: "development",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      SUPABASE_DOCUMENT_BUCKET: "documents",
      SUPABASE_SIGNATURE_BUCKET: "signatures",
      EASYDRAFT_APP_ORIGIN: "http://localhost:5173",
    });

    expect(shouldRequireStripe(env)).toBe(false);
    expect(shouldRequireEmailDelivery(env)).toBe(false);
    expect(shouldRequireProcessorSecret(env)).toBe(false);
  });
});

describe("rate limiting", () => {
  it("allows requests up to the limit and rejects the next one", () => {
    const policy = {
      key: "test:signing",
      limit: 2,
      windowMs: 60_000,
    };

    expect(consumeRateLimit("127.0.0.1", policy, 0).allowed).toBe(true);
    expect(consumeRateLimit("127.0.0.1", policy, 1).allowed).toBe(true);

    const blocked = consumeRateLimit("127.0.0.1", policy, 2);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("resets after the rate-limit window elapses", () => {
    const policy = {
      key: "test:session",
      limit: 1,
      windowMs: 100,
    };

    expect(consumeRateLimit("client-a", policy, 0).allowed).toBe(true);
    expect(consumeRateLimit("client-a", policy, 50).allowed).toBe(false);
    expect(consumeRateLimit("client-a", policy, 101).allowed).toBe(true);
  });
});
