import type { NextConfig } from "next";
import path from "node:path";
import { buildImageRemotePatterns } from "./src/lib/image-remote-patterns";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  images: {
    remotePatterns: buildImageRemotePatterns(),
  },
};

export default nextConfig;
