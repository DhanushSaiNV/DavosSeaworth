import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

// Web-only root HTML.
// Docs: https://docs.expo.dev/router/advanced/static-rendering/#root-html
//
// NOTE: this file is inert for the current web export. Expo builds `index.html` from
// `public/index.html` (with `%WEB_TITLE%`/`%LANG_ISO_CODE%` substituted) when that file is
// present, and from its own vendor template otherwise — verified by exporting with and without
// `public/index.html`. Keep the identity tags below and in `public/index.html` in sync; this file
// takes over only if the app is switched to `web.output: 'static'`.
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <link rel="icon" href="/favicon.ico" sizes="48x48" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="icon" href="/favicon-32x32.png" type="image/png" sizes="32x32" />
        <link rel="icon" href="/favicon-16x16.png" type="image/png" sizes="16x16" />
        <link rel="icon" href="/favicon.png" type="image/png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#0F1B2D" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: responsiveBackground }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const responsiveBackground = `
body {
  margin: 0;
  background-color: #f9f9fb;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}
::selection {
  background-color: rgba(200, 122, 10, 0.28);
}
* {
  scrollbar-width: thin;
  scrollbar-color: rgba(104, 112, 130, 0.4) transparent;
}
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
::-webkit-scrollbar-thumb {
  background-color: rgba(104, 112, 130, 0.35);
  border: 3px solid transparent;
  border-radius: 999px;
  background-clip: content-box;
}
@media (prefers-color-scheme: dark) {
  body {
    background-color: #08090b;
  }
  ::selection {
    background-color: rgba(245, 165, 36, 0.3);
  }
  * {
    scrollbar-color: rgba(148, 152, 166, 0.4) transparent;
  }
  ::-webkit-scrollbar-thumb {
    background-color: rgba(148, 152, 166, 0.4);
  }
}`;
