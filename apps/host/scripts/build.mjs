import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const appPath = fileURLToPath(new URL("../", import.meta.url));
const sourceSchemaPath = path.join(appPath, "src", "storage", "sqlite", "schema.sql");
const outputSchemaPath = path.join(appPath, ".build", "src", "storage", "sqlite", "schema.sql");
const require = createRequire(import.meta.url);
const tscEntry = require.resolve("typescript/bin/tsc", {
  paths: [appPath]
});

execFileSync(
  process.execPath,
  [
    tscEntry,
    "-p",
    path.join(appPath, "tsconfig.json")
  ],
  {
    cwd: appPath,
    stdio: "inherit"
  }
);

fs.mkdirSync(path.dirname(outputSchemaPath), { recursive: true });
fs.copyFileSync(sourceSchemaPath, outputSchemaPath);
