import type { Metadata } from "next";
import { LEGAL, pageMetadata } from "../../lib/seo";
import LegalPage from "./legal";

export const metadata: Metadata = pageMetadata(LEGAL);

export default function Page() {
  return <LegalPage />;
}
