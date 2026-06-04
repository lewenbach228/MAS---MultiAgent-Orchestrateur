import Redis from "ioredis";
import { config } from "./config.js";

const publisher = new Redis({
  host: config.redisHost,
  port: config.redisPort,
  maxRetriesPerRequest: null,
});

const subscriber = new Redis({
  host: config.redisHost,
  port: config.redisPort,
  maxRetriesPerRequest: null,
});

const CHANNEL = "workflow:events";

export function publish(event: object): void {
  publisher.publish(CHANNEL, JSON.stringify(event)).catch(() => {
    // fire-and-forget
  });
}

export function subscribe(handler: (event: object) => void): void {
  subscriber.subscribe(CHANNEL, (err) => {
    if (err) {
      console.error("❌ Redis Pub/Sub subscribe error:", err);
      return;
    }
    console.log(`✔ Redis Pub/Sub abonné au canal ${CHANNEL}`);
  });

  subscriber.on("message", (_channel, message) => {
    try {
      const event = JSON.parse(message);
      handler(event);
    } catch {
      // invalid JSON — skip
    }
  });
}
