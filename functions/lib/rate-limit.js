const buckets = new Map();

function clientKey(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
}

export function checkRateLimit(request, namespace, { limit = 20, windowMs = 10 * 60 * 1000 } = {}) {
  const now = Date.now();
  const key = `${namespace}:${clientKey(request)}`;
  const current = buckets.get(key);
  if (!current || now >= current.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: Math.max(0, limit - 1), retryAfter: 0 };
  }
  current.count += 1;
  if (buckets.size > 5000) {
    for (const [bucketKey, value] of buckets) if (now >= value.resetAt) buckets.delete(bucketKey);
  }
  const allowed = current.count <= limit;
  return { allowed, remaining: Math.max(0, limit - current.count), retryAfter: allowed ? 0 : Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
}
