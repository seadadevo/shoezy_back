/**
 * transcode-video.ts
 *
 * Converts any uploaded video buffer (MP4 or MOV/QuickTime) into a
 * web-compatible MP4 (H.264 video + AAC audio) using fluent-ffmpeg.
 *
 * Why this is needed:
 *   - `.mov` files use Apple's QuickTime container which is NOT supported
 *     natively by Chrome, Firefox, or Edge on Windows/Android.
 *   - By transcoding to H.264/AAC MP4 on the server, every browser can
 *     play the video without plugins.
 *
 * The binary is resolved from @ffmpeg-installer/ffmpeg so no system-wide
 * ffmpeg installation is required.
 */

import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Point fluent-ffmpeg at the bundled binary
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

export interface TranscodeResult {
  buffer: Buffer;
  mimetype: "video/mp4";
}

/**
 * Transcodes the given video buffer to a web-safe MP4 (H.264 / AAC).
 *
 * @param inputBuffer  Raw bytes of the uploaded video (MP4 or MOV).
 * @param inputMime    MIME type declared by the client ("video/mp4" or "video/quicktime").
 * @returns            A Buffer containing the re-encoded MP4 file.
 */
export async function transcodeToWebMp4(
  inputBuffer: Buffer,
  inputMime: string,
): Promise<TranscodeResult> {
  const tmpDir = os.tmpdir();
  const id = randomUUID();

  // Choose the right extension for the temp input file so ffmpeg can probe correctly
  const inputExt = inputMime.toLowerCase() === "video/quicktime" ? ".mov" : ".mp4";
  const inputPath = path.join(tmpDir, `shoezy_in_${id}${inputExt}`);
  const outputPath = path.join(tmpDir, `shoezy_out_${id}.mp4`);

  // Write the uploaded buffer to a temp file
  await fs.promises.writeFile(inputPath, inputBuffer);

  try {
    await runFfmpeg(inputPath, outputPath);
    const outputBuffer = await fs.promises.readFile(outputPath);
    return { buffer: outputBuffer, mimetype: "video/mp4" };
  } finally {
    // Always clean up temp files regardless of success or failure
    await fs.promises.unlink(inputPath).catch(() => {});
    await fs.promises.unlink(outputPath).catch(() => {});
  }
}

/**
 * Wraps fluent-ffmpeg in a Promise.
 *
 * Output settings chosen for maximum browser compatibility:
 *   -vcodec libx264   → H.264 video (supported by every modern browser)
 *   -acodec aac       → AAC audio (universally supported)
 *   -movflags +faststart → Moves the MP4 index (moov atom) to the start of
 *                          the file so streaming/playback begins immediately
 *                          without downloading the entire file first.
 *   -pix_fmt yuv420p  → Pixel format required for compatibility with older
 *                        Safari, iOS, and Android devices.
 *   -crf 23           → Constant Rate Factor: quality/size balance (18=high quality, 28=smaller file).
 *   -preset fast       → Encoding speed vs. compression efficiency trade-off.
 */
function runFfmpeg(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions([
        "-vcodec libx264",
        "-acodec aac",
        "-movflags +faststart",
        "-pix_fmt yuv420p",
        "-crf 23",
        "-preset fast",
      ])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err: Error) => {
        console.error("[Transcode] ffmpeg error:", err.message);
        reject(new Error(`Video transcoding failed: ${err.message}`));
      })
      .run();
  });
}

/**
 * Returns true if the given MIME type needs transcoding.
 * MOV files always need transcoding. MP4 files are passed through as-is
 * to avoid unnecessary re-encoding when the file is already web-compatible.
 */
export function needsTranscoding(mimetype: string): boolean {
  return mimetype.toLowerCase() === "video/quicktime";
}

