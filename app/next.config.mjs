/** @type {import('next').NextConfig} */
const isProduction = process.env.NODE_ENV === 'production';

const nextConfig = {
  output: 'export',
  basePath: isProduction ? '/quizzl' : '',
  trailingSlash: true,
  reactStrictMode: true,
};

export default nextConfig;
