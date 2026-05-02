import { hasRedisRateLimitConfig, readServerEnv, type ServerEnv } from "./env.js";
import { captureServerException } from "./telemetry.js";

type RateLimitState = {
  count: number;
  resetAt: number;
};

export type RateLimitPolicy = {
  key: string;
  limit: number;
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

const rateLimitBuckets = new Map<string, RateLimitState>();

function clearExpiredBuckets(now: number) {
  for (const [bucketKey, state] of rateLimitBuckets.entries()) {
    if (state.resetAt <= now) {
      rateLimitBuckets.delete(bucketKey);
    }
  }
}

function consumeMemoryRateLimit(
  clientKey: string,
  policy: RateLimitPolicy,
  now: number,
): RateLimitResult {
  clearExpiredBuckets(now);

  const bucketKey = `${policy.key}:${clientKey}`;
  const current = rateLimitBuckets.get(bucketKey);

  if (!current || current.resetAt <= now) {
    const resetAt = now + policy.windowMs;
    rateLimitBuckets.set(bucketKey, {
      count: 1,
      resetAt,
    });

    return {
      allowed: true,
      limit: policy.limit,
      remaining: Math.max(policy.limit - 1, 0),
      resetAt,
      retryAfterSeconds: Math.ceil(policy.windowMs / 1000),
    };
  }

  if (current.count >= policy.limit) {
    return {
      allowed: false,
      limit: policy.limit,
      remaining: 0,
      resetAt: current.resetAt,
      retryAfterSeconds: Math.max(Math.ceil((current.resetAt - now) / 1000), 1),
    };
  }

  current.count += 1;

  return {
    allowed: true,
    limit: policy.limit,
    remaining: Math.max(policy.limit - current.count, 0),
    resetAt: current.resetAt,
    retryAfterSeconds: Math.max(Math.ceil((current.resetAt - now) / 1000), 1),
  };
}

async function consumeRedisRateLimit(
  clientKey: string,
  policy: RateLimitPolicy,
  now: number,
): Promise<RateLimitResult> {
  const env = readServerEnv();
  const bucketKey = `${policy.key}:${clientKey}`;
  const resetAt = now + policy.windowMs;
  const requestBody = JSON.stringify([
    ["INCR", bucketKey],
    ["PEXPIRE", bucketKey, String(policy.windowMs), "NX"],
    ["PTTL", bucketKey],
  ]);
  const response = await fetch(env.UPSTASH_REDIS_REST_URL!, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: requestBody,
  });

  if (!response.ok) {
    throw new Error(`Redis rate limit request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as {
    result?: Array<number | string | null>;
  };
  const count = Number(payload.result?.[0] ?? 0);
  const ttlMs = Number(payload.result?.[2] ?? policy.windowMs);
  const effectiveResetAt = now + Math.max(ttlMs, 0);

  return {
    allowed: count <= policy.limit,
    limit: policy.limit,
    remaining: Math.max(policy.limit - count, 0),
    resetAt: count > 0 ? effectiveResetAt : resetAt,
    retryAfterSeconds: Math.max(Math.ceil(Math.max(ttlMs, 1) / 1000), 1),
  };
}

export async function consumeRateLimit(
  clientKey: string,
  policy: RateLimitPolicy,
  now = Date.now(),
  env: ServerEnv = readServerEnv(),
): Promise<RateLimitResult> {
  if (hasRedisRateLimitConfig(env)) {
    try {
      return await consumeRedisRateLimit(clientKey, policy, now);
    } catch (error) {
      captureServerException(error, {
        scope: "rate-limit",
        policyKey: policy.key,
        fallback: "memory",
        reason: "redis_request_failed",
      });
    }
  } else if ((env.NODE_ENV ?? "development") === "production") {
    captureServerException(new Error("Missing Upstash Redis rate limit configuration."), {
      scope: "rate-limit",
      policyKey: policy.key,
      fallback: "memory",
      reason: "missing_redis_config",
    });
  }

  return consumeMemoryRateLimit(clientKey, policy, now);
}
