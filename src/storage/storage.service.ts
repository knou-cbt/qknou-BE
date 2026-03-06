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

    async processAndUploadImage(originalUrl: string, identifier: string | number): Promise<string | null> {
        try {
            const response = await axios.get(originalUrl, {
                responseType: 'arraybuffer',
                timeout: 5000
            });
            const buffer = Buffer.from(response.data, 'binary');
            const contentType = response.headers['content-type'] || 'image/jpeg';

            const extMatch = contentType.match(/\/(.*?)$/);
            const ext = extMatch ? extMatch[1] : 'jpg';

            const fileName = `crawled-images/${identifier}.${ext}`;

            await this.s3Client.send(
                new PutObjectCommand({
                    Bucket: this.bucketName,
                    Key: fileName,
                    Body: buffer,
                    ContentType: contentType,
                })
            );

            return `${this.publicDomain}/${fileName}`;
        } catch (error: any) {
            this.logger.error(`이미지 처리 실패 [URL: ${originalUrl}]`, error.stack);
            return null;
        }
    }
}
