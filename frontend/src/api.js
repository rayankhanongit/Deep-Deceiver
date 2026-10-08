export const API = "http://127.0.0.1:8000";

export async function getJSON(path) {
  const response = await fetch(`${API}${path}`);

  if (!response.ok) {
    throw new Error(`${path} failed (${response.status})`);
  }

  return response.json();
}

export async function postJSON(path, body) {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail =
      typeof data.detail === "string"
        ? data.detail
        : `${path} failed (${response.status})`;

    throw new Error(detail);
  }

  return data;
}

export const SEVERITY_ORDER = ["SAFE", "LOW", "MEDIUM", "HIGH", "CRITICAL"];

export function prettyCategory(category) {
  return String(category || "unknown")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatTime(iso) {
  if (!iso) return "";

  const date = new Date(iso);

  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString([], { hour12: false });
}
