import { getSupabaseClient } from "./supabaseClient";

const photoBucket = (import.meta.env.VITE_SUPABASE_PHOTO_BUCKET as string | undefined) || "org-photos";

const sanitizeFileName = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

export const uploadEmployeePhoto = async (file: File, employeeId?: string): Promise<string> => {
  const supabase = getSupabaseClient();
  const safeId = sanitizeFileName(employeeId || "employee");
  const safeName = sanitizeFileName(file.name || "photo.webp");
  const ext = (safeName.split(".").pop() || "webp").replace(/[^a-z0-9]/g, "") || "webp";
  const filePath = `profiles/${safeId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;

  const { error: uploadError } = await supabase.storage.from(photoBucket).upload(filePath, file, {
    upsert: false,
    cacheControl: "31536000",
    contentType: file.type || "image/webp"
  });

  if (uploadError) {
    throw new Error(uploadError.message || "Photo upload failed.");
  }

  const { data } = supabase.storage.from(photoBucket).getPublicUrl(filePath);
  if (!data?.publicUrl) {
    throw new Error("Unable to resolve uploaded photo URL.");
  }
  return data.publicUrl;
};
