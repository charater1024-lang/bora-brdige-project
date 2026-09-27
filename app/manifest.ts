import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BORA Bridge",
    short_name: "BORA",
    description: "공식 근거와 안전한 다음 행동을 연결하는 포용금융 AI 서비스",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f4ff",
    theme_color: "#6d5bd0",
    lang: "ko",
    icons: [
      {
        src: "/favicon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
