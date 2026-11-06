import { execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Request, Response } from 'express';

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 1024 * 1024 * 16;

let ffmpegChecked = false;
let ffmpegAvailable = false;

export function mediaToolsAvailable(): boolean {
  if (!ffmpegChecked) {
    ffmpegChecked = true;
    try {
      const ffmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
      const ffprobe = spawnSync('ffprobe', ['-version'], { stdio: 'ignore' });
      ffmpegAvailable = ffmpeg.status === 0 && ffprobe.status === 0;
    } catch {
      ffmpegAvailable = false;
    }
  }
  return ffmpegAvailable;
}

export interface ProbeResult {
  duration: number;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  hasAudio: boolean;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
}

export async function probeVideo(filePath: string): Promise<ProbeResult | null> {
  if (!mediaToolsAvailable()) return null;
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { maxBuffer: MAX_BUFFER },
    );
    const parsed = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: FfprobeStream[];
    };
    const video = parsed.streams?.find((s) => s.codec_type === 'video');
    const audio = parsed.streams?.find((s) => s.codec_type === 'audio');
    const duration = Number(parsed.format?.duration ?? 0);
    return {
      duration: Number.isFinite(duration) ? duration : 0,
      width: video?.width ?? null,
      height: video?.height ?? null,
      videoCodec: video?.codec_name ?? null,
      hasAudio: Boolean(audio),
    };
  } catch {
    return null;
  }
}

/**
 * Re-encodes only when needed, strips all metadata (including location tags),
 * and moves the moov atom to the front so playback can start immediately.
 */
export async function prepareVideo(inputPath: string, outputPath: string, probe: ProbeResult | null) {
  if (!mediaToolsAvailable()) {
    throw new Error('ffmpeg is not available on this machine.');
  }
  const canCopy = probe?.videoCodec === 'h264';
  const args = canCopy
    ? ['-y', '-i', inputPath, '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '-1', '-c', 'copy', '-movflags', '+faststart', outputPath]
    : [
        '-y',
        '-i',
        inputPath,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-map_metadata',
        '-1',
        '-vf',
        // Commas inside filter expressions must be escaped for ffmpeg's
        // filtergraph parser; there is no shell here to quote them for us.
        'scale=trunc(min(1280\\,iw)/2)*2:-2',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '24',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        outputPath,
      ];
  await execFileAsync('ffmpeg', args, { maxBuffer: MAX_BUFFER });
  return probeVideo(outputPath);
}

export async function makePoster(videoPath: string, outputPath: string, duration: number) {
  if (!mediaToolsAvailable()) return false;
  const seek = Math.max(0.2, Math.min(duration / 3, 2.5));
  try {
    await execFileAsync(
      'ffmpeg',
      ['-y', '-ss', String(seek), '-i', videoPath, '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '4', outputPath],
      { maxBuffer: MAX_BUFFER },
    );
    return fs.existsSync(outputPath);
  } catch {
    return false;
  }
}

export async function prepareAvatar(inputPath: string, outputPath: string) {
  if (!mediaToolsAvailable()) {
    fs.copyFileSync(inputPath, outputPath);
    return;
  }
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-i',
      inputPath,
      '-vf',
      'scale=256:256:force_original_aspect_ratio=increase,crop=256:256',
      '-q:v',
      '4',
      '-map_metadata',
      '-1',
      outputPath,
    ],
    { maxBuffer: MAX_BUFFER },
  );
}

export function safeJoin(root: string, name: string): string | null {
  const resolved = path.resolve(root, name);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) return null;
  return resolved;
}

export function sendMediaFile(
  req: Request,
  res: Response,
  filePath: string,
  mime: string,
  cacheControl: string,
) {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    res.status(404).json({ error: 'That file is not available.' });
    return;
  }
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const range = req.headers.range;
  if (!range) {
    res.setHeader('Content-Length', stat.size);
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match) {
    res.status(416).setHeader('Content-Range', `bytes */${stat.size}`);
    res.end();
    return;
  }
  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : stat.size - 1;
  if (!match[1] && match[2]) {
    start = Math.max(0, stat.size - Number(match[2]));
    end = stat.size - 1;
  }
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
    res.status(416).setHeader('Content-Range', `bytes */${stat.size}`);
    res.end();
    return;
  }
  end = Math.min(end, stat.size - 1);
  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
  res.setHeader('Content-Length', end - start + 1);
  fs.createReadStream(filePath, { start, end }).pipe(res);
}
