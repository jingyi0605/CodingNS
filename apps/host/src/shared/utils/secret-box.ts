import crypto from "node:crypto";

const SECRET_BOX_ALGORITHM = "aes-256-gcm";
const SECRET_BOX_IV_LENGTH = 12;

export function encryptSecret(secret: string, plaintext: string): string {
  const key = deriveSecretKey(secret);
  const iv = crypto.randomBytes(SECRET_BOX_IV_LENGTH);
  const cipher = crypto.createCipheriv(SECRET_BOX_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("base64url")}.${authTag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(secret: string, payload: string): string {
  const [ivText, authTagText, encryptedText] = payload.split(".");

  if (!ivText || !authTagText || !encryptedText) {
    throw new Error("SECRET_BOX_PAYLOAD_INVALID");
  }

  const key = deriveSecretKey(secret);
  const decipher = crypto.createDecipheriv(
    SECRET_BOX_ALGORITHM,
    key,
    Buffer.from(ivText, "base64url")
  );

  decipher.setAuthTag(Buffer.from(authTagText, "base64url"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final()
  ]);

  return decrypted.toString("utf8");
}

function deriveSecretKey(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}
