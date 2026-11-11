import type { MetadataRoute } from "next";

// Web app manifest for installing Teams as an Android PWA.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "DH Teams",
    short_name: "Teams",
    description: "과업별 폴더·파일과 수령/수정 이력을 기록하는 업무 정리 도구",
    lang: "ko",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#171717",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
