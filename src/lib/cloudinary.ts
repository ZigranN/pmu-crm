import "server-only";
import { v2 as cloudinary } from "cloudinary";
import { getServerAppEnv } from "./env";

const serverEnv = getServerAppEnv();

cloudinary.config({
  cloud_name: serverEnv.CLOUDINARY_CLOUD_NAME,
  api_key: serverEnv.CLOUDINARY_API_KEY,
  api_secret: serverEnv.CLOUDINARY_API_SECRET,
});

export { cloudinary };

export interface UploadOptions {
  folder?: string;
  transformation?: any;
  resource_type?: "image" | "video" | "raw" | "auto";
}

export async function uploadToCloudinary(
  file: File,
  options?: UploadOptions
): Promise<{ url: string; publicId: string }> {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          folder: options?.folder || "crm-pmu",
          resource_type: options?.resource_type || "auto",
          transformation: options?.transformation,
        },
        (error, result) => {
          if (error) reject(error);
          else if (result) {
            resolve({
              url: result.secure_url,
              publicId: result.public_id,
            });
          } else {
            reject(new Error("Upload failed"));
          }
        }
      )
      .end(buffer);
  });
}

export async function deleteFromCloudinary(publicId: string): Promise<void> {
  await cloudinary.uploader.destroy(publicId);
}
