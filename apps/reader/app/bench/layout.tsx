import type { Metadata } from "next";

/** Página de mediciones para desarrollo: no tiene nada que buscar. */
export const metadata: Metadata = {
  title: "Bench — Mangaji",
  robots: { index: false, follow: false },
};

export default function BenchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
