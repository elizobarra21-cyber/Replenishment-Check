// Client-side persistence of the in-progress replenishment: the current
// request id (the list survives reloads / dropped connections) and the mode
// (hall / warehouse). Shared by the main screen and Settings (log out).

const REQUEST_STORAGE_KEY = "store-replenishment:request-id";

export function loadStoredRequestId(): string {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    return window.localStorage.getItem(REQUEST_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function storeRequestId(id: string) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(REQUEST_STORAGE_KEY, id);
  } catch {
    // ignore storage errors (private mode, quota)
  }
}

export function clearStoredRequestId() {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(REQUEST_STORAGE_KEY);
  } catch {
    // ignore
  }
}

const MODE_STORAGE_KEY = "store-replenishment:mode";

export function loadStoredMode(): "hall" | "warehouse" | "" {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    const value = window.localStorage.getItem(MODE_STORAGE_KEY);
    return value === "warehouse" || value === "hall" ? value : "";
  } catch {
    return "";
  }
}

export function storeMode(mode: "hall" | "warehouse") {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

// Signing out forgets the saved list and mode (the next user starts fresh).
export function clearStoredSession() {
  clearStoredRequestId();
  storeMode("hall");
}
