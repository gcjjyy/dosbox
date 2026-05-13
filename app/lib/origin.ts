import { InvalidPayload } from "./errors";

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) throw new InvalidPayload("origin header missing");
  const host = request.headers.get("host") ?? new URL(request.url).host;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new InvalidPayload("origin not a URL");
  }
  if (originHost !== host) {
    throw new InvalidPayload(`origin mismatch: ${originHost} vs ${host}`);
  }
}
