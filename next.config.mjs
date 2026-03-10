/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    staleTimes: {
      dynamic: 0, // 關閉動態頁面的 router cache，每次切換都重新抓資料
    },
  },
}

export default nextConfig
