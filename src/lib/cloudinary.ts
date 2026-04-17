import axios from 'axios';

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

export interface CloudinaryResponse {
  secure_url: string;
  public_id: string;
  width: number;
  height: number;
  format: string;
}

/**
 * Uploads a file to Cloudinary using an unsigned upload preset.
 * @param file The file to upload (Blob or File)
 * @returns The Cloudinary response containing the secure URL
 */
export async function uploadImage(file: File | Blob): Promise<string> {
  if (!CLOUD_NAME || !UPLOAD_PRESET) {
    throw new Error('Cloudinary configuration is missing. Please check your environment variables.');
  }

  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`;
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', UPLOAD_PRESET);

  try {
    const response = await axios.post<CloudinaryResponse>(url, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    return response.data.secure_url;
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    if (axios.isAxiosError(error) && error.response) {
      throw new Error(`Upload failed: ${error.response.data?.error?.message || error.message}`);
    }
    throw new Error('Failed to upload image to Cloudinary.');
  }
}
