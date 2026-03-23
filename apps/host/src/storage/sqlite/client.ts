import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

export interface DatabaseClient {
  db: Database.Database;
  close: () => void;
}

export function createDatabaseClient(databasePath: string): DatabaseClient {
  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const db = new Database(databasePath);
  const schemaPath = new URL("./schema.sql", import.meta.url);
  const schema = fs.readFileSync(schemaPath, "utf8");

  db.exec(schema);

  return {
    db,
    close: () => db.close()
  };
}
