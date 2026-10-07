import { createClient } from "redis";
import dotenv from "dotenv";

dotenv.config();

export const redis = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});

redis.on("error", (err) => {
  console.error("Redis error:", err.message);
});

export async function connectRedis() {
  if (!redis.isOpen) {
    try {
      await redis.connect();
    } catch (error) {
      console.warn("Redis unavailable. Continuing without cache.");
    }
  }
}

export async function cacheGet(key) {
  if (!redis.isOpen) return null;
  try {
    return await redis.get(key);
  } catch {
    return null;
  }
}

export async function cacheSet(key, value, seconds = 60) {
  if (!redis.isOpen) return;
  try {
    await redis.set(key, value, { EX: seconds });
  } catch {
    // Cache failure should never stop the application.
  }
}

export async function cacheDelete(key) {
  if (!redis.isOpen) return;
  try {
    await redis.del(key);
  } catch {
    // Ignore cache deletion errors.
  }
}
