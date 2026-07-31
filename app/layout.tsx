import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const baseUrl = `${protocol}://${host}`;
  const title = "OIP";
  const description =
    "하하하하하";

  return {
    metadataBase: new URL(baseUrl),
    title,
    description,
    applicationName: "OIP",
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: "OIP",
    },
    icons: {
      icon: [
        {
          url: "/oip_logo.png",
          type: "image/png",
          sizes: "1024x1024",
        },
      ],
      shortcut: "/oip_logo.png",
      apple: "/oip_logo.png",
    },
    openGraph: {
      type: "website",
      title,
      description,
      siteName: "OIP",
      images: [
        {
          url: `${baseUrl}/og.png`,
          width: 1729,
          height: 910,
          alt: "OIP",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`${baseUrl}/og.png`],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#12161b" },
  ],
};

const themeScript = `
(function() {
  try {
    var stored = localStorage.getItem('oip.theme');
    var theme = stored === 'dark' || stored === 'light'
      ? stored
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
