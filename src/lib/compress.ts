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
import { ENCODE_SHORT_EDGE } from './videoTarget.ts';

const AUDIO_BUDGET_BPS = 160_000;
/**
 * Ceiling for the video track. At 720p this is a clear picture for handheld
 * footage, and it keeps a one-minute clip near 12 MB — the free storage
 * allowance, not the network, is what limits how many clips fit.
 */
const PREFERRED_VIDEO_BPS = 1_600_000;
/** Below this, 720p looks no better than 540p at the same number of bytes. */
const MIN_720_BPS = 900_000;
const FALLBACK_SHORT_EDGE = 540;
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
 * Size the frame from the short edge, so portrait clips (the common case here)
 * keep their full 720×1280 shape instead of being squashed to a 720-tall box.
 * Long clips step down to 540 only when the byte budget cannot pay for 720p.
 */
function frameFor(width: number, height: number, bitrate: number) {
  const shortEdge = bitrate >= MIN_720_BPS ? ENCODE_SHORT_EDGE : FALLBACK_SHORT_EDGE;
  const scale = Math.min(1, shortEdge / Math.min(width, height));
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
 * Re-encode a local file to H.264 MP4 at up to 720p, sized to fit maxBytes.
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
  const audioBps = audioTrack ? AUDIO_BUDGET_BPS : 0;
  const affordable = (budget * 8) / duration - audioBps;
  // A source that is already leaner than the 720p ceiling is matched rather
  // than beaten, so re-encoding can only ever shrink the upload.
  const sourceRate = (file.size * 8) / duration - audioBps;
  // Short clips stop at the 720p ceiling rather than spending bytes nobody
  // can see; long clips are pushed by the size budget instead.
  const bitrate = Math.round(
    Math.max(MIN_VIDEO_BPS, Math.min(PREFERRED_VIDEO_BPS, affordable, sourceRate)),
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
    const leaner = Math.max(MIN_VIDEO_BPS, Math.round(bitrate * 0.62));
    onProgress?.(0, 'Making the file a little smaller…');
    buffer = await run(leaner);
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
