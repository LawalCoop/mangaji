import type { Metadata } from "next";
import { Anton, Zen_Kaku_Gothic_New } from "next/font/google";
import "./globals.css";

/** Condensada y pesada: el peso de una onomatopeya. Se usa solo en titulares. */
const display = Anton({
  variable: "--font-display",
  weight: "400",
  subsets: ["latin"],
});

/** Gótica japonesa: del mundo del manga, y legible en cuerpos chicos. */
const body = Zen_Kaku_Gothic_New({
  variable: "--font-body",
  weight: ["400", "500", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Manganime — tu manga, dirigido",
  description:
    "Lee tus CBZ viñeta por viñeta, con la cámara viajando por la página y el diálogo apareciendo cuando le toca.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${display.variable} ${body.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col overscroll-none font-[family-name:var(--font-body)]">
        {children}
      </body>
    </html>
  );
}
