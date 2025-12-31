import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  images: { unoptimized: true },
  async redirects() {
    return [
      {
        source: '/models',
        destination: '/recipes',
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
