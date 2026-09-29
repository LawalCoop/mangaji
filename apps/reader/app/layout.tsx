import type { Metadata } from "next";
import { Anton, Zen_Kaku_Gothic_New } from "next/font/google";
import "./globals.css";
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
  title: "Mangaji — tu manga, animeizado",
  description:
    "Abrí tus CBZ y leelos viñeta por viñeta: la cámara recorre la página y el diálogo aparece cuando le toca.",
};

/**
 * Los pocos glifos japoneses de la portada, pedidos uno por uno.
 *
 * El subset japonés completo son varios MB de kanji; con `text=` Google devuelve solo estos
 * cinco, que es lo único que la página escribe.
 */
const KANA_URL =
  "https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@700;900&text=%E3%83%89%E3%82%A9%E3%83%B3%E6%BC%AB%E7%94%BB%E5%85%90%E7%B5%82&display=swap";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${display.variable} ${body.variable} h-full antialiased`}
    >
      <head>
        {/* Sin servidor que mande las cabeceras de aislamiento —GitHub Pages no deja—, las
            pone un service worker. Donde el servidor ya las manda no hace nada. */}
        <script
          dangerouslySetInnerHTML={{
            __html: "window.coi={coepCredentialless:()=>true,quiet:true}",
          }}
        />
        <script src={asset("/coi-serviceworker.min.js")} />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={KANA_URL} />
      </head>
      <body className="min-h-full flex flex-col overscroll-none font-[family-name:var(--font-body)]">
        {children}
      </body>
    </html>
  );
}
