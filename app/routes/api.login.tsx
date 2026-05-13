import type { Route } from "./+types/api.login";
import { z } from "zod";
import {
  verifyPassword,
  checkLoginRate,
  getSession,
  commitSession,
} from "../lib/auth.server";
import { assertSameOrigin } from "../lib/origin";
import { toErrorResponse } from "../lib/errors";
import { InvalidPayload, Unauthorized, RateLimited } from "../lib/errors";

const Body = z.object({ password: z.string().max(256) });

export async function action({ request }: Route.ActionArgs) {
  try {
    assertSameOrigin(request);
    const ip = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for") ?? "unknown";
    if (!checkLoginRate(ip.split(",")[0]!.trim())) throw new RateLimited();

    const ct = request.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) throw new InvalidPayload("expected application/json");

    const raw = await request.json().catch(() => null);
    const parsed = Body.safeParse(raw);
    if (!parsed.success) throw new InvalidPayload("bad payload");

    if (!verifyPassword(parsed.data.password)) {
      console.warn(`[login] failed ip=${ip}`);
      throw new Unauthorized();
    }

    const session = await getSession(request);
    session.set("isAdmin", true);
    const cookie = await commitSession(session);
    console.log(`[login] success ip=${ip}`);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Set-Cookie": cookie },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export function loader() {
  return new Response("method not allowed", { status: 405 });
}
