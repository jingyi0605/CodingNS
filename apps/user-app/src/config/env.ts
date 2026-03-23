const defaultHostBaseUrl = "http://127.0.0.1:4321";

export function getHostBaseUrl(): string {
  const envUrl = import.meta.env.VITE_HOST_BASE_URL;
  return typeof envUrl === "string" && envUrl.length > 0 ? envUrl : defaultHostBaseUrl;
}
