import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const appPath = fileURLToPath(new URL("../", import.meta.url));
const sourceSchemaPath = path.join(appPath, "src", "storage", "sqlite", "schema.sql");
const outputSchemaPath = path.join(appPath, ".build", "src", "storage", "sqlite", "schema.sql");

execFileSync(
  process.platform === "win32" ? "node.exe" : "node",
  [
    path.join(appPath, "..", "..", "node_modules", "typescript", "bin", "tsc"),
    "-p",
    path.join(appPath, "tsconfig.json")
  ],
  {
    stdio: "inherit"
  }
);

fs.mkdirSync(path.dirname(outputSchemaPath), { recursive: true });
fs.copyFileSync(sourceSchemaPath, outputSchemaPath);
