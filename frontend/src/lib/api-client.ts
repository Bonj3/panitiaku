/**
 * Satu-satunya HTTP client terpusat.
 *
 * Aturan keras (§7):
 * - baseURL dari `import.meta.env.VITE_API_URL`, `credentials: "include"`.
 * - Parse envelope §13.1 sukses/error.
 * - Tanpa fetch langsung dari komponen UI — selalu lewat modul ini
 *   via lapisan services/ yang dipakai oleh fitur (features/).
 * - CSRF double-submit: untuk method POST/PUT/PATCH/DELETE, header
 *   X-CSRF-Token dilampirkan otomatis dari cookie ec_csrf (bila ada).
 * - Refresh otomatis: saat respons 401 pada endpoint non-auth, client
 *   mencoba POST /auth/refresh SEKALI lalu mengulangi request awal.
 *   Endpoint auth (login/register/refresh/logout/me) dikecualikan agar
 *   tidak terjadi infinite loop.
 */

import type { ApiErrorBody, Envelope } from "@/types/api";

export class ApiError extends Error {
  readonly code: string;
  readonly details?: unknown;
  readonly status: number;

  constructor(body: ApiErrorBody, status: number) {
    super(body.message);
    this.name = "ApiError";
    this.code = body.code;
    this.details = body.details;
    this.status = status;
  }
}

const RAW_BASE_URL =
  import.meta.env.VITE_API_URL ?? "http://localhost:3000/api/v1";

/** Base URL tanpa trailing slash agar join path konsisten. */
export const API_BASE_URL = RAW_BASE_URL.replace(/\/+$/, "");

export interface RequestOptions extends Omit<RequestInit, "body" | "signal"> {
  /** Body JSON-serializable, FormData, atau Blob. */
  body?: unknown;
  signal?: AbortSignal;
  /**
   * Lewati mekanisme refresh-otomatis saat respons 401.
   * Selalu true untuk pemanggilan endpoint auth
   * (login/register/refresh/logout/me) agar tidak terjadi loop.
   */
  skipAuthRefresh?: boolean;
}

const CSRF_COOKIE_NAME = "ec_csrf";
const CSRF_HEADER_NAME = "X-CSRF-Token";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Endpoint auth dikecualikan dari refresh-otomatis (mencegah loop). */
const AUTH_PATH_PATTERN = /(^|\/)auth\/(login|register|refresh|logout|me)(\/|$|\?)/;

/**
 * Endpoint yang dikecualikan backend dari pemeriksaan CSRF double-submit
 * (backend/middleware/csrf.ts). Header tidak dilampirkan ke endpoint ini:
 * tidak ada gunanya dan memicu preflight CORS yang tidak perlu.
 */
const CSRF_EXEMPT_PATTERN = /(^|\/)auth\/(login|register|refresh)(\/|$|\?)/;

function isAuthEndpoint(path: string): boolean {
  return AUTH_PATH_PATTERN.test(path);
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const parts = document.cookie ? document.cookie.split(";") : [];
  for (const part of parts) {
    const eq = part.indexOf("=");
    const key = (eq === -1 ? part : part.slice(0, eq)).trim();
    if (key !== name) continue;
    const rawValue = eq === -1 ? "" : part.slice(eq + 1);
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return null;
}

function isJsonBody(body: unknown): boolean {
  if (body === null || body === undefined) return false;
  if (typeof FormData !== "undefined" && body instanceof FormData) return false;
  if (typeof Blob !== "undefined" && body instanceof Blob) return false;
  if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer)
    return false;
  if (
    typeof URLSearchParams !== "undefined" &&
    body instanceof URLSearchParams
  )
    return false;
  return (
    typeof body === "object" ||
    typeof body === "number" ||
    typeof body === "boolean" ||
    typeof body === "string"
  );
}

function joinUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${suffix}`;
}

async function parseJsonSafe(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isEnvelope(value: unknown): value is Envelope<unknown> {
  if (typeof value !== "object" || value === null) return false;
  return "success" in value;
}

/** Satu kali percobaan HTTP: bangun header/body, fetch, parse envelope. */
async function performRequest<T>(
  path: string,
  options: RequestOptions,
): Promise<T> {
  const { body, headers, signal, ...rest } = options;

  const method = (
    rest.method ?? (body !== undefined ? "POST" : "GET")
  ).toString().toUpperCase();

  const finalHeaders = new Headers(headers);

  // CSRF double-submit: lampirkan token dari cookie untuk method mutasi,
  // kecuali endpoint yang dikecualikan backend dari pemeriksaan CSRF.
  if (
    MUTATING_METHODS.has(method) &&
    !CSRF_EXEMPT_PATTERN.test(path) &&
    !finalHeaders.has(CSRF_HEADER_NAME)
  ) {
    const csrfToken = readCookie(CSRF_COOKIE_NAME);
    if (csrfToken) finalHeaders.set(CSRF_HEADER_NAME, csrfToken);
  }

  let fetchBody: BodyInit | undefined;

  if (body !== undefined) {
    if (
      typeof FormData !== "undefined" &&
      body instanceof FormData &&
      !finalHeaders.has("Content-Type")
    ) {
      // Biarkan browser mengisi multipart boundary sendiri.
      fetchBody = body as BodyInit;
    } else if (isJsonBody(body)) {
      if (!finalHeaders.has("Content-Type")) {
        finalHeaders.set("Content-Type", "application/json");
      }
      fetchBody =
        typeof body === "string" ? body : JSON.stringify(body);
    } else {
      fetchBody = body as BodyInit;
    }
  }

  let res: Response;
  try {
    res = await fetch(joinUrl(path), {
      ...rest,
      headers: finalHeaders,
      body: fetchBody,
      credentials: "include",
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(
      {
        code: "INTERNAL",
        message: "Tidak dapat terhubung ke server. Periksa koneksi Anda.",
      },
      0,
    );
  }

  // 204 / body kosong.
  if (res.status === 204) return undefined as T;

  const json = await parseJsonSafe(res);

  if (isEnvelope(json)) {
    if (json.success) return json.data as T;
    throw new ApiError(
      {
        code: json.error?.code ?? "INTERNAL",
        message: json.error?.message ?? "Terjadi kesalahan pada server.",
        details: json.error?.details,
      },
      res.status,
    );
  }

  if (!res.ok) {
    throw new ApiError(
      {
        code: "INTERNAL",
        message: `Permintaan gagal dengan status ${res.status}.`,
      },
      res.status,
    );
  }

  return json as T;
}

/**
 * Request generik. Mengembalikan `data` dari envelope sukses,
 * melempar `ApiError` untuk envelope error / status non-2xx.
 *
 * Bila respons 401 dan request bukan ke endpoint auth, client mencoba
 * `POST /auth/refresh` SEKALI lalu mengulangi request awal. Bila refresh
 * gagal, ApiError dari refresh yang dilempar. Tidak ada loop: percobaan
 * ulang selalu memakai `skipAuthRefresh: true`.
 */
export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { skipAuthRefresh = false, ...fetchOptions } = options;

  try {
    return await performRequest<T>(path, fetchOptions);
  } catch (err) {
    const needsRefresh =
      err instanceof ApiError &&
      err.status === 401 &&
      !skipAuthRefresh &&
      !isAuthEndpoint(path);

    if (!needsRefresh) throw err;

    try {
      await performRequest<unknown>("/auth/refresh", { method: "POST" });
    } catch (refreshErr) {
      if (refreshErr instanceof ApiError) throw refreshErr;
      throw err;
    }

    return performRequest<T>(path, fetchOptions);
  }
}

export const apiClient = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "PATCH", body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "PUT", body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "DELETE" }),
};
