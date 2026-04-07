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

export function consumeRateLimit(
  clientKey: string,
  policy: RateLimitPolicy,
  now = Date.now(),
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
