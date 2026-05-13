export class PathEscapeError extends Error {
  readonly code = "invalid_path" as const;
  constructor(public readonly attemptedPath: string) {
    super(`path escape: ${attemptedPath}`);
  }
}

export class InvalidPayload extends Error {
  readonly code = "invalid_payload" as const;
  constructor(message: string) {
    super(message);
  }
}

export class Unauthorized extends Error {
  readonly code = "unauthorized" as const;
  constructor() {
    super("unauthorized");
  }
}

export class PayloadTooLarge extends Error {
  readonly code = "too_large" as const;
  constructor(message: string) {
    super(message);
  }
}

export class RateLimited extends Error {
  readonly code = "rate_limited" as const;
  constructor() {
    super("rate limited");
  }
}

const STATUS_FOR_CODE = {
  invalid_path: 400,
  invalid_payload: 400,
  unauthorized: 401,
  too_large: 413,
  rate_limited: 429,
} as const;

type KnownCode = keyof typeof STATUS_FOR_CODE;
type KnownError = { code: KnownCode; message: string };

export function toErrorResponse(err: unknown): Response {
  if (err && typeof err === "object" && "code" in err && typeof (err as KnownError).code === "string"
      && (err as KnownError).code in STATUS_FOR_CODE) {
    const e = err as KnownError;
    const status = STATUS_FOR_CODE[e.code];
    return Response.json({ error: e.code, message: e.message }, { status });
  }
  console.error("unexpected error in action:", err);
  return Response.json({ error: "internal", message: "internal server error" }, { status: 500 });
}
