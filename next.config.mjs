/** @type {import('next').NextConfig} */
const nextConfig = {
  // src/compile and src/prefill import each other with explicit `.ts` extensions
  // so they also work under `node --experimental-strip-types` directly. Next.js's
  // bundler resolves these via allowImportingTsExtensions in tsconfig.
  // typedRoutes can be re-enabled once the wizard's hrefs stabilise.
};

export default nextConfig;
