import { zhCN } from "../../i18n/zh-CN";

type DictionaryValue = string | Record<string, unknown>;

function readValue(key: string, source: DictionaryValue): string {
  if (typeof source === "string") {
    return source;
  }

  const [head, ...rest] = key.split(".");
  const nextValue = source[head];

  if (!nextValue) {
    return key;
  }

  if (rest.length === 0) {
    return typeof nextValue === "string" ? nextValue : key;
  }

  return readValue(rest.join("."), nextValue as DictionaryValue);
}

export function t(key: string): string {
  return readValue(key, zhCN);
}
