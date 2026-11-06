// Browser-side photo preparation. Re-encoding is what keeps uploads inside the
// D1 row limit and strips EXIF metadata (including GPS) before it leaves the
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
