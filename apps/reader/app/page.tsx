import { DocumentTitle } from "../lib/i18n";
import { APP_JSON_LD } from "../lib/seo";
import ReaderView from "./reader-view";

export default function Home() {
  return (
    <>
      <DocumentTitle page="home" />
      {/* Para los buscadores: qué es esto, quién lo hace y que es gratis y libre. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(APP_JSON_LD) }} />
      <ReaderView />
    </>
  );
}
