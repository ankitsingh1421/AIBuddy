import "dotenv/config";

import { defineConfig } from "prisma/config";

const datasource = process.env.DATABASE_URL
  ? {
      url: process.env.DATABASE_URL,
    }
  : undefined;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource,
});
