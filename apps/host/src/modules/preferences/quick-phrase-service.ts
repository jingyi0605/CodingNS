import { AppError } from "../../shared/errors/app-error.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type {
  UserQuickPhrasePreferenceRecord,
  UserQuickPhraseRecord
} from "../../types/domain.js";
import type { UserQuickPhrasePreferenceRepository } from "../../storage/repositories/user-quick-phrase-preference-repository.js";

interface QuickPhraseDraft {
  id?: string;
  text?: string;
}

const DEFAULT_QUICK_PHRASES: UserQuickPhraseRecord[] = [
  {
    id: "builtin-stage-and-summarize",
    text: "请将本次会话变更的所有代码提交到git暂存区，然后总结一条中文的提交信息"
  },
  {
    id: "builtin-review-module",
    text: "分析本项目  模块的代码实现，并分析存在的问题"
  },
  {
    id: "builtin-group-commits",
    text: "分析当前项目中的未提交文件，按照功能模块进行分类提交，提交信息格式请参考我最近的提交记录"
  }
];

export class QuickPhraseService {
  constructor(
    private readonly repository: UserQuickPhrasePreferenceRepository
  ) {}

  listByUser(userId: string): UserQuickPhraseRecord[] {
    const current = this.repository.findByUserId(userId);

    if (current) {
      return current.phrases;
    }

    const timestamp = nowIso();
    const initialized: UserQuickPhrasePreferenceRecord = {
      userId,
      phrases: DEFAULT_QUICK_PHRASES.map((phrase) => ({ ...phrase })),
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.repository.upsert(initialized);
    return initialized.phrases;
  }

  replaceByUser(userId: string, drafts: QuickPhraseDraft[]): UserQuickPhraseRecord[] {
    const current = this.repository.findByUserId(userId);
    const nextPhrases = drafts.map((draft, index) => normalizeQuickPhraseDraft(draft, index));
    const timestamp = nowIso();

    this.repository.upsert({
      userId,
      phrases: nextPhrases,
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp
    });

    return nextPhrases;
  }
}

function normalizeQuickPhraseDraft(
  draft: QuickPhraseDraft,
  index: number
): UserQuickPhraseRecord {
  const text = draft.text?.trim() ?? "";

  if (!text) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: `快捷短语第 ${index + 1} 条缺少有效内容`,
      field: "items"
    });
  }

  const id = draft.id?.trim() || createId();

  return {
    id,
    text
  };
}
