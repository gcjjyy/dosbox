import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import type { Route } from "./+types/root";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "stylesheet", href: "https://v8.js-dos.com/latest/js-dos.css" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        <script src="https://v8.js-dos.com/latest/js-dos.js" defer />
      </head>
      <body className="h-screen w-screen overflow-hidden">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : "Unexpected error";
  const details = isRouteErrorResponse(error) ? error.data : (error instanceof Error ? error.message : "");
  return (
    <main className="grid min-h-screen place-items-center p-4 text-center">
      <div>
        <h1 className="text-xl font-semibold">{message}</h1>
        <p className="mt-2 text-sm text-gray-500">{String(details)}</p>
      </div>
    </main>
  );
}
