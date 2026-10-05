import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit reads its own data files at runtime, which breaks when bundled.
  serverExternalPackages: ["pdfkit", "googleapis", "jsdom"],
};

export default nextConfig;
