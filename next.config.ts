import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // pg-boss and Prisma are server-only Node packages
  serverExternalPackages: ['pg-boss', '@prisma/client'],
  experimental: {
    serverActions: { bodySizeLimit: '20mb' },
  },
};

export default nextConfig;
