import type { Metadata } from "next";

/**
 * Lo que los buscadores y las vistas previas al compartir necesitan saber del sitio.
 *
 * Las URL van completas: una vista previa de WhatsApp o una tarjeta de redes no resuelve
 * rutas relativas. El idioma se elige con `?lang=`, así que cada página tiene una sola URL
 * y sus variantes por idioma se declaran como alternativas.
 */

export const SITE_URL = "https://mangaji.lawal.coop";
export const LAWAL_URL = "https://lawal.coop";
export const REPO_URL = "https://github.com/LawalCoop/mangaji";

const OG_IMAGE = {
  url: `${SITE_URL}/og.png`,
  width: 1200,
  height: 630,
  alt: "Mangaji: tu manga, animeizado. Lector de CBZ y CBR que recorre la página viñeta por viñeta.",
};

/** Las alternativas por idioma de una ruta del sitio. */
function languages(path: string) {
  const url = `${SITE_URL}${path}`;
  return { es: `${url}?lang=es`, en: `${url}?lang=en`, ja: `${url}?lang=ja`, "x-default": url };
}

/** Metadatos completos de una página: canónica, idiomas, vista previa y tarjeta. */
export function pageMetadata({ path, title, description }: { path: string; title: string; description: string }): Metadata {
  const url = `${SITE_URL}${path}`;
  return {
    title,
    description,
    alternates: { canonical: url, languages: languages(path) },
    openGraph: {
      type: "website",
      url,
      siteName: "Mangaji",
      title,
      description,
      locale: "es_AR",
      alternateLocale: ["en_US", "ja_JP"],
      images: [OG_IMAGE],
    },
    twitter: { card: "summary_large_image", title, description, images: [OG_IMAGE.url] },
  };
}

export const HOME = {
  path: "/",
  title: "Mangaji — tu manga, animeizado | Lector de CBZ y CBR online",
  description:
    "Lector de manga gratis y online: abrí tus archivos CBZ y CBR en el navegador y leelos viñeta por viñeta, con la cámara recorriendo la página y el diálogo apareciendo a su tiempo. Sin subir tus archivos a ningún servidor.",
};

export const HOW = {
  path: "/como-funciona/",
  title: "Cómo funciona — Mangaji",
  description:
    "Del archivo a la escena: cómo Mangaji encuentra viñetas y globos con inteligencia artificial, decide el orden de lectura y dirige cada viñeta, todo dentro de tu navegador.",
};

export const LEGAL = {
  path: "/legal/",
  title: "Términos y privacidad — Mangaji",
  description:
    "Términos de uso y privacidad de Mangaji: tus archivos se abren en tu navegador y no pasan por ningún servidor nuestro.",
};

/** Datos estructurados: para los buscadores, una aplicación web gratuita y libre. */
export const APP_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Mangaji",
  url: `${SITE_URL}/`,
  description: HOME.description,
  applicationCategory: "EntertainmentApplication",
  operatingSystem: "Cualquiera, en el navegador",
  inLanguage: ["es", "en", "ja"],
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  license: `${REPO_URL}/blob/main/LICENSE`,
  codeRepository: REPO_URL,
  image: OG_IMAGE.url,
  author: { "@type": "Organization", name: "Lawal Cooperativa", url: LAWAL_URL },
  publisher: { "@type": "Organization", name: "Lawal Cooperativa", url: LAWAL_URL },
};
