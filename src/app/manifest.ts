import type { MetadataRoute } from "next";

/** 홈 화면에 추가 (PWA). 오프라인 동작은 public/sw.js (scripts/build-sw.mjs) */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OnePatch — 공연 인풋리스트",
    short_name: "OnePatch",
    description: "인풋리스트 한 번 입력으로 공연 문서와 콘솔 파일까지",
    lang: "ko",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#111827",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
