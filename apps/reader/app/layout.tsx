import type { Metadata, Viewport } from "next";
import { Anton, Zen_Kaku_Gothic_New } from "next/font/google";
import "./globals.css";
import { Analytics } from "./analytics";
import { HOME, LAWAL_URL, SITE_URL, pageMetadata } from "@/lib/seo";
import { asset } from "@/lib/base";

/** Condensada y pesada: el peso de una onomatopeya. Se usa solo en titulares. */
const display = Anton({
  variable: "--font-display",
  weight: "400",
  subsets: ["latin"],
});

/** Gótica japonesa: del mundo del manga, y legible en cuerpos chicos. */
const body = Zen_Kaku_Gothic_New({
  variable: "--font-body",
  weight: ["400", "500", "700", "900"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(`${SITE_URL}/`),
  applicationName: "Mangaji",
  authors: [{ name: "Lawal Cooperativa", url: LAWAL_URL }],
  creator: "Lawal Cooperativa",
  publisher: "Lawal Cooperativa",
  keywords: [
    "lector de manga",
    "leer manga online",
    "CBZ",
    "CBR",
    "lector CBZ",
    "lector CBR",
    "manga reader",
    "comic reader",
    "viñeta por viñeta",
    "software libre",
  ],
  robots: { index: true, follow: true },
  ...pageMetadata(HOME),
};

/**
 * Pantalla completa en el celular, notch incluido: el lector dibuja hasta el borde y la barra
 * de controles se corre sola para no quedar bajo la zona del gesto de inicio.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#121214",
  colorScheme: "dark",
};

/**
 * Los pocos glifos japoneses de la portada, pedidos uno por uno.
 *
 * El subset japonés completo son varios MB de kanji; con `text=` Google devuelve solo estos
 * pocos, que es lo único que las páginas escriben.
 */
const KANA_URL =
  "https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@700;900&text=%E3%83%89%E3%82%A9%E3%83%B3%E6%BC%AB%E7%94%BB%E5%85%90%E7%B5%82%E4%BB%95%E7%B5%84%E3%81%BF%E3%82%B4%E7%AC%AC%E4%B8%80%E8%A9%B1%E3%81%A4%E3%81%A5%E3%81%8F%E4%BA%8C%E3%82%AB%E3%83%81%E3%83%83&display=swap";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${display.variable} ${body.variable} h-full antialiased`}
    >
      <head>
        {/* Sin servidor que mande las cabeceras de aislamiento —GitHub Pages no deja—, las
            pone un service worker. Donde el servidor ya las manda no hace nada.
            `require-corp` y no `credentialless`: Safari no conoce el segundo, y ahí el iPhone
            se quedaba sin hilos. Por eso la hoja de Google va con `crossOrigin`, que es lo
            que `require-corp` le pide a un recurso de otro origen. */}
        <script
          dangerouslySetInnerHTML={{
            __html: "window.coi={coepCredentialless:()=>false,quiet:true}",
          }}
        />
        <script src={asset("/coi-serviceworker.min.js")} />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={KANA_URL} crossOrigin="anonymous" />
      </head>
      <body className="min-h-full flex flex-col overscroll-none font-[family-name:var(--body)]">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
