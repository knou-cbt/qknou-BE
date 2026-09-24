import { Injectable, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import axios from 'axios';

@Injectable()
export class StorageService {
  private readonly s3Client: S3Client;
  private readonly logger = new Logger(StorageService.name);

  private readonly publicDomain = process.env.R2_PUBLIC_DOMAIN;
  private readonly bucketName = process.env.R2_BUCKET_NAME;

  constructor() {
    this.s3Client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
      },
    });
  }

  async processAndUploadImage(
    originalUrl: string,
    identifier: string | number,
  ): Promise<string | null> {
    try {
      const response = await axios.get(originalUrl, {
        responseType: 'arraybuffer',
        timeout: 5000,
      });
      const buffer = Buffer.from(response.data, 'binary');
      const rawContentType = response.headers['content-type'];
      const contentType =
        (typeof rawContentType === 'string'
          ? rawContentType
          : Array.isArray(rawContentType)
            ? rawContentType[0]
            : 'image/jpeg') || 'image/jpeg';

      const extMatch = contentType.match(/\/(.*?)$/);
      const ext = extMatch ? extMatch[1] : 'jpg';

      const fileName = `crawled-images/${identifier}.${ext}`;

      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: fileName,
          Body: buffer,
          ContentType: contentType,
        }),
      );

      return `${this.publicDomain}/${fileName}`;
    } catch (error: any) {
      this.logger.error(`이미지 처리 실패 [URL: ${originalUrl}]`, error.stack);
      return null;
    }
  }

  /**
   * 임의의 파일 버퍼를 R2에 업로드 (시험지 PDF 등).
   * 실패 시 예외를 그대로 던진다 — 업로드 자체가 핵심 동작이라 호출부에서
   * 명시적으로 처리해야 하기 때문 (이미지 크롤링과 달리 조용히 넘어가면 안 됨).
   */
  async uploadBuffer(
    buffer: Buffer,
    key: string,
    contentType: string,
  ): Promise<string> {
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );

    return `${this.publicDomain}/${key}`;
  }
}
