import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../../config/env.js";
import type { StorageProvider } from "./storage.provider.js";

type BodyType = PutObjectCommandInput["Body"];

/**
 * Apakah storage S3 diaktifkan (semua env S3 diisi all-or-none).
 */
function isStorageConfigured(): boolean {
  return Boolean(
    env.S3_ENDPOINT &&
      env.S3_REGION &&
      env.S3_BUCKET &&
      env.S3_ACCESS_KEY_ID &&
      env.S3_SECRET_ACCESS_KEY
  );
}

/**
 * Adapter S3-compatible untuk StorageProvider.
 *
 * Konfigurasi via env (tidak pernah hardcode credential/bucket). Jika config
 * belum lengkap, semua operasi gagal (fail closed) tapi backend tetap nyala
 * untuk endpoint non-evidence.
 */
export class S3StorageProvider implements StorageProvider {
  private client: S3Client | null = null;
  private bucket: string | null = null;

  constructor() {
    if (isStorageConfigured()) {
      this.client = new S3Client({
        endpoint: env.S3_ENDPOINT!,
        region: env.S3_REGION!,
        credentials: {
          accessKeyId: env.S3_ACCESS_KEY_ID!,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
        },
        // Force path style untuk kompatibilitas MinIO dan beberapa S3 gateway.
        forcePathStyle: env.S3_FORCE_PATH_STYLE ?? false,
      });
      this.bucket = env.S3_BUCKET!;
    }
  }

  isAvailable(): boolean {
    return this.client !== null && this.bucket !== null;
  }

  async put(params: {
    key: string;
    body: Buffer | NodeJS.ReadableStream;
    contentType: string;
  }): Promise<{ key: string }> {
    if (!this.client || !this.bucket) {
      throw new Error("Storage provider tidak dikonfigurasi");
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: params.key,
        Body: params.body as unknown as BodyType,
        ContentType: params.contentType,
        // Object tetap private (bukan public-read). Akses hanya via signed URL.
      })
    );

    return { key: params.key };
  }

  async delete(params: { key: string }): Promise<void> {
    if (!this.client || !this.bucket) {
      throw new Error("Storage provider tidak dikonfigurasi");
    }

    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: params.key,
      })
    );
  }

  async signedGetUrl(params: {
    key: string;
    ttlSeconds?: number;
  }): Promise<{ url: string; expiresAt: Date }> {
    if (!this.client || !this.bucket) {
      throw new Error("Storage provider tidak dikonfigurasi");
    }

    const ttl = params.ttlSeconds ?? 600; // default 10 menit (OD-7/PROJECT: 5-15 menit)
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: params.key,
      ResponseContentDisposition: 'attachment', // unduh, jangan preview inline
    });

    const url = await getSignedUrl(this.client, command, { expiresIn: ttl });
    const expiresAt = new Date(Date.now() + ttl * 1000);

    return { url, expiresAt };
  }
}

/**
 * Aktif provider yang digunakan oleh layanan evidence.
 * Default: S3StorageProvider (fail-closed bila belum dikonfigurasi).
 * Untuk test: gunakan setStorageProviderForTest() untuk mengganti dengan
 * fake in-memory tanpa menyentuh S3/MinIO live.
 *
 * Diexport sebagai `let` agar importer (evidence.service.ts) mendapatkan
 * live binding — reassignment via setStorageProviderForTest() terlihat di
 * importer tanpa perlu mengubah import.
 */
export let storageProvider: StorageProvider = new S3StorageProvider();

/**
 * TEST-ONLY: ganti storage provider dengan implementasi palsu (in-memory).
 * Hanya dipakai di berkas test; tidak mengubah perilaku production.
 */
export function setStorageProviderForTest(provider: StorageProvider): void {
  storageProvider = provider;
}

/**
 * TEST-ONLY: kembalikan provider ke S3StorageProvider default.
 */
export function resetStorageProviderForTest(): void {
  storageProvider = new S3StorageProvider();
}
