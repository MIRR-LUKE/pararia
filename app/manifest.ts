import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/teacher",
    name: "PARARIA Teacher App",
    short_name: "PARARIA",
    description: "先生が校舎端末で面談録音を進めるための Teacher App",
    start_url: "/teacher",
    scope: "/teacher",
    display: "standalone",
    orientation: "portrait",
    background_color: "#171717",
    theme_color: "#171717",
    lang: "ja",
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
