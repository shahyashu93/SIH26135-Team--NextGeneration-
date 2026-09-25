import "dotenv/config";
import { defineConfig } from "prisma/config";

const config = {
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" }
};

export default defineConfig(process.env.DIRECT_URL ? {
  ...config,
  engine: "classic",
  datasource: { url: process.env.DIRECT_URL }
} : config);