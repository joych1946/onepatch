import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OnePatch",
  description: "인풋리스트 한 번 입력으로 공연 문서와 콘솔 파일까지",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
