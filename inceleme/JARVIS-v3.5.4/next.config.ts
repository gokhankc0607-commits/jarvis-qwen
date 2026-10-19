import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite WASM/veri dosyalarını paketlemeden node_modules'tan yükle
  serverExternalPackages: ["@electric-sql/pglite"],
  // Geliştirme sunucusuna dış adreslerden (LAN / ters vekil / önizleme) erişime izin ver
  allowedDevOrigins: ["*"],
};

export default nextConfig;
