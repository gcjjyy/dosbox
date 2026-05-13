import type { Route } from "./+types/dos.jsdos";
import { streamJsdosBundle, getBundleEtag } from "../lib/bundle";

export async function loader({ request }: Route.LoaderArgs) {
  const etag = await getBundleEtag();
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }
  const { body, etag: bodyEtag } = await streamJsdosBundle();
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'inline; filename="dos.jsdos"',
      ETag: bodyEtag,
      "Cache-Control": "no-cache, must-revalidate",
    },
  });
}
