import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // 예전 주소(/shows/[id]/…) → 새 주소(/show…?id=). id를 쿼리에 두어야 페이지를 오프라인용으로 미리 저장할 수 있다.
  async redirects() {
    return [
      { source: "/shows/:id", destination: "/show?id=:id", permanent: true },
      { source: "/shows/:id/print", destination: "/show/print?id=:id", permanent: true },
      { source: "/shows/:id/console", destination: "/show/console?id=:id", permanent: true },
    ];
  },
  // 서비스 워커는 매번 새로 받아 새 버전을 알아챈다
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
