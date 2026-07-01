import { Html, Head, Main, NextScript } from "next/document";
import { buildFontLinkHref } from "@/src/themes/fontUnion";
import { THEME_FONTS } from "@/src/themes/registry.generated";

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href={buildFontLinkHref(THEME_FONTS)} rel="stylesheet" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
