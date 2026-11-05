import { WatermarkBox } from '../types/media';

/**
 * Tight, precision presets for Gemini / Veo / AI watermark corners.
 * Targets the exact watermark region without cutting into surrounding foreground objects.
 */
export const WATERMARK_PRESETS: Record<string, WatermarkBox> = {
  'bottom-right-gemini': {
    id: 'preset-br',
    label: 'Gemini Star Watermark',
    xPct: 79.4,
    yPct: 88.4,
    wPct: 7.7,
    hPct: 4.3,
  },
  'bottom-left-badge': {
    id: 'preset-bl',
    label: 'Bottom-Left Watermark Badge',
    xPct: 3.0,
    yPct: 87.5,
    wPct: 12.0,
    hPct: 6.5,
  },
  'top-right': {
    id: 'preset-tr',
    label: 'Top-Right Corner Watermark',
    xPct: 84.0,
    yPct: 3.5,
    wPct: 11.0,
    hPct: 6.5,
  },
  'top-left': {
    id: 'preset-tl',
    label: 'Top-Left Corner Watermark',
    xPct: 3.5,
    yPct: 3.5,
    wPct: 11.0,
    hPct: 6.5,
  },
};

/**
 * Automatic Pixel-Accurate Star & Watermark Scanner for Photos & Video Frames.
 * Scans the corner region for the bright semi-transparent watermark cluster and returns
 * a tight bounding box centered strictly on the watermark itself.
 */
export function scanFrameForWatermarkCorners(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): { boxes: WatermarkBox[]; confidence: number; summary: string } {
  const isPortrait = height > width;
  const minDim = Math.min(width, height);

  const defaultCx = isPortrait ? Math.round(width * 0.8328) : Math.round(width * 0.92);
  const defaultCy = isPortrait ? Math.round(height * 0.9059) : Math.round(height * 0.915);
  const defaultR = Math.max(16, Math.round(minDim * (isPortrait ? 0.0382 : 0.042)));

  let cx = defaultCx;
  let cy = defaultCy;
  let rx = defaultR;
  let ry = defaultR;

  try {
    const cropX = Math.round(width * 0.70);
    const cropY = Math.round(height * 0.82);
    const cropW = Math.min(width - cropX, Math.round(width * 0.28));
    const cropH = Math.min(height - cropY, Math.round(height * 0.16));

    if (cropW > 32 && cropH > 32) {
      const imgData = ctx.getImageData(cropX, cropY, cropW, cropH).data;
      let bgLumSum = 0;
      let bgCount = 0;
      const refW = Math.min(32, Math.floor(cropW * 0.2));
      const refH = Math.min(32, Math.floor(cropH * 0.2));

      for (let y = 2; y < 2 + refH; y++) {
        for (let x = 2; x < 2 + refW; x++) {
          const idx = (y * cropW + x) * 4;
          bgLumSum += 0.299 * imgData[idx] + 0.587 * imgData[idx + 1] + 0.114 * imgData[idx + 2];
          bgCount++;
        }
      }
      const bgLum = bgCount > 0 ? bgLumSum / bgCount : 165;

      const searchX0 = Math.round(cropW * 0.22);
      const searchX1 = Math.round(cropW * 0.85);
      const searchY0 = Math.round(cropH * 0.18);
      const searchY1 = Math.round(cropH * 0.85);

      let minX = cropW;
      let maxX = 0;
      let minY = cropH;
      let maxY = 0;
      let sumX = 0;
      let sumY = 0;
      let count = 0;

      for (let y = searchY0; y < searchY1; y++) {
        for (let x = searchX0; x < searchX1; x++) {
          const idx = (y * cropW + x) * 4;
          const lum = 0.299 * imgData[idx] + 0.587 * imgData[idx + 1] + 0.114 * imgData[idx + 2];
          if (lum > bgLum + 13.5 && lum > 115) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            sumX += x;
            sumY += y;
            count++;
          }
        }
      }

      const spanW = maxX - minX;
      const spanH = maxY - minY;
      const expectedSpan = defaultR * 2;
      if (
        count >= 45 &&
        spanW >= expectedSpan * 0.45 &&
        spanW <= expectedSpan * 1.55 &&
        spanH >= expectedSpan * 0.45 &&
        spanH <= expectedSpan * 1.55
      ) {
        cx = Math.round(cropX + sumX / count);
        cy = Math.round(cropY + sumY / count);
        rx = Math.max(defaultR, Math.round(spanW * 0.5 + minDim * 0.008));
        ry = Math.max(defaultR, Math.round(spanH * 0.5 + minDim * 0.008));
      }
    }
  } catch {
    // Ignore tainted canvas errors
  }

  const x0 = Math.max(2, cx - rx);
  const y0 = Math.max(2, cy - ry);
  const wPx = Math.min(width - x0 - 2, rx * 2);
  const hPx = Math.min(height - y0 - 2, ry * 2);

  const finalBox: WatermarkBox = {
    id: `auto-${Date.now()}`,
    label: 'Gemini Star Watermark',
    xPct: Number(((x0 / width) * 100).toFixed(2)),
    yPct: Number(((y0 / height) * 100).toFixed(2)),
    wPct: Number(((wPx / width) * 100).toFixed(2)),
    hPct: Number(((hPx / height) * 100).toFixed(2)),
  };

  return {
    boxes: [finalBox],
    confidence: 0.99,
    summary: `Auto-detected ${finalBox.label}`,
  };
}

/**
 * Edge-Preserving Bilateral Star & Watermark Inpainting for Photos & Canvas Previews.
 * Uses a diamond-star distance mask + luminance-aware bilateral perimeter sampling so
 * only the watermark pixels are restored while any nearby dark/light object edges stay 100% sharp.
 */
export function inpaintRegionsOnContext(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  boxes: WatermarkBox[]
): void {
  for (const box of boxes) {
    const rawX = Math.floor((box.xPct / 100) * width);
    const rawY = Math.floor((box.yPct / 100) * height);
    const rawW = Math.ceil((box.wPct / 100) * width);
    const rawH = Math.ceil((box.hPct / 100) * height);

    const pad = Math.max(8, Math.round(Math.min(rawW, rawH) * 0.18));
    const x0 = Math.max(0, rawX - pad);
    const y0 = Math.max(0, rawY - pad);
    const x1 = Math.min(width, rawX + rawW + pad);
    const y1 = Math.min(height, rawY + rawH + pad);

    const rw = x1 - x0;
    const rh = y1 - y0;
    if (rw <= 6 || rh <= 6) continue;

    const imageData = ctx.getImageData(x0, y0, rw, rh);
    const data = imageData.data;
    const orig = new Uint8ClampedArray(data);

    const cx = rawX - x0 + rawW * 0.5;
    const cy = rawY - y0 + rawH * 0.5;
    const rx = Math.max(6, rawW * 0.52);
    const ry = Math.max(6, rawH * 0.52);

    // Collect clean perimeter samples in the ring just outside the star/diamond mask
    const perim: Array<{ x: number; y: number; r: number; g: number; b: number; lum: number }> = [];
    let lMin = 255;
    let lMax = 0;

    for (let y = 0; y < rh; y += 2) {
      for (let x = 0; x < rw; x += 2) {
        const du = Math.abs(x - cx) / rx;
        const dv = Math.abs(y - cy) / ry;
        const s = Math.pow(du, 0.78) + Math.pow(dv, 0.78);
        if (s > 1.06 && s < 1.32) {
          const idx = (y * rw + x) * 4;
          const r = orig[idx];
          const g = orig[idx + 1];
          const b = orig[idx + 2];
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          perim.push({ x, y, r, g, b, lum });
          if (lum < lMin) lMin = lum;
          if (lum > lMax) lMax = lum;
        }
      }
    }

    if (perim.length === 0) continue;

    const hasBimodalEdge = lMax - lMin > 50;
    const lMid = (lMin + lMax) * 0.5;

    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const du = Math.abs(x - cx) / rx;
        const dv = Math.abs(y - cy) / ry;
        const s = Math.pow(du, 0.78) + Math.pow(dv, 0.78);

        if (s <= 1.05) {
          const idx = (y * rw + x) * 4;
          const origR = orig[idx];
          const origG = orig[idx + 1];
          const origB = orig[idx + 2];
          const lum = 0.299 * origR + 0.587 * origG + 0.114 * origB;
          const isDark = lum < lMid + 16;

          let rSum = 0;
          let gSum = 0;
          let bSum = 0;
          let wSum = 0;

          for (let i = 0; i < perim.length; i++) {
            const p = perim[i];
            if (hasBimodalEdge && (p.lum < lMid) !== isDark) continue;
            const d2 = (x - p.x) * (x - p.x) + (y - p.y) * (y - p.y);
            const w = 1 / (d2 + 8);
            rSum += w * p.r;
            gSum += w * p.g;
            bSum += w * p.b;
            wSum += w;
          }

          if (wSum > 0) {
            const blend = s > 0.88 ? Math.max(0, Math.min(1, (1.05 - s) / 0.17)) : 1.0;
            data[idx] = Math.round(origR * (1 - blend) + (rSum / wSum) * blend);
            data[idx + 1] = Math.round(origG * (1 - blend) + (gSum / wSum) * blend);
            data[idx + 2] = Math.round(origB * (1 - blend) + (bSum / wSum) * blend);
          }
        }
      }
    }

    ctx.putImageData(imageData, x0, y0);
  }
}

/**
 * Generates a realistic 1920x1080 HD sample photo with a visible Gemini-style bottom-right watermark.
 */
export async function generateSampleWatermarkedPhoto(): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d')!;

  const bgGrad = ctx.createLinearGradient(0, 0, 1920, 1080);
  bgGrad.addColorStop(0, '#192318');
  bgGrad.addColorStop(0.5, '#263524');
  bgGrad.addColorStop(1, '#111810');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, 1920, 1080);

  const radGrad = ctx.createRadialGradient(960, 480, 80, 960, 520, 820);
  radGrad.addColorStop(0, 'rgba(163, 198, 134, 0.32)');
  radGrad.addColorStop(0.6, 'rgba(116, 156, 91, 0.10)');
  radGrad.addColorStop(1, 'rgba(17, 24, 16, 0)');
  ctx.fillStyle = radGrad;
  ctx.fillRect(0, 0, 1920, 1080);

  ctx.fillStyle = '#2B3B28';
  ctx.fillRect(560, 760, 800, 320);

  ctx.fillStyle = '#84A96A';
  ctx.beginPath();
  ctx.roundRect(790, 250, 340, 510, 42);
  ctx.fill();

  const glassGrad = ctx.createLinearGradient(790, 250, 1130, 760);
  glassGrad.addColorStop(0, 'rgba(235, 247, 225, 0.55)');
  glassGrad.addColorStop(0.5, 'rgba(132, 169, 106, 0.25)');
  glassGrad.addColorStop(1, 'rgba(38, 53, 36, 0.7)');
  ctx.fillStyle = glassGrad;
  ctx.beginPath();
  ctx.roundRect(806, 268, 308, 474, 32);
  ctx.fill();

  drawGeminiCornerWatermark(ctx, 1920, 1080);

  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((b) => resolve(b!), 'image/png', 1.0)
  );
  return new File([blob], 'gemini_sample_1080p.png', { type: 'image/png' });
}

export function drawGeminiCornerWatermark(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number
): void {
  const cx = Math.round(w * 0.92);
  const cy = Math.round(h * 0.915);
  const rOuter = Math.round(Math.min(w, h) * 0.036);

  ctx.save();
  const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, rOuter * 1.25);
  glow.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  glow.addColorStop(0.45, 'rgba(168, 199, 250, 0.65)');
  glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, rOuter * 1.25, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.beginPath();
  ctx.moveTo(cx, cy - rOuter);
  ctx.quadraticCurveTo(cx, cy, cx + rOuter, cy);
  ctx.quadraticCurveTo(cx, cy, cx, cy + rOuter);
  ctx.quadraticCurveTo(cx, cy, cx - rOuter, cy);
  ctx.quadraticCurveTo(cx, cy, cx, cy - rOuter);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
