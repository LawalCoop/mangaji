"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Estadísticas de visitas con GoatCounter: libre, sin cookies y sin datos personales, así
 * que no hace falta banner de consentimiento. Solo cuenta qué página se vio; el tomo que se
 * abre no sale del navegador.
 *
 * Se activa con `NEXT_PUBLIC_GOATCOUNTER` (el nombre del sitio en goatcounter.com). Sin él
 * no se carga nada, y en localhost GoatCounter no cuenta.
 */

const CODE = process.env.NEXT_PUBLIC_GOATCOUNTER;
const SCRIPT_ID = "goatcounter";

type GoatCounter = { count?: (vars: { path: string }) => void };

export function Analytics() {
  const pathname = usePathname();

  useEffect(() => {
    if (!CODE) return;

    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.async = true;
      script.src = "https://gc.zgo.at/count.js";
      // El aislamiento de origen exige pedir con CORS un script de otro dominio.
      script.crossOrigin = "anonymous";
      script.dataset.goatcounter = `https://${CODE}.goatcounter.com/count`;
      // Se cuenta a mano: el sitio cambia de página sin recargar, y el conteo automático
      // solo vería la primera.
      script.dataset.goatcounterSettings = JSON.stringify({ no_onload: true });
      document.head.appendChild(script);
    }

    const path = window.location.pathname;
    const send = () => (window as unknown as { goatcounter?: GoatCounter }).goatcounter?.count?.({ path });
    if ((window as unknown as { goatcounter?: GoatCounter }).goatcounter?.count) send();
    else script.addEventListener("load", send, { once: true });
  }, [pathname]);

  return null;
}
