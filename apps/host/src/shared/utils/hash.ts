import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const PASSWORD_SALT_LENGTH = 16;
const PASSWORD_KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(PASSWORD_SALT_LENGTH).toString("hex");
  const derivedKey = scryptSync(password, salt, PASSWORD_KEY_LENGTH).toString("hex");

  return `${salt}:${derivedKey}`;
}

export function verifyPassword(password: string, passwordHash: string): boolean {
  const [salt, existingKey] = passwordHash.split(":");

  if (!salt || !existingKey) {
    return false;
  }

  const derivedKey = scryptSync(password, salt, PASSWORD_KEY_LENGTH);
  const expectedKey = Buffer.from(existingKey, "hex");

  if (derivedKey.length !== expectedKey.length) {
    return false;
  }

  return timingSafeEqual(derivedKey, expectedKey);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}


export function hashContent(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
