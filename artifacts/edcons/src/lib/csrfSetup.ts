const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return match ? match[1] : "";
}

const originalFetch = window.fetch.bind(window);

window.fetch = function csrfFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method || "GET").toUpperCase();

  if (UNSAFE_METHODS.has(method)) {
    const headers = new Headers(init?.headers);
    const token = getCsrfToken();
    if (token) {
      headers.set("x-csrf-token", token);
    }
    return originalFetch(input, { ...init, headers });
  }

  return originalFetch(input, init);
};
