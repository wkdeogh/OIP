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
    "대호와 상희가 일정, 장보기, 여행, 냉장고와 주차 위치를 함께 관리하는 생활 앱";

  return {
    metadataBase: new URL(baseUrl),
    title,
    description,
    applicationName: "OIP",
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
  themeColor: "#f7f8f2",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
