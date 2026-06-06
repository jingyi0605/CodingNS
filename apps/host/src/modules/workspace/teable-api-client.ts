import { AppError } from "../../shared/errors/app-error.js";

export type TeableFieldType =
  | "singleLineText"
  | "longText"
  | "singleSelect"
  | "date"
  | "link"
  | "lookup";

export interface TeableCreateBaseInput {
  spaceId: string;
  name: string;
  icon?: string;
}

export interface TeableCreateTableFieldInput {
  id?: string;
  name: string;
  type: TeableFieldType;
  isPrimary?: boolean;
  options?: Record<string, unknown>;
}

export interface TeableCreateTableInput {
  name: string;
  fields: TeableCreateTableFieldInput[];
}

export interface TeableRecordFields {
  [fieldName: string]: unknown;
}

export interface TeableCreateRecordsInput {
  fieldKeyType?: "name" | "id" | "dbFieldName";
  records: Array<{
    fields: TeableRecordFields;
  }>;
}

export interface TeableUpdateRecordsInput {
  fieldKeyType?: "name" | "id" | "dbFieldName";
  records: Array<{
    id: string;
    fields: TeableRecordFields;
  }>;
}

export interface TeableTableSummary {
  id: string;
  name: string;
}

export interface TeableFieldSummary {
  id: string;
  name: string;
  type: string;
  isPrimary?: boolean;
  isComputed?: boolean;
  isLookup?: boolean;
  isMultipleCellValue?: boolean;
  recordRead?: boolean;
  recordCreate?: boolean;
  recordUpdate?: boolean;
  permissions?: Record<string, unknown>;
  permission?: Record<string, unknown>;
  options?: Record<string, unknown>;
  lookupOptions?: Record<string, unknown>;
}

export interface TeableCreateViewInput {
  name: string;
  type: "grid" | "calendar" | "kanban" | "form" | "gallery" | "plugin";
  options?: Record<string, unknown>;
}

export interface TeableViewSummary {
  id: string;
  name: string;
  type: string;
  shareId?: string | null;
  enableShare?: boolean;
  options?: Record<string, unknown>;
  columnMeta?: unknown;
  filter?: unknown;
  orderBy?: unknown;
  group?: unknown;
}

export interface TeableRecordSummary {
  id: string;
  fields: Record<string, unknown>;
}

export interface TeableListRecordsInput {
  projection?: string[];
  fieldKeyType?: "name" | "id" | "dbFieldName";
  cellFormat?: "json" | "text";
  viewId?: string;
  take?: number;
  skip?: number;
  search?: string;
}

export class TeableApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {}

  async createBase(input: TeableCreateBaseInput): Promise<{ id: string; name: string; spaceId: string }> {
    return this.request("/api/base", {
      method: "POST",
      body: input
    });
  }

  async listTables(baseId: string): Promise<TeableTableSummary[]> {
    return this.request(`/api/base/${encodeURIComponent(baseId)}/table`);
  }

  async createTable(baseId: string, input: TeableCreateTableInput): Promise<{ id: string; name: string }> {
    return this.request(`/api/base/${encodeURIComponent(baseId)}/table`, {
      method: "POST",
      body: input
    });
  }

  async listFields(tableId: string): Promise<TeableFieldSummary[]> {
    return this.request(`/api/table/${encodeURIComponent(tableId)}/field`);
  }

  async createField(tableId: string, input: TeableCreateTableFieldInput): Promise<TeableFieldSummary> {
    return this.request(`/api/table/${encodeURIComponent(tableId)}/field`, {
      method: "POST",
      body: input
    });
  }

  async createView(tableId: string, input: TeableCreateViewInput): Promise<TeableViewSummary> {
    return this.request(`/api/table/${encodeURIComponent(tableId)}/view`, {
      method: "POST",
      body: input
    });
  }

  async listViews(tableId: string): Promise<TeableViewSummary[]> {
    return this.request(`/api/table/${encodeURIComponent(tableId)}/view`);
  }

  async enableViewShare(tableId: string, viewId: string): Promise<{ shareId: string }> {
    return this.request(`/api/table/${encodeURIComponent(tableId)}/view/${encodeURIComponent(viewId)}/enable-share`, {
      method: "POST"
    });
  }

  async refreshViewShareId(tableId: string, viewId: string): Promise<{ shareId: string }> {
    return this.request(`/api/table/${encodeURIComponent(tableId)}/view/${encodeURIComponent(viewId)}/refresh-share-id`, {
      method: "POST"
    });
  }

  async listRecords(tableId: string, input: TeableListRecordsInput = {}): Promise<{ records: TeableRecordSummary[]; total?: number }> {
    const url = new URL(`/api/table/${encodeURIComponent(tableId)}/record`, this.baseUrl);
    for (const field of input.projection ?? []) {
      if (field.trim()) {
        url.searchParams.append("projection", field.trim());
      }
    }
    url.searchParams.set("fieldKeyType", input.fieldKeyType ?? "name");
    url.searchParams.set("cellFormat", input.cellFormat ?? "json");
    if (input.viewId?.trim()) {
      url.searchParams.set("viewId", input.viewId.trim());
    }
    if (typeof input.take === "number") {
      url.searchParams.set("take", String(input.take));
    }
    if (typeof input.skip === "number") {
      url.searchParams.set("skip", String(input.skip));
    }
    if (input.search?.trim()) {
      url.searchParams.set("search", input.search.trim());
    }
    return this.request(url.toString());
  }

  async createRecords(tableId: string, input: TeableCreateRecordsInput): Promise<{ records: TeableRecordSummary[] }> {
    return this.request(`/api/table/${encodeURIComponent(tableId)}/record`, {
      method: "POST",
      body: {
        fieldKeyType: input.fieldKeyType ?? "name",
        typecast: true,
        ...input
      }
    });
  }

  async updateRecords(tableId: string, input: TeableUpdateRecordsInput): Promise<TeableRecordSummary[]> {
    return this.request(`/api/table/${encodeURIComponent(tableId)}/record`, {
      method: "PATCH",
      body: {
        fieldKeyType: input.fieldKeyType ?? "name",
        typecast: true,
        ...input
      }
    });
  }

  async deleteRecords(tableId: string, recordIds: string[]): Promise<void> {
    const url = new URL(`/api/table/${encodeURIComponent(tableId)}/record`, this.baseUrl);
    for (const recordId of recordIds) {
      url.searchParams.append("recordIds", recordId);
    }

    await this.request(url.toString(), {
      method: "DELETE"
    });
  }

  private async request<T>(
    pathOrUrl: string,
    input: {
      method?: "GET" | "POST" | "PATCH" | "DELETE";
      body?: unknown;
    } = {}
  ): Promise<T> {
    const url = pathOrUrl.startsWith("http")
      ? pathOrUrl
      : new URL(pathOrUrl, this.baseUrl).toString();

    const response = await fetch(url, {
      method: input.method ?? "GET",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json"
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body)
    });

    if (!response.ok) {
      const detail = await safeReadText(response);
      throw new AppError({
        statusCode: 502,
        errorCode: "TEABLE_API_REQUEST_FAILED",
        detail: `Teable 请求失败：${response.status} ${response.statusText}${detail ? ` - ${detail}` : ""}`
      });
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    if (!text.trim()) {
      return undefined as T;
    }

    return JSON.parse(text) as T;
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return "";
  }
}
