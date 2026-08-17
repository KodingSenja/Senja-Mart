/** @type {import('next').NextConfig} */

// const withTM = require('next-transpile-modules')(['@babel/preset-react']);
//   '@fullcalendar/common',
//   '@fullcalendar/common',
//   '@fullcalendar/daygrid',
//   '@fullcalendar/interaction',
//   '@fullcalendar/react',

const nextConfig = {
  basePath: process.env.NEXT_PUBLIC_BASE_PATH,
  assetPrefix: process.env.NEXT_PUBLIC_BASE_PATH,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'i.ibb.co' },
      { protocol: 'https', hostname: 'scontent.fotp8-1.fna.fbcdn.net' },
    ],
    // Make ENV
    unoptimized: true,
  },
};

module.exports = nextConfig;
