import { describe, expect, it } from "vitest";

import {
  classifyFieldSetChangeImpact,
  consumeRateLimit,
  getCanonicalAppOrigin,
  isCertificateSigningEnabled,
  readServerEnv,
  shouldRequireEmailDelivery,
  shouldRequireProcessorSecret,
  shouldRequireStripe,
} from "./index.js";

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY ??= "anon";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "service";
process.env.SUPABASE_DOCUMENT_BUCKET ??= "documents";
process.env.SUPABASE_SIGNATURE_BUCKET ??= "signatures";
process.env.EASYDRAFT_APP_ORIGIN ??= "http://localhost:5173";

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

  it("keeps certificate-backed signing disabled unless explicitly enabled", () => {
    const disabledEnv = readServerEnv({
      NODE_ENV: "development",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      SUPABASE_DOCUMENT_BUCKET: "documents",
      SUPABASE_SIGNATURE_BUCKET: "signatures",
      EASYDRAFT_APP_ORIGIN: "http://localhost:5173",
    });
    const enabledEnv = readServerEnv({
      NODE_ENV: "development",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      SUPABASE_DOCUMENT_BUCKET: "documents",
      SUPABASE_SIGNATURE_BUCKET: "signatures",
      EASYDRAFT_APP_ORIGIN: "http://localhost:5173",
      EASYDRAFT_ENABLE_CERTIFICATE_SIGNING: "true",
    });

    expect(isCertificateSigningEnabled(disabledEnv)).toBe(false);
    expect(isCertificateSigningEnabled(enabledEnv)).toBe(true);
  });
});

describe("rate limiting", () => {
  it("allows requests up to the limit and rejects the next one", async () => {
    const policy = {
      key: "test:signing",
      limit: 2,
      windowMs: 60_000,
    };

    expect((await consumeRateLimit("127.0.0.1", policy, 0)).allowed).toBe(true);
    expect((await consumeRateLimit("127.0.0.1", policy, 1)).allowed).toBe(true);

    const blocked = await consumeRateLimit("127.0.0.1", policy, 2);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("resets after the rate-limit window elapses", async () => {
    const policy = {
      key: "test:session",
      limit: 1,
      windowMs: 100,
    };

    expect((await consumeRateLimit("client-a", policy, 0)).allowed).toBe(true);
    expect((await consumeRateLimit("client-a", policy, 50)).allowed).toBe(false);
    expect((await consumeRateLimit("client-a", policy, 101)).allowed).toBe(true);
  });

  it("falls back to in-memory limiting when production is missing Upstash config", async () => {
    const policy = {
      key: "test:production-fallback",
      limit: 1,
      windowMs: 100,
    };
    const productionEnv = readServerEnv({
      NODE_ENV: "production",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
      SUPABASE_DOCUMENT_BUCKET: "documents",
      SUPABASE_SIGNATURE_BUCKET: "signatures",
      EASYDRAFT_APP_ORIGIN: "https://easydraftdocs.app",
    });

    expect((await consumeRateLimit("client-b", policy, 0, productionEnv)).allowed).toBe(true);
    expect((await consumeRateLimit("client-b", policy, 1, productionEnv)).allowed).toBe(false);
  });
});

describe("change impact classification", () => {
  it("marks signed-field geometry changes as resign required", () => {
    const previousFields = [
      {
        id: "field_1",
        page: 1,
        kind: "signature" as const,
        label: "Primary signature",
        required: true,
        assigneeParticipantId: null,
        assigneeSignerId: "signer_1",
        source: "manual" as const,
        x: 100,
        y: 200,
        width: 180,
        height: 40,
        value: "completed",
        appliedSavedSignatureId: null,
        completedAt: "2026-04-01T10:00:00.000Z",
        completedBySignerId: "signer_1",
      },
    ];
    const nextFields = [
      {
        ...previousFields[0],
        x: 130,
      },
    ];

    expect(classifyFieldSetChangeImpact(previousFields, nextFields)).toEqual({
      impact: "resign_required",
      summary: "A signed field changed after signing started. All action fields must be signed again.",
    });
  });

  it("marks unsigned field-map changes as review required", () => {
    const previousFields = [
      {
        id: "field_1",
        page: 1,
        kind: "signature" as const,
        label: "Primary signature",
        required: true,
        assigneeParticipantId: null,
        assigneeSignerId: "signer_1",
        source: "manual" as const,
        x: 100,
        y: 200,
        width: 180,
        height: 40,
        value: "completed",
        appliedSavedSignatureId: null,
        completedAt: "2026-04-01T10:00:00.000Z",
        completedBySignerId: "signer_1",
      },
      {
        id: "field_2",
        page: 1,
        kind: "text" as const,
        label: "Notes",
        required: false,
        assigneeParticipantId: null,
        assigneeSignerId: null,
        source: "manual" as const,
        x: 100,
        y: 300,
        width: 180,
        height: 40,
        value: null,
        appliedSavedSignatureId: null,
        completedAt: null,
        completedBySignerId: null,
      },
    ];
    const nextFields = [
      previousFields[0],
      {
        ...previousFields[1],
        label: "Internal notes",
      },
    ];

    expect(classifyFieldSetChangeImpact(previousFields, nextFields)).toEqual({
      impact: "review_required",
      summary: "The field map changed after signing started. Review the document and reopen it before more signing continues.",
    });
  });
});
