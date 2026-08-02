const nextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: process.cwd(),
  },
  experimental: {
    webpackBuildWorker: false,
  },
}

export default nextConfig
