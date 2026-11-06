// Browser-side photo preparation. Re-encoding is what keeps uploads inside the
// storage limit and strips EXIF metadata (including GPS) before it leaves the
// device.

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

export async function resizePhoto(
  file: File,
  options: { maxDimension?: number; maxBytes: number } = { maxBytes: 1_800_000 },
): Promise<Blob> {
  if (!ACCEPTED.includes(file.type)) {
    throw new Error('Use JPEG, PNG or WebP. iPhone HEIC files need converting first.');
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('That file could not be read as an image.');
  }

  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(1, (options.maxDimension || 1800) / longest);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot resize images.');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  for (const quality of [0.86, 0.74, 0.6, 0.45]) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((value) => resolve(value), 'image/jpeg', quality),
    );
    if (blob && blob.size <= options.maxBytes) return blob;
  }
  throw new Error('That photo is too large even after resizing. Try a smaller one.');
}

/**
 * Grabs one frame from a local video for the feed and the moderation queue.
 * Nothing is uploaded for this: the frame is drawn on a canvas in the browser.
 */
export async function capturePoster(
  file: File,
  duration: number,
): Promise<{ poster: Blob | null; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  const ready = new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('This browser could not read that video.'));
  });

  try {
    await ready;
    const width = video.videoWidth;
    const height = video.videoHeight;
    try {
      video.currentTime = Math.min(1, Math.max(0.05, duration / 3));
    } catch {
      /* some browsers refuse seeking before playback; the first frame is fine */
    }
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      window.setTimeout(resolve, 900);
    });

    const scale = Math.min(1, 1280 / Math.max(width, height, 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) return { poster: null, width, height };
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const poster = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((value) => resolve(value), 'image/jpeg', 0.74),
    );
    return { poster, width, height };
  } catch {
    return { poster: null, width: 0, height: 0 };
  } finally {
    URL.revokeObjectURL(url);
  }
}
