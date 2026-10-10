/** @type {import('next').NextConfig} */
const isGitHubPages = process.env.GITHUB_ACTIONS === 'true';

const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  // GitHub Pages hosts this project under /writeyourdiary, not at the domain root.
  basePath: isGitHubPages ? '/writeyourdiary' : '',
};

export default nextConfig;