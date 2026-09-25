import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const standalone = join(process.cwd(), ".next", "standalone");
if (existsSync(standalone)) {
  for (const name of readdirSync(standalone)) {
    if (name === ".env" || name.startsWith(".env.")) rmSync(join(standalone, name));
  }
  console.log("Standalone environment files removed. Supply secrets through the runtime environment.");
}