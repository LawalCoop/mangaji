import type { Metadata } from "next";
import HowPage from "./how";

export const metadata: Metadata = {
  title: "Cómo funciona — Mangaji",
  description:
    "Del archivo a la escena: cómo Mangaji encuentra viñetas y globos con dos redes neuronales, decide el orden de lectura y dirige cada viñeta, todo dentro del navegador.",
};

export default function Page() {
  return <HowPage />;
}
