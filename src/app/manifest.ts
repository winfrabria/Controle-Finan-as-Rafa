import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "WinfraBR",
    short_name: "WinfraBR",
    description: "Auditoria inteligente de notas fiscais da construção.",
    start_url: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#075cff",
    icons: [
      {
        src: "/brand/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/brand/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
