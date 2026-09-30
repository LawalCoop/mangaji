import type { MetadataRoute } from "next";
import { HOME, HOW, SITE_URL } from "@/lib/seo";

// La exportación estática necesita que el sitemap se arme una sola vez, al compilar.
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [HOME, HOW].map((page) => {
    const url = `${SITE_URL}${page.path}`;
    return {
      url,
      changeFrequency: "monthly",
      priority: page === HOME ? 1 : 0.7,
      alternates: {
        languages: { es: `${url}?lang=es`, en: `${url}?lang=en`, ja: `${url}?lang=ja` },
      },
    };
  });
}
