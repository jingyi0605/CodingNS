const AUTH_EXPIRED_KEY = "codingns.auth_expired_at";

export function markAuthExpiredFlag(): void {
  sessionStorage.setItem(AUTH_EXPIRED_KEY, String(Date.now()));
}

export function consumeAuthExpiredFlag(): boolean {
  const raw = sessionStorage.getItem(AUTH_EXPIRED_KEY);

  if (!raw) {
    return false;
  }

  sessionStorage.removeItem(AUTH_EXPIRED_KEY);

  // 只认可 5 秒内的标记，避免过期误判
  return Date.now() - Number(raw) < 5000;
}
