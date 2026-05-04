const TOKEN_KEY = "wm-ddns-token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(t: string | null): void {
  if (t === null) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, t);
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(
  path: string,
  init?: RequestInit & { auth?: boolean },
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const auth = init?.auth ?? true;
  if (auth) {
    const t = getToken();
    if (t) headers.set("Authorization", `Bearer ${t}`);
  }
  const res = await fetch(path, {
    ...init,
    headers,
    body:
      init?.body && typeof init.body !== "string" ? JSON.stringify(init.body) : init?.body,
  });
  const ct = res.headers.get("content-type") ?? "";
  const text = await res.text();
  const data = ct.includes("application/json") && text ? JSON.parse(text) : text;
  if (!res.ok) {
    if (res.status === 401) {
      setToken(null);
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    const msg =
      typeof data === "object" && data && "error" in data
        ? String((data as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}
