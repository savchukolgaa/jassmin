import type { Route } from "./+types/home";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "Jassmin" },
    { name: "description", content: "Jassmin perfume store" },
  ];
}

export default function Home() {
  return (
    <main className="container mx-auto p-4 pt-16">
      <h1>Jassmin — coming soon</h1>
    </main>
  );
}
