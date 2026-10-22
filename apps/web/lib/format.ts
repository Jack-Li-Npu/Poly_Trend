export const probability = (value: number | null | undefined, digits = 0) =>
  value == null || !Number.isFinite(value)
    ? "—"
    : `${(value * 100).toFixed(digits)}%`;
export const signedPercent = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value)
    ? "—"
    : `${value > 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
export const decimal = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
export const currency = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value)
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: Math.abs(value) < 100 ? 2 : 0,
      }).format(value);
export const dateTime = (value: string | null | undefined) =>
  value && Number.isFinite(new Date(value).getTime())
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(new Date(value))
    : "Not available";
export const shortDate = (value: string | null | undefined) =>
  value && Number.isFinite(new Date(value).getTime())
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(value))
    : "Open-ended";
export const label = (value: string) => value.replaceAll("_", " ");
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export const rows = (value: unknown) =>
  Array.isArray(value) ? value.map(record) : [];
export const numeric = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
export const string = (value: unknown, fallback = "—") =>
  typeof value === "string" ? value : fallback;
export const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
export function download(name: string, body: string, mime = "text/plain") {
  const url = URL.createObjectURL(new Blob([body], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeSourceUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/key|token|auth|password|secret|signature|credential/i.test(key))
        url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function observedChange(
  first: number | undefined,
  last: number | undefined,
  yieldSeries: boolean,
): number | null {
  if (
    first === undefined ||
    last === undefined ||
    !Number.isFinite(first) ||
    !Number.isFinite(last)
  )
    return null;
  if (yieldSeries) return (last - first) * 100;
  if (first === 0) return null;
  return last / first - 1;
}
