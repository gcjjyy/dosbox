import type { Route } from "./+types/dosbox.conf";
import { DOSBOX_CONF, getDosboxConfEtag } from "../lib/bundle";

export async function loader({ request }: Route.LoaderArgs) {
  const etag = getDosboxConfEtag();
  if (request.headers.get("If-None-Match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  return new Response(DOSBOX_CONF, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Length": String(new TextEncoder().encode(DOSBOX_CONF).length),
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: etag,
    },
  });
}
