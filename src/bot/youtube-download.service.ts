import { Injectable } from '@nestjs/common';

export type YoutubeDownloadErrorCode =
  | 'invalid_link'
  | 'unsupported_content'
  | 'download_failed'
  | 'file_too_large';

export class YoutubeDownloadException extends Error {
  constructor(
    public readonly code: YoutubeDownloadErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface YoutubeDownloadResult {
  title: string;
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

interface PipedStreamsResponse {
  title?: string;
  videoStreams?: Array<{
    url: string;
    format?: string;
    mimeType?: string;
    quality?: string;
    bitrate?: number;
    contentLength?: number;
  }>;
}

type PipedVideoStream = NonNullable<
  PipedStreamsResponse['videoStreams']
>[number];

@Injectable()
export class YoutubeDownloadService {
  private static readonly MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

  async downloadFromInput(input: string): Promise<YoutubeDownloadResult> {
    const videoId = this.extractVideoId(input);
    if (!videoId) {
      throw new YoutubeDownloadException(
        'invalid_link',
        'Invalid YouTube link.',
      );
    }

    const metadata = await this.fetchStreams(videoId);
    const selectedStream = this.selectStream(metadata.videoStreams ?? []);

    if (!selectedStream) {
      throw new YoutubeDownloadException(
        'unsupported_content',
        'Unsupported YouTube content.',
      );
    }

    const buffer = await this.fetchBuffer(selectedStream.url);

    if (buffer.length > YoutubeDownloadService.MAX_FILE_SIZE_BYTES) {
      throw new YoutubeDownloadException(
        'file_too_large',
        'Media is too large.',
      );
    }

    const title = metadata.title?.trim() || 'youtube-video';
    const safeTitle = title.replace(/[^a-zA-Z0-9-_]+/g, '_').slice(0, 80);

    return {
      title,
      buffer,
      mimeType: selectedStream.mimeType ?? 'video/mp4',
      filename: `${safeTitle || 'youtube-video'}.mp4`,
    };
  }

  private extractVideoId(input: string): string | null {
    const trimmed = input.trim();
    const withProtocol = /^(https?:\/\/)/i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(withProtocol);
    } catch {
      return null;
    }

    const hostname = parsedUrl.hostname.toLowerCase().replace(/^www\./, '');

    if (hostname === 'youtu.be') {
      const shortId = parsedUrl.pathname.replace(/^\//, '').split('/')[0];
      return this.isValidVideoId(shortId) ? shortId : null;
    }

    if (hostname !== 'youtube.com' && hostname !== 'm.youtube.com') {
      return null;
    }

    if (parsedUrl.pathname === '/watch') {
      const watchId = parsedUrl.searchParams.get('v') ?? '';
      return this.isValidVideoId(watchId) ? watchId : null;
    }

    if (parsedUrl.pathname.startsWith('/shorts/')) {
      const shortsId = parsedUrl.pathname.split('/')[2] ?? '';
      return this.isValidVideoId(shortsId) ? shortsId : null;
    }

    return null;
  }

  private isValidVideoId(value: string): boolean {
    return /^[a-zA-Z0-9_-]{6,20}$/.test(value);
  }

  private async fetchStreams(videoId: string): Promise<PipedStreamsResponse> {
    const response = await fetch(
      `https://piped.video/api/v1/streams/${videoId}`,
    );

    if (!response.ok) {
      throw new YoutubeDownloadException(
        'download_failed',
        `Could not load YouTube stream metadata: ${response.status}`,
      );
    }

    return (await response.json()) as PipedStreamsResponse;
  }

  private selectStream(
    streams: PipedStreamsResponse['videoStreams'],
  ): PipedVideoStream | null {
    const compatibleStreams = (streams ?? [])
      .filter((stream) => {
        const mimeType = stream.mimeType?.toLowerCase() ?? '';
        const format = stream.format?.toLowerCase() ?? '';
        const size = stream.contentLength ?? 0;

        return (
          (mimeType.includes('video/mp4') || format.includes('mp4')) &&
          (size === 0 || size <= YoutubeDownloadService.MAX_FILE_SIZE_BYTES)
        );
      })
      .sort((first, second) => (first.bitrate ?? 0) - (second.bitrate ?? 0));

    return compatibleStreams[0] ?? null;
  }

  private async fetchBuffer(url: string): Promise<Buffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new YoutubeDownloadException(
        'download_failed',
        `Could not download YouTube media: ${response.status}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
