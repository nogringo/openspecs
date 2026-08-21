import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import type { Route } from "./+types/root";
import { ErrorPage } from "./components/error-page";
import "./app.css";

/**
 * The `.ico` first, for the clients that ask for nothing else, then the vector
 * a browser prefers when it understands one. All three are drawn from
 * `public/icon.svg` by `scripts/build-icons.ts`.
 */
export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
  { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
];

export const meta: Route.MetaFunction = () => [
  { title: "Open Specs" },
  {
    name: "description",
    content: "Write, publish and discover technical specifications, on Nostr.",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-dvh bg-paper text-ink antialiased">
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

/**
 * What is left when no route matched, or when one failed before its own
 * boundary could. The same page either way: a reader who lands on a broken
 * address should not be able to tell which of the two happened.
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <ErrorPage error={error} />;
}
