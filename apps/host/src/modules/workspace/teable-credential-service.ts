import { nowIso } from "../../shared/utils/time.js";
import { decryptSecret, encryptSecret } from "../../shared/utils/secret-box.js";
import type { UserTeableCredentialRepository } from "../../storage/repositories/user-teable-credential-repository.js";

export class TeableCredentialService {
  constructor(
    private readonly repository: UserTeableCredentialRepository,
    private readonly credentialSecret: string
  ) {}

  loadToken(userId: string, authRef: string): string | null {
    const record = this.repository.findByUserIdAndAuthRef(userId, authRef.trim());
    if (!record) {
      return null;
    }

    try {
      return decryptSecret(this.credentialSecret, record.tokenCiphertext);
    } catch {
      this.repository.delete(userId, authRef.trim());
      return null;
    }
  }

  saveToken(userId: string, authRef: string, token: string): void {
    const normalizedAuthRef = authRef.trim();
    const normalizedToken = token.trim();
    const current = this.repository.findByUserIdAndAuthRef(userId, normalizedAuthRef);
    const timestamp = nowIso();

    this.repository.upsert({
      userId,
      authRef: normalizedAuthRef,
      tokenCiphertext: encryptSecret(this.credentialSecret, normalizedToken),
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp
    });
  }
}
