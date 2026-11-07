// Browser-side video preparation. WebCodecs does the encoding on the device, so
// the original footage never leaves it and only the smaller MP4 is uploaded.
// Mediabunny handles demuxing, scaling and muxing; ffmpeg.wasm is not used
// because GitHub Pages cannot serve the COOP/COEP headers its threads need.

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  canEncodeVideo,
} from 'mediabunny';

const AUDIO_BUDGET_BPS = 160_000;
const MAX_VIDEO_BPS = 6_000_000;
const MIN_VIDEO_BPS = 300_000;
/** Leave headroom for MP4 overhead and the encoder's bitrate estimate. */
const SIZE_SAFETY = 0.76;

export class CompressionUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompressionUnsupportedError';
  }
}

export class CompressionCanceledError extends Error {
  constructor() {
    super('Compression cancelled.');
    this.name = 'CompressionCanceledError';
  }
}

export interface CompressVideoOptions {
  /** Hard ceiling for the finished MP4, from the server's upload limit. */
  maxBytes: number;
  signal?: AbortSignal;
  onProgress?: (progress: number, label: string) => void;
}

export interface CompressedVideo {
  file: File;
  width: number;
  height: number;
  duration: number;
  originalBytes: number;
}

function aborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new CompressionCanceledError();
}

function even(value: number) {
  return Math.max(2, Math.round(value / 2) * 2);
}

/**
 * Pick the largest frame the bitrate can actually support. Below roughly
 * 1 Mbps a 1080p frame turns to mush, so long clips step down instead of
 * pretending to be high definition.
 */
function frameFor(width: number, height: number, bitrate: number) {
  const limit = bitrate >= 2_200_000 ? 1080 : bitrate >= 1_000_000 ? 720 : 540;
  const maxWidth = Math.round((limit * 16) / 9);
  const scale = Math.min(1, maxWidth / width, limit / height);
  return { width: even(width * scale), height: even(height * scale) };
}

async function makeEncoding(
  input: Input,
  width: number,
  height: number,
  bitrate: number,
  frameRate: number | undefined,
  hasAudio: boolean,
) {
  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget(),
  });

  const conversion = await Conversion.init({
    input,
    output,
    video: {
      codec: 'avc',
      width,
      height,
      fit: 'contain',
      frameRate,
      quality: new Quality({ bitrate, bitrateMode: 'variable' }),
      keyFrameInterval: 4,
      forceTranscode: true,
      // Bake rotation into the pixels. GoPro files often carry a rotation
      // matrix, and baked frames cannot end up sideways in another player.
      allowTransformationMetadata: false,
    },
    audio: hasAudio ? { discard: false } : { discard: true },
    // Start from no descriptive tags, which also drops GoPro's location data.
    tags: {},
    showWarnings: false,
  });

  if (!conversion.isValid) {
    const reasons = conversion.discardedTracks.map((item) => item.reason).join(' ');
    throw new CompressionUnsupportedError(
      reasons.includes('undecodable')
        ? 'This browser cannot decode that video. Try exporting it as an H.264 MP4.'
        : 'This browser cannot encode that video into a web-friendly MP4.',
    );
  }

  return { conversion, output };
}

/**
 * Re-encode a local file to H.264 MP4 at up to 1080p, sized to fit maxBytes.
 * Throws CompressionUnsupportedError when the browser has no usable decoder or
 * encoder, so the caller can explain the fallback rather than send a file the
 * server will reject.
 */
export async function compressVideo(
  file: File,
  options: CompressVideoOptions,
): Promise<CompressedVideo> {
  const { maxBytes, signal, onProgress } = options;
  aborted(signal);

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

  let duration = 0;
  try {
    duration = await input.computeDuration();
    if (!Number.isFinite(duration) || duration <= 0) {
      const videoTrack = await input.getPrimaryVideoTrack();
      duration = videoTrack ? await videoTrack.computeDuration() : 0;
    }
  } catch {
    throw new CompressionUnsupportedError('This browser could not read the length of that video.');
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new CompressionUnsupportedError('This browser could not read that video.');
  }
  aborted(signal);

  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new CompressionUnsupportedError('That file does not contain a video track.');

  let decodable = false;
  try {
    decodable = await track.canDecode();
  } catch {
    decodable = false;
  }
  if (!decodable) {
    throw new CompressionUnsupportedError(
      'This browser cannot decode that video. HEVC footage needs a browser and device with HEVC support, or an H.264 export.',
    );
  }

  const sourceWidth = await track.getDisplayWidth();
  const sourceHeight = await track.getDisplayHeight();
  if (!sourceWidth || !sourceHeight) {
    throw new CompressionUnsupportedError('That video has no readable frame size.');
  }

  const audioTrack = await input.getPrimaryAudioTrack();
  aborted(signal);

  const budget = Math.max(128 * 1024, Math.floor(maxBytes * SIZE_SAFETY));
  const totalBps = (budget * 8) / duration;
  let bitrate = Math.round(
    Math.min(MAX_VIDEO_BPS, Math.max(MIN_VIDEO_BPS, totalBps - (audioTrack ? AUDIO_BUDGET_BPS : 0))),
  );
  const size = frameFor(sourceWidth, sourceHeight, bitrate);

  let frameRate: number | undefined;
  try {
    const metrics = await track.computeFrameRateMetrics({ targetPacketCount: 90 });
    if (metrics.averageFrameRate > 32) frameRate = 30;
  } catch {
    /* keep the source frame rate */
  }

  let encodable = false;
  try {
    encodable = await canEncodeVideo('avc', {
      width: size.width,
      height: size.height,
      quality: new Quality({ bitrate }),
    });
  } catch {
    encodable = false;
  }
  if (!encodable) {
    throw new CompressionUnsupportedError('This browser has no H.264 encoder available.');
  }

  const run = async (targetBitrate: number) => {
    aborted(signal);
    const { conversion, output } = await makeEncoding(
      input,
      size.width,
      size.height,
      targetBitrate,
      frameRate,
      Boolean(audioTrack),
    );

    conversion.onProgress = (progress) => {
      onProgress?.(Math.max(0, Math.min(1, progress)), 'Compressing on this device…');
    };

    // The signal may have fired while Conversion.init was reading headers.
    aborted(signal);
    const cancel = () => {
      void conversion.cancel();
    };
    signal?.addEventListener('abort', cancel, { once: true });

    try {
      await conversion.execute();
    } catch (error) {
      if (signal?.aborted || error instanceof ConversionCanceledError) {
        throw new CompressionCanceledError();
      }
      throw new Error('This browser could not finish that clip. Try a shorter clip or an H.264 export.');
    } finally {
      signal?.removeEventListener('abort', cancel);
    }

    aborted(signal);
    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer || buffer.byteLength === 0) {
      throw new Error('That clip produced an empty file. Try another export.');
    }
    return buffer;
  };

  onProgress?.(0, 'Reading the clip on this device…');
  let buffer = await run(bitrate);

  // Encoders approximate bitrate. If the result still breaks the server limit,
  // make one leaner pass rather than letting the upload fail at the last step.
  if (buffer.byteLength > maxBytes) {
    aborted(signal);
    bitrate = Math.max(MIN_VIDEO_BPS, Math.round(bitrate * 0.62));
    onProgress?.(0, 'Making the file a little smaller…');
    buffer = await run(bitrate);
  }
  if (buffer.byteLength > maxBytes) {
    throw new Error(
      'This clip could not be compressed under the upload limit. Trim it shorter and try again.',
    );
  }

  const outputFile = new File([buffer], file.name.replace(/\.[^.]+$/, '') + '.mp4', {
    type: 'video/mp4',
    lastModified: Date.now(),
  });

  return {
    file: outputFile,
    width: size.width,
    height: size.height,
    duration,
    originalBytes: file.size,
  };
}
