import { I18nProvider } from "@/lib/i18n";
import ReaderView from "./reader-view";

export default function Home() {
  return (
    <I18nProvider>
      <ReaderView />
    </I18nProvider>
  );
}
