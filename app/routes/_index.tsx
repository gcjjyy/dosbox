import type { Route } from "./+types/_index";

export function meta(_: Route.MetaArgs) {
  return [{ title: "dosbox.gcjjyy.dev" }];
}

export function loader() {
  return { isAdmin: false };
}

export default function Index({ loaderData }: Route.ComponentProps) {
  return (
    <main className="min-h-screen grid place-items-center text-sm">
      <p>dosbox stub — admin: {String(loaderData.isAdmin)}</p>
    </main>
  );
}
