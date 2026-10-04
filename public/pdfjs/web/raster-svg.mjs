export const SVG_RENDER_SCALE = 2;

export function canvasSvgImage(canvas) {
  return canvas.toDataURL("image/jpeg", 0.92);
}

/** @param {{width: number, height: number, image: string}[]} pages */
export function buildRasterSvg(pages, gap = 16) {
  const width = Math.max(...pages.map((page) => page.width));
  const height = pages.reduce((sum, page) => sum + page.height, 0) + gap * (pages.length - 1);
  let y = 0;
  const images = pages.map((page) => {
    const markup = `<image x="${(width - page.width) / 2}" y="${y}" width="${page.width}" height="${page.height}" href="${page.image}"/>`;
    y += page.height + gap;
    return markup;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="white"/>${images}</svg>`;
}
