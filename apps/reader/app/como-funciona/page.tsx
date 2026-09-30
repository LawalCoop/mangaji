import type { Metadata } from "next";
import { HOW, pageMetadata } from "@/lib/seo";
import HowPage from "./how";

export const metadata: Metadata = pageMetadata(HOW);

export default function Page() {
  return <HowPage />;
}
