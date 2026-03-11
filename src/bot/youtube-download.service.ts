import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type YoutubeDownloadErrorCode =
  | 'invalid_link'
  | 'unsupported_content'
  | 'download_failed'
  | 'file_too_large'
  | 'tool_not_installed'
  | 'authentication_required';

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

interface YoutubeMetadata {
  title?: string;
}

@Injectable()
export class YoutubeDownloadService {
  private static readonly MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
  private static readonly YT_DLP_BINARY = 'yt-dlp';
  private readonly cookiesFile: string;
  private readonly cookiesFromBrowser: string;
  private readonly extractorClients: string;

  constructor(private readonly configService: ConfigService) {
    this.cookiesFile =
      this.configService.get<string>('youtube.cookiesFile')?.trim() ?? '';
    this.cookiesFromBrowser =
      this.configService.get<string>('youtube.cookiesFromBrowser')?.trim() ??
      '';
    this.extractorClients =
      this.configService.get<string>('youtube.extractorClients')?.trim() ||
      'android,ios,web';
  }

  async downloadFromInput(input: string): Promise<YoutubeDownloadResult> {
    const normalizedInput = this.normalizeYoutubeInput(input);
    if (!normalizedInput) {
      throw new YoutubeDownloadException(
        'invalid_link',
        'Invalid YouTube link.',
      );
    }

    const tempDirectory = await fs.mkdtemp(join(tmpdir(), 'yt-download-'));

    try {
      const metadata = await this.fetchMetadata(normalizedInput);
      const downloadedFilePath = await this.downloadFile(
        normalizedInput,
        tempDirectory,
      );
      const buffer = await fs.readFile(downloadedFilePath);

      if (buffer.length > YoutubeDownloadService.MAX_FILE_SIZE_BYTES) {
        throw new YoutubeDownloadException(
          'file_too_large',
          'Media is too large.',
        );
      }

      const safeTitle = this.buildSafeFilename(metadata.title);
      return {
        title: metadata.title?.trim() || 'YouTube video',
        buffer,
        mimeType: 'video/mp4',
        filename: `${safeTitle}.mp4`,
      };
    } finally {
      await fs.rm(tempDirectory, { recursive: true, force: true });
    }
  }

  private normalizeYoutubeInput(input: string): string | null {
    const trimmedInput = input.trim();
    const withProtocol = /^(https?:\/\/)/i.test(trimmedInput)
      ? trimmedInput
      : `https://${trimmedInput}`;

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(withProtocol);
    } catch {
      return null;
    }

    const hostname = parsedUrl.hostname.toLowerCase().replace(/^www\./, '');

    if (hostname === 'youtu.be') {
      const shortId = parsedUrl.pathname.replace(/^\//, '').split('/')[0];
      return this.isValidVideoId(shortId) ? parsedUrl.toString() : null;
    }

    if (hostname !== 'youtube.com' && hostname !== 'm.youtube.com') {
      return null;
    }

    if (parsedUrl.pathname === '/watch') {
      const watchId = parsedUrl.searchParams.get('v') ?? '';
      return this.isValidVideoId(watchId) ? parsedUrl.toString() : null;
    }

    if (parsedUrl.pathname.startsWith('/shorts/')) {
      const shortsId = parsedUrl.pathname.split('/')[2] ?? '';
      return this.isValidVideoId(shortsId) ? parsedUrl.toString() : null;
    }

    return null;
  }

  private isValidVideoId(value: string): boolean {
    return /^[a-zA-Z0-9_-]{6,20}$/.test(value);
  }

  private async fetchMetadata(url: string): Promise<YoutubeMetadata> {
    try {
      const { stdout } = await execFileAsync(
        YoutubeDownloadService.YT_DLP_BINARY,
        [
          '--dump-single-json',
          '--no-playlist',
          '--no-warnings',
          ...this.buildAuthArgs(),
          ...this.buildYoutubeExtractorArgs(),
          url,
        ],
        {
          maxBuffer: 10 * 1024 * 1024,
        },
      );

      return JSON.parse(stdout.trim()) as YoutubeMetadata;
    } catch (error) {
      throw this.mapYtDlpError(error);
    }
  }

  private async downloadFile(
    url: string,
    directoryPath: string,
  ): Promise<string> {
    const outputTemplate = join(directoryPath, 'video.%(ext)s');

    try {
      await execFileAsync(
        YoutubeDownloadService.YT_DLP_BINARY,
        [
          '--no-playlist',
          '--no-progress',
          '--newline',
          '--no-warnings',
          '--max-filesize',
          '49M',
          '--merge-output-format',
          'mp4',
          ...this.buildAuthArgs(),
          ...this.buildYoutubeExtractorArgs(),
          '-f',
          'b[ext=mp4]/b',
          '-o',
          outputTemplate,
          url,
        ],
        { maxBuffer: 10 * 1024 * 1024 },
      );
    } catch (error) {
      throw this.mapYtDlpError(error);
    }

    const files = await fs.readdir(directoryPath);
    const outputFilename = files.find((filename) =>
      filename.startsWith('video.'),
    );
    if (!outputFilename) {
      throw new YoutubeDownloadException(
        'download_failed',
        'Could not find downloaded media file.',
      );
    }

    return join(directoryPath, outputFilename);
  }

  private buildSafeFilename(title?: string): string {
    const normalizedTitle = (title?.trim() || 'youtube-video')
      .replace(/[^a-zA-Z0-9-_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80);

    return normalizedTitle || 'youtube-video';
  }

  private buildAuthArgs(): string[] {
    if (this.cookiesFile) {
      return ['--cookies', this.cookiesFile];
    }

    if (this.cookiesFromBrowser) {
      return ['--cookies-from-browser', this.cookiesFromBrowser];
    }

    return [];
  }

  private buildYoutubeExtractorArgs(): string[] {
    if (!this.extractorClients) {
      return [];
    }

    return [
      '--extractor-args',
      `youtube:player_client=${this.extractorClients}`,
    ];
  }

  private mapYtDlpError(error: unknown): YoutubeDownloadException {
    const message = this.extractErrorMessage(error).toLowerCase();

    if (
      message.includes('enoent') ||
      message.includes('ffmpeg is not installed') ||
      message.includes('ffprobe and ffmpeg not found')
    ) {
      return new YoutubeDownloadException(
        'tool_not_installed',
        'yt-dlp or ffmpeg binary is not installed.',
      );
    }

    if (message.includes('file is larger than max-filesize')) {
      return new YoutubeDownloadException(
        'file_too_large',
        'Media is too large.',
      );
    }

    if (
      message.includes('unsupported url') ||
      message.includes('unable to extract') ||
      message.includes('is not a valid url')
    ) {
      return new YoutubeDownloadException(
        'invalid_link',
        'Invalid YouTube link.',
      );
    }

    if (message.includes('requested format is not available')) {
      return new YoutubeDownloadException(
        'unsupported_content',
        'Unsupported YouTube content.',
      );
    }

    if (
      message.includes('sign in to confirm you’re not a bot') ||
      message.includes("sign in to confirm you're not a bot") ||
      message.includes('use --cookies-from-browser') ||
      message.includes('use --cookies for the authentication')
    ) {
      return new YoutubeDownloadException(
        'authentication_required',
        'YouTube requires authentication cookies for this media.',
      );
    }

    return new YoutubeDownloadException(
      'download_failed',
      this.extractErrorMessage(error),
    );
  }

  private extractErrorMessage(error: unknown): string {
    if (error instanceof Error && 'stderr' in error) {
      const stderr = (error as { stderr?: string }).stderr;
      if (typeof stderr === 'string' && stderr.trim()) {
        return stderr;
      }
    }

    if (error instanceof Error) {
      return error.message;
    }

    return 'Unknown YouTube download error.';
  }
}
