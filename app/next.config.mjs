/** @type {import('next').NextConfig} */
const isProduction = process.env.NODE_ENV === 'production';

const nextConfig = {
  output: 'export',
  basePath: isProduction ? '/quizzl' : '',
  trailingSlash: true,
  reactStrictMode: true,

  // Disable SWC minification — the ts-mls package contains bitwise expressions
  // that crash the SWC optimizer (FRACTIONAL_BITWISE_OPERAND). Use Terser instead.
  // This setting is deprecated in Next.js 15 but required here for Next.js 14.
  swcMinify: false,

  webpack: (config) => {
    // For modules that crash SWC's optimizer, use a custom babel-loader rule
    // that handles only those specific packages.
    config.module.rules.push({
      test: /\.m?js$/,
      include: [
        /node_modules\/ts-mls/,
        /node_modules\/@internet-privacy\/marmot-ts/,
        /node_modules\/@noble\/post-quantum/,
        /node_modules\/@hpke\//,
      ],
      use: {
        // Use next-swc with no optimization for these files
        loader: 'next-swc-loader',
        options: {
          isServer: false,
          pagesDir: undefined,
          hasServerComponents: false,
          fileReading: false,
        },
      },
    });

    return config;
  },
};

export default nextConfig;
