import { nowIso } from "../../shared/utils/time.js";
import { decryptSecret, encryptSecret } from "../../shared/utils/secret-box.js";
import type { GitRemoteCredentialRepository } from "../../storage/repositories/git-remote-credential-repository.js";
import type { GitAuthInput } from "./git-auth.js";

export class GitRemoteCredentialService {
  constructor(
    private readonly repository: GitRemoteCredentialRepository,
    private readonly credentialSecret: string
  ) {}

  load(userId: string, remoteUrl: string): GitAuthInput | null {
    const normalizedRemoteUrl = normalizeRemoteUrl(remoteUrl);
    const record = this.repository.findByUserIdAndRemoteUrl(userId, normalizedRemoteUrl);

    if (!record) {
      return null;
    }

    try {
      const username = decryptSecret(this.credentialSecret, record.usernameCiphertext);
      const secret = decryptSecret(this.credentialSecret, record.secretCiphertext);

      if (record.authMode === "basic") {
        return {
          mode: "basic",
          username,
          password: secret
        };
      }

      return {
        mode: "token",
        username,
        token: secret
      };
    } catch {
      this.repository.delete(userId, normalizedRemoteUrl);
      return null;
    }
  }

  save(userId: string, remoteUrl: string, auth: GitAuthInput | null | undefined): void {
    if (!auth || !auth.mode || auth.mode === "none") {
      return;
    }

    const writableAuth = auth.mode === "basic" || auth.mode === "token" ? auth : null;

    if (!writableAuth) {
      return;
    }

    const normalizedRemoteUrl = normalizeRemoteUrl(remoteUrl);
    const current = this.repository.findByUserIdAndRemoteUrl(userId, normalizedRemoteUrl);
    const timestamp = nowIso();

    if (writableAuth.mode === "basic") {
      this.repository.upsert({
        userId,
        remoteUrl: normalizedRemoteUrl,
        authMode: "basic",
        usernameCiphertext: encryptSecret(this.credentialSecret, writableAuth.username?.trim() || ""),
        secretCiphertext: encryptSecret(this.credentialSecret, writableAuth.password?.trim() || ""),
        createdAt: current?.createdAt ?? timestamp,
        updatedAt: timestamp
      });
      return;
    }

    if (writableAuth.mode === "token") {
      this.repository.upsert({
        userId,
        remoteUrl: normalizedRemoteUrl,
        authMode: "token",
        usernameCiphertext: encryptSecret(this.credentialSecret, writableAuth.username?.trim() || "git"),
        secretCiphertext: encryptSecret(this.credentialSecret, writableAuth.token?.trim() || ""),
        createdAt: current?.createdAt ?? timestamp,
        updatedAt: timestamp
      });
    }
  }
}

function normalizeRemoteUrl(remoteUrl: string): string {
  return remoteUrl.trim().replace(/\/+$/, "");
}
