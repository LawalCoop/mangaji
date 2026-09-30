import type { MetadataRoute } from "next";
import { HOME, HOW, LEGAL, SITE_URL } from "@/lib/seo";

// La exportación estática necesita que el sitemap se arme una sola vez, al compilar.
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return [HOME, HOW, LEGAL].map((page) => {
    const url = `${SITE_URL}${page.path}`;
    return {
      url,
      changeFrequency: page === LEGAL ? "yearly" : "monthly",
      priority: page === HOME ? 1 : page === HOW ? 0.7 : 0.3,
      alternates: {
        languages: { es: `${url}?lang=es`, en: `${url}?lang=en`, ja: `${url}?lang=ja` },
      },
    };
  });
}
