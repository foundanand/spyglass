/** @type {import("next").NextConfig} */
const nextConfig = {
  // The SDK is consumed straight from the workspace as TypeScript source.
  transpilePackages: ["@spyglass/sdk"],
};

export default nextConfig;
