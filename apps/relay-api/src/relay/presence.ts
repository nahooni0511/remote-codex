import type Redis from "ioredis";

export function parsePresencePayload<T>(raw: string | null): T | null {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function scanPresenceValues(redis: Redis, pattern: string): Promise<string[]> {
  const values: string[] = [];
  let cursor = "0";

  do {
    const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", "100");
    cursor = nextCursor;
    if (keys.length) {
      const rows = await redis.mget(keys);
      for (const row of rows) {
        if (row) {
          values.push(row);
        }
      }
    }
  } while (cursor !== "0");

  return values;
}
