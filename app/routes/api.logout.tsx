import type { Route } from "./+types/api.logout";
import { assertSameOrigin } from "../lib/origin";
import { getSession, destroySession } from "../lib/auth.server";
import { toErrorResponse } from "../lib/errors";

export async function action({ request }: Route.ActionArgs) {
  try {
    assertSameOrigin(request);
    const session = await getSession(request);
    const cookie = await destroySession(session);
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
