import type { Metadata, Viewport } from "next";
import "./globals.css";
import AppUpdate from "@/components/AppUpdate";

export const metadata: Metadata = {
  title: "OnePatch",
  description: "인풋리스트 한 번 입력으로 공연 문서와 콘솔 파일까지",
  applicationName: "OnePatch",
  appleWebApp: { capable: true, title: "OnePatch", statusBarStyle: "default" },
  icons: { icon: [{ url: "/icon-192.png", sizes: "192x192" }], apple: "/apple-icon.png" },
};

export const viewport: Viewport = { themeColor: "#111827" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {children}
        <AppUpdate />
      </body>
    </html>
  );
}
