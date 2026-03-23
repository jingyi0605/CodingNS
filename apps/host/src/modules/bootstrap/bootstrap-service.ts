import type Database from "better-sqlite3";

import { AppError } from "../../shared/errors/app-error.js";
import { hashPassword } from "../../shared/utils/hash.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { BootstrapStateRepository } from "../../storage/repositories/bootstrap-state-repository.js";
import type { AuthUserRepository } from "../../storage/repositories/auth-user-repository.js";

export interface SetupInput {
  username: string;
  password: string;
}

export class BootstrapService {
  constructor(
    private readonly db: Database.Database,
    private readonly bootstrapStateRepository: BootstrapStateRepository,
    private readonly authUserRepository: AuthUserRepository
  ) {}

  getStatus(): { initialized: boolean } {
    return { initialized: this.bootstrapStateRepository.getState().initialized };
  }

  setup(input: SetupInput): { initialized: true; userId: string } {
    const normalizedInput = validateSetupInput(input);
    const state = this.bootstrapStateRepository.getState();

    if (state.initialized || this.authUserRepository.count() > 0) {
      throw new AppError({
        statusCode: 409,
        errorCode: "BOOTSTRAP_ALREADY_DONE",
        detail: "系统已经初始化过了，不能重复执行 setup"
      });
    }

    const userId = createId();
    const timestamp = nowIso();

    // 初始化只做两次短写入：建首个管理员，标记系统已初始化。
    const transaction = this.db.transaction(() => {
      this.authUserRepository.create({
        id: userId,
        username: normalizedInput.username,
        passwordHash: hashPassword(normalizedInput.password),
        role: "admin",
        createdAt: timestamp,
        updatedAt: timestamp
      });

      this.bootstrapStateRepository.markInitialized(timestamp, userId);
    });

    transaction();

    return {
      initialized: true,
      userId
    };
  }
}

function validateSetupInput(input: SetupInput): SetupInput {
  const normalized = {
    username: input.username.trim(),
    password: input.password
  };

  if (normalized.username.length < 3 || normalized.username.length > 64) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "用户名长度必须在 3 到 64 个字符之间",
      field: "username"
    });
  }

  if (normalized.password.length < 8) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "密码长度至少为 8 位",
      field: "password"
    });
  }

  return normalized;
}
