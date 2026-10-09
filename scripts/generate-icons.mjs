import sharp from "sharp";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="116" fill="#345d49"/><text x="256" y="306" font-family="Georgia,serif" font-size="180" text-anchor="middle" fill="#f6f4ec">180</text><path d="M180 348h152" stroke="#94ab87" stroke-width="5" stroke-linecap="round"/></svg>`;
for (const [name, size] of [
  ["icon-192", 192],
  ["icon-512", 512],
  ["icon-maskable", 512],
  ["apple-touch-icon", 180],
])
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png()
    .toFile(`public/${name}.png`);
