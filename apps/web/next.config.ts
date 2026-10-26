import path from "node:path";
import { config } from "dotenv";
import type { NextConfig } from "next";

// One .env at the repo root serves the web app, db scripts and simulators.
config({ path: path.resolve(process.cwd(), "../../.env") });

const nextConfig: NextConfig = {
  transpilePackages: ["@kds/contracts", "@kds/db", "@kds/domain"],
  serverExternalPackages: ["pg", "bcryptjs"],
  // Compression buffers Server-Sent Events; the KDS screens rely on SSE streaming promptly.
  compress: false,
  poweredByHeader: false,
  devIndicators: false,
  typescript: { tsconfigPath: "tsconfig.json" },
};

export default nextConfig;
