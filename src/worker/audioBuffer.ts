import { ProgressiveEncoder } from "../hls/encode";
import {
  appendPlaylistEnd,
  appendPlaylistSegment,
  removeSessionDir,
  writeInit,
  writePlaylistHeader,
  writeSegment,
} from "../storage/hlsWrite";

// Push buffer: PCM in, HLS files (init.mp4 / seg-N.m4s / playlist.m3u8) written
// straight to OPFS for one session via ProgressiveEncoder.
export class AudioBuffer {
  private readonly encoder: ProgressiveEncoder;
  // Serialise the (sync) encoder callbacks' async OPFS writes in emission order.
  private writes: Promise<void> = Promise.resolve();
  private playlistPos = 0;
  private segments = 0;
  private audioSecTotal = 0;

  constructor(
    private readonly sessionId: string,
    sampleRate: number,
    private readonly onSegment?: (count: number) => void,
  ) {
    this.encoder = new ProgressiveEncoder(
      sampleRate,
      (bytes) => this.enqueue(() => writeInit(this.sessionId, bytes)),
      (index, bytes, durationSec) =>
        this.enqueue(async () => {
          await writeSegment(this.sessionId, index, bytes);
          this.playlistPos = await appendPlaylistSegment(
            this.sessionId,
            index,
            durationSec,
            this.playlistPos,
          );
          this.segments += 1;
          this.audioSecTotal += durationSec;
          this.onSegment?.(this.segments);
        }),
    );
  }

  async start(): Promise<void> {
    this.playlistPos = await writePlaylistHeader(this.sessionId);
    await this.encoder.start();
  }

  async push(pcm: Float32Array): Promise<void> {
    await this.encoder.pushChunk(pcm);
  }

  async finish(): Promise<void> {
    await this.encoder.finish();
    await this.writes;
    await appendPlaylistEnd(this.sessionId, this.playlistPos);
  }

  /** Releases the encoder and deletes everything written for this session. */
  async abort(): Promise<void> {
    await this.encoder.cancel();
    await this.writes.catch(() => {});
    await removeSessionDir(this.sessionId);
  }

  segmentCount(): number {
    return this.segments;
  }

  audioSec(): number {
    return this.audioSecTotal;
  }

  private enqueue(task: () => Promise<void>): void {
    this.writes = this.writes.then(task);
  }
}
