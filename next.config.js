/** @type {import('next').NextConfig} */
const { execSync } = require("node:child_process");

function getGitSha() {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_APP_VERSION:
      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
      process.env.GIT_COMMIT_SHA?.slice(0, 7) ||
      getGitSha() ||
      "dev",
  },
};

module.exports = nextConfig;
