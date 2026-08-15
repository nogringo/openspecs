import type { Route } from "./+types/home";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Open Specs" },
    {
      name: "description",
      content:
        "Write, publish and discover technical specifications. Signed by their authors, stored on Nostr relays, readable by anyone.",
    },
  ];
}

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 py-24">
      <h1 className="text-4xl font-semibold tracking-tight">Open Specs</h1>
      <p className="mt-4 text-lg text-gray-600 dark:text-gray-400">
        Write, publish and discover technical specifications. Signed by their authors, stored on
        Nostr relays, readable by anyone.
      </p>
      <p className="mt-8 text-sm text-gray-500 dark:text-gray-500">
        Under construction. Follow along in{" "}
        <code className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-900">ROADMAP.md</code>.
      </p>
    </main>
  );
}
