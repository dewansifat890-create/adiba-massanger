export interface CompressedImageResult {
  base64: string;
  mimeType: string;
  originalBytes: number;
  compressedBytes: number;
  width: number;
  height: number;
}

const TARGET_MAX_BYTES = 65 * 1024; // ~65 KB target for fast mobile delivery

async function decodeImageElement(file: File): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
}> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup: () => bitmap.close(),
      };
    } catch {
      // Fallback to HTMLImageElement
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode image'));
      el.src = objectUrl;
    });
    return {
      source: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      cleanup: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (err) {
    URL.revokeObjectURL(objectUrl);
    throw err;
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = res.indexOf(',');
      resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
    };
    reader.onerror = () => reject(new Error('Failed to encode image'));
    reader.readAsDataURL(blob);
  });
}

export async function compressImageToFewKb(
  file: File
): Promise<CompressedImageResult> {
  const decoded = await decodeImageElement(file);
  try {
    const dimensionSteps = [1200, 960, 760, 580, 420];
    const qualitySteps = [0.78, 0.62, 0.48, 0.34, 0.24];

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D unavailable');
    }

    // JPEG has universal support across ImgBB, Cloudinary, and all mobile browsers
    const preferredMime = 'image/jpeg';

    let bestBlob: Blob | null = null;
    let bestW = decoded.width;
    let bestH = decoded.height;

    for (const maxDim of dimensionSteps) {
      const scale = Math.min(1, maxDim / Math.max(decoded.width, decoded.height));
      const targetW = Math.max(1, Math.round(decoded.width * scale));
      const targetH = Math.max(1, Math.round(decoded.height * scale));

      canvas.width = targetW;
      canvas.height = targetH;
      ctx.clearRect(0, 0, targetW, targetH);
      ctx.drawImage(decoded.source, 0, 0, targetW, targetH);

      for (const quality of qualitySteps) {
        const blob = await canvasToBlob(canvas, preferredMime, quality);
        if (!blob) continue;

        if (!bestBlob || blob.size < bestBlob.size) {
          bestBlob = blob;
          bestW = targetW;
          bestH = targetH;
        }

        if (blob.size <= TARGET_MAX_BYTES) {
          const base64 = await blobToBase64(blob);
          return {
            base64,
            mimeType: blob.type || preferredMime,
            originalBytes: file.size,
            compressedBytes: blob.size,
            width: targetW,
            height: targetH,
          };
        }
      }
    }

    if (!bestBlob) {
      throw new Error('Image compression failed');
    }

    const base64 = await blobToBase64(bestBlob);
    return {
      base64,
      mimeType: bestBlob.type || preferredMime,
      originalBytes: file.size,
      compressedBytes: bestBlob.size,
      width: bestW,
      height: bestH,
    };
  } finally {
    decoded.cleanup();
  }
}
