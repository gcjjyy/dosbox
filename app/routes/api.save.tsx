export async function action() {
  return new Response("not implemented", { status: 501 });
}
export function loader() {
  return new Response("method not allowed", { status: 405 });
}
