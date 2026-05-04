import "reflect-metadata";
import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
loadDotenv({ path: resolve(__dirname, "../.env") });
loadDotenv({ path: resolve(__dirname, "../../../.env"), override: false });

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: true,
    credentials: true
  });
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`AI Checkout API listening on http://localhost:${port}`);
  console.log(`DeepSeek key loaded: ${Boolean(process.env.DEEPSEEK_API_KEY)}`);
  console.log(`OpenAI key loaded: ${Boolean(process.env.OPENAI_API_KEY)}`);
}

void bootstrap();
