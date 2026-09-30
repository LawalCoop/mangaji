import type { Lang } from "./i18n";

/**
 * Términos y privacidad.
 *
 * Describen lo que Mangaji hace de verdad: una herramienta que corre en el navegador de cada
 * persona y no recibe, guarda ni distribuye archivos. Si el funcionamiento cambia —cuentas,
 * un servidor, una tienda—, estos textos tienen que cambiar con él.
 *
 * Redactados sin asesoramiento legal: conviene que los revise alguien de derecho. Si las
 * versiones difieren, prevalece la española.
 */

export const LEGAL_EMAIL = "info@lawal.coop";

type Section = { title: string; body: string[] };
type Legal = { title: string; updated: string; intro: string; sections: Section[] };

export const LEGAL: Record<Lang, Legal> = {
  es: {
    title: "Términos y privacidad",
    updated: "Última actualización: 30 de septiembre de 2026",
    intro:
      "Estos términos regulan el uso de Mangaji (mangaji.lawal.coop). Al usar el sitio, los aceptás. Si no estás de acuerdo, no lo uses.",
    sections: [
      {
        title: "Qué es Mangaji",
        body: [
          "Mangaji es un lector de manga desarrollado por Lawal Cooperativa (lawal.coop) y publicado como software libre bajo licencia MIT. Es una herramienta gratuita que funciona por completo dentro de tu navegador.",
        ],
      },
      {
        title: "Tus archivos no pasan por nosotros",
        body: [
          "Los archivos que abrís se leen y se procesan en tu dispositivo. Mangaji no los recibe, no los guarda, no los aloja, no los distribuye y no los comparte con terceros.",
          "Mangaji no ofrece un catálogo de obras ni enlaces a contenido: no hay nada nuestro para leer, descargar o compartir. Cuando abrís un archivo desde un link, tu navegador lo descarga directamente del sitio que indicaste, sin pasar por ningún servidor nuestro.",
        ],
      },
      {
        title: "Tu responsabilidad",
        body: [
          "Usá Mangaji solo con archivos que tengas derecho a leer: obras que compraste en formato digital, obras propias, de dominio público o con una licencia que lo permita.",
          "Sos el único responsable del contenido que abrís, de su origen y de cumplir las leyes de propiedad intelectual que te correspondan, incluida la Ley 11.723 de Propiedad Intelectual de la República Argentina. No uses Mangaji para infringir derechos de terceros. Lawal Cooperativa no controla, no revisa y no conoce los archivos que se abren con la herramienta.",
        ],
      },
      {
        title: "Sitios de terceros",
        body: [
          "Los links que pegás llevan a sitios ajenos a Mangaji. No los controlamos ni respondemos por su contenido, su disponibilidad ni sus condiciones de uso.",
        ],
      },
      {
        title: "Sin garantías",
        body: [
          "Mangaji se ofrece «tal cual es», sin garantías de ningún tipo. La detección de viñetas, el orden de lectura y la separación del diálogo son automáticos y pueden fallar. El sitio puede tener errores, interrupciones o cambios sin aviso.",
        ],
      },
      {
        title: "Límite de responsabilidad",
        body: [
          "En la máxima medida que permita la ley, Lawal Cooperativa no será responsable por daños directos o indirectos derivados del uso de Mangaji o de la imposibilidad de usarlo, ni por el contenido que las personas abran con la herramienta.",
        ],
      },
      {
        title: "Propiedad intelectual",
        body: [
          "El código de Mangaji es software libre bajo licencia MIT. Las obras que abras siguen perteneciendo a sus autores y editoriales. Los nombres y marcas de terceros mencionados pertenecen a sus respectivos titulares.",
        ],
      },
      {
        title: "Privacidad",
        body: [
          "No hay cuentas, no pedimos datos personales y no usamos cookies.",
          "Contamos las visitas de forma anónima con GoatCounter: qué páginas se ven, desde qué país, con qué tipo de dispositivo y desde qué sitio se llega, sin identificar a nadie.",
          "Tu navegador guarda el idioma que elegiste y si ya viste la ayuda de gestos; podés borrarlos cuando quieras desde su configuración. Los modelos de detección se descargan de este sitio, y el navegador puede guardarlos en su caché.",
        ],
      },
      {
        title: "Avisos y reclamos",
        body: [
          `Si creés que Mangaji infringe algún derecho, escribinos a ${LEGAL_EMAIL}. Tené en cuenta que no alojamos ni distribuimos contenido: no hay obras nuestras para retirar. Respondemos los reclamos sobre el sitio y su código.`,
        ],
      },
      {
        title: "Cambios",
        body: [
          "Podemos actualizar estos términos. La versión vigente es la publicada en esta página, con su fecha de actualización.",
        ],
      },
      {
        title: "Ley aplicable",
        body: [
          "Estos términos se rigen por las leyes de la República Argentina. Si hay diferencias entre esta versión y las traducciones, prevalece la versión en español.",
        ],
      },
    ],
  },

  en: {
    title: "Terms and privacy",
    updated: "Last updated: September 30, 2026",
    intro:
      "These terms govern the use of Mangaji (mangaji.lawal.coop). By using the site, you accept them. If you don't agree, don't use it. This is a translation: if it differs from the Spanish version, the Spanish version prevails.",
    sections: [
      {
        title: "What Mangaji is",
        body: [
          "Mangaji is a manga reader developed by Lawal Cooperativa (lawal.coop) and released as free software under the MIT license. It is a free tool that runs entirely inside your browser.",
        ],
      },
      {
        title: "Your files never go through us",
        body: [
          "The files you open are read and processed on your device. Mangaji does not receive, store, host, distribute or share them with third parties.",
          "Mangaji offers no catalog of works and no links to content: there is nothing of ours to read, download or share. When you open a file from a link, your browser downloads it directly from the site you entered, without going through any server of ours.",
        ],
      },
      {
        title: "Your responsibility",
        body: [
          "Only use Mangaji with files you have the right to read: works you bought in digital form, your own works, public domain works, or works under a license that allows it.",
          "You alone are responsible for the content you open, where it comes from, and complying with the intellectual property laws that apply to you. Don't use Mangaji to infringe the rights of others. Lawal Cooperativa does not control, review or know the files opened with the tool.",
        ],
      },
      {
        title: "Third-party sites",
        body: [
          "The links you paste lead to sites unrelated to Mangaji. We don't control them and are not responsible for their content, availability or terms of use.",
        ],
      },
      {
        title: "No warranty",
        body: [
          "Mangaji is provided “as is”, without warranties of any kind. Panel detection, reading order and dialogue separation are automatic and can fail. The site may have errors, interruptions or changes without notice.",
        ],
      },
      {
        title: "Limitation of liability",
        body: [
          "To the fullest extent permitted by law, Lawal Cooperativa will not be liable for direct or indirect damages arising from the use of Mangaji or the inability to use it, nor for the content people open with the tool.",
        ],
      },
      {
        title: "Intellectual property",
        body: [
          "Mangaji's code is free software under the MIT license. The works you open remain the property of their authors and publishers. Third-party names and trademarks mentioned belong to their respective owners.",
        ],
      },
      {
        title: "Privacy",
        body: [
          "There are no accounts, we don't ask for personal data, and we don't use cookies.",
          "We count visits anonymously with GoatCounter: which pages are viewed, from which country, on what kind of device and from which site people arrive, without identifying anyone.",
          "Your browser stores the language you chose and whether you've seen the gesture hint; you can clear them anytime from its settings. The detection models are downloaded from this site, and the browser may keep them in its cache.",
        ],
      },
      {
        title: "Notices and complaints",
        body: [
          `If you believe Mangaji infringes any right, write to us at ${LEGAL_EMAIL}. Keep in mind that we don't host or distribute content: there are no works of ours to take down. We answer complaints about the site and its code.`,
        ],
      },
      {
        title: "Changes",
        body: [
          "We may update these terms. The current version is the one published on this page, with its update date.",
        ],
      },
      {
        title: "Governing law",
        body: ["These terms are governed by the laws of the Argentine Republic."],
      },
    ],
  },

  ja: {
    title: "利用規約とプライバシー",
    updated: "最終更新日：2026 年 9 月 30 日",
    intro:
      "本規約は Mangaji（mangaji.lawal.coop）の利用について定めるものです。本サイトを利用することで、本規約に同意したものとみなされます。同意できない場合は利用しないでください。これは翻訳です。スペイン語版と内容が異なる場合は、スペイン語版が優先されます。",
    sections: [
      {
        title: "Mangaji について",
        body: [
          "Mangaji は、ソフトウェア協同組合 Lawal（lawal.coop）が開発し、MIT ライセンスのフリーソフトウェアとして公開しているマンガリーダーです。すべてブラウザの中で動く、無料のツールです。",
        ],
      },
      {
        title: "ファイルは私たちを経由しません",
        body: [
          "あなたが開いたファイルは、あなたの端末の中で読み込まれ、処理されます。Mangaji はファイルを受け取らず、保存・ホスティング・配布せず、第三者と共有することもありません。",
          "Mangaji は作品のカタログやコンテンツへのリンクを提供しません。私たちが提供する読み物・ダウンロード・共有できるものはありません。リンクからファイルを開く場合、ブラウザは指定されたサイトから直接ダウンロードし、私たちのサーバーは経由しません。",
        ],
      },
      {
        title: "利用者の責任",
        body: [
          "Mangaji は、読む権利のあるファイルにのみ使用してください。電子版として購入した作品、ご自身の作品、パブリックドメインの作品、または利用が許諾されている作品などです。",
          "開くコンテンツ、その入手元、そして適用される知的財産法の遵守については、利用者ご自身が単独で責任を負います。第三者の権利を侵害する目的で Mangaji を使用しないでください。Lawal は、このツールで開かれるファイルを管理・確認しておらず、その内容を知ることもありません。",
        ],
      },
      {
        title: "第三者のサイト",
        body: [
          "貼り付けたリンクの先は、Mangaji とは関係のないサイトです。私たちはそれらを管理しておらず、その内容・可用性・利用条件について責任を負いません。",
        ],
      },
      {
        title: "無保証",
        body: [
          "Mangaji は「現状のまま」提供され、いかなる保証もありません。コマの検出、読む順番、セリフの切り出しは自動で行われるため、誤りが生じることがあります。本サイトには不具合や中断があり、予告なく変更されることがあります。",
        ],
      },
      {
        title: "責任の制限",
        body: [
          "法律で認められる最大限の範囲で、Lawal は、Mangaji の利用または利用できないことに起因する直接・間接の損害、および利用者がこのツールで開くコンテンツについて、責任を負いません。",
        ],
      },
      {
        title: "知的財産",
        body: [
          "Mangaji のコードは MIT ライセンスのフリーソフトウェアです。あなたが開く作品の権利は、引き続きその作者と出版社に帰属します。記載されている第三者の名称や商標は、それぞれの権利者に帰属します。",
        ],
      },
      {
        title: "プライバシー",
        body: [
          "アカウントはなく、個人情報を求めることも、クッキーを使うこともありません。",
          "アクセス数は GoatCounter で匿名に集計しています。見られたページ、国、端末の種類、どのサイトから来たかを、個人を特定せずに記録します。",
          "ブラウザには、選んだ言語と操作ガイドを見たかどうかが保存されます。これらはブラウザの設定からいつでも削除できます。検出モデルはこのサイトからダウンロードされ、ブラウザのキャッシュに保存されることがあります。",
        ],
      },
      {
        title: "通知と苦情",
        body: [
          `Mangaji が何らかの権利を侵害しているとお考えの場合は、${LEGAL_EMAIL} までご連絡ください。なお、私たちはコンテンツをホスティング・配布していないため、削除できる作品はありません。本サイトとそのコードに関するお問い合わせにお答えします。`,
        ],
      },
      {
        title: "変更",
        body: ["本規約は更新されることがあります。有効な版は、このページに更新日とともに掲載されているものです。"],
      },
      {
        title: "準拠法",
        body: ["本規約は、アルゼンチン共和国の法律に準拠します。"],
      },
    ],
  },
};
