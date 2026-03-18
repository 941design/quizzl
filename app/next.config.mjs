/** @type {import('next').NextConfig} */
const isProduction = process.env.NODE_ENV === 'production';

const nextConfig = {
  output: 'export',
  basePath: isProduction ? '/group-learn' : '',
  trailingSlash: true,
  reactStrictMode: true,
};

export default nextConfig;
