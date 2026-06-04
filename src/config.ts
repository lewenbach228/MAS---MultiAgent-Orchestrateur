import "dotenv/config";

export const config = {
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || "",
  primaryProvider: (process.env.PRIMARY_PROVIDER || "gemini") as "gemini" | "deepseek",
  geminiModel: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  deepseekModel: process.env.DEEPSEEK_MODEL || "deepseek-chat",
  mongoUri: process.env.MONGO_URI || "mongodb://localhost:27017/p2-orchestrator",
  redisHost: process.env.REDIS_HOST || "localhost",
  redisPort: parseInt(process.env.REDIS_PORT || "6379"),
  port: parseInt(process.env.PORT || "3000"),
};
