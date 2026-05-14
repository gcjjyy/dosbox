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
  { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
  { rel: "icon", type: "image/x-icon", href: "/favicon.ico" },
  { rel: "icon", type: "image/png", sizes: "96x96", href: "/favicon-96x96.png" },
  { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
  { rel: "manifest", href: "/site.webmanifest" },
  { rel: "stylesheet", href: "/js-dos/js-dos.css" },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  // VT323: pixel-perfect retro CRT mono, used for the boot screen + ASCII art.
  // IBM Plex Mono: refined fallback for body monospace.
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=VT323&family=IBM+Plex+Mono:wght@400;500&display=swap",
  },
  // Galmuri: Korean DOS-era bitmap mono. CDN-hosted, small.
  {
    rel: "stylesheet",
    href: "https://cdn.jsdelivr.net/gh/quiple/galmuri/dist/galmuri.css",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        <script src="/js-dos/js-dos.js" defer />
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
