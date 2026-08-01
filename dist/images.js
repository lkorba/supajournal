// images.js
// ------------------------------------------------------------------
// Storage helpers for the journal-images bucket.
//
// Layout:  <user_id>/<uuid>.<ext>
//
// Security:
//   - The bucket is PRIVATE. Direct file URLs do not work.
//   - We always go through signed URLs (default 1h expiry) to render
//     images, so the signed URL is the only thing that needs to be
//     exposed in the DOM.
//   - RLS on storage.objects locks all CRUD to auth.uid()'s own folder.
// ------------------------------------------------------------------

import { getSupabaseClient } from "./supabase-client.js";

const BUCKET = "journal-images";
// How long signed download URLs stay valid. 1h is fine for a journal:
// the user typically renders their own entries during a session, and
// re-renders regenerate the URL on demand.
const SIGNED_TTL_SECONDS = 3600;

function extForFile(file) {
  const name = (file && file.name) || "";
  const m = /\.([a-zA-Z0-9]{2,5})$/.exec(name);
  if (m) return m[1].toLowerCase();
  if (file && file.type) {
    if (file.type === "image/jpeg") return "jpg";
    if (file.type === "image/png") return "png";
    if (file.type === "image/gif") return "gif";
    if (file.type === "image/webp") return "webp";
  }
  return "bin";
}

function uuid() {
  // crypto.randomUUID is widely available in modern browsers; fall back
  // to a Math.random-based one for the rare older environment.
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Upload a single file to the user's folder in the journal-images bucket.
 * Returns the storage path on success: `${userId}/${uuid}.${ext}`.
 */
export async function uploadImage({ userId, file }) {
  if (!userId) throw new Error("uploadImage: userId is required");
  if (!file) throw new Error("uploadImage: file is required");
  if (!/^image\//.test(file.type || "")) {
    throw new Error("Only image files are supported.");
  }
  const supabase = await getSupabaseClient();
  const ext = extForFile(file);
  const path = `${userId}/${uuid()}.${ext}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      contentType: file.type,
      cacheControl: "3600",
      upsert: false,
    });
  if (error) throw error;
  return path;
}

/**
 * Resolve storage paths to signed URLs.
 * @param {string[]} paths  storage paths like ["<uid>/<uuid>.png"]
 * @returns {Promise<{path: string, url: string}[]>}
 */
export async function signImagePaths(paths) {
  if (!paths || paths.length === 0) return [];
  const supabase = await getSupabaseClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(paths, SIGNED_TTL_SECONDS);
  if (error) throw error;
  // `data` is an array of { path, signedUrl, error }. Keep only successes,
  // and normalize to { path, url }.
  return (data || [])
    .filter((r) => !r.error && r.signedUrl)
    .map((r) => ({ path: r.path, url: r.signedUrl }));
}

/**
 * Remove a single image by its storage path. Silently succeeds if the
 * path no longer exists (Storage 404 is treated as "already gone").
 */
export async function deleteImage(path) {
  if (!path) return;
  const supabase = await getSupabaseClient();
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error && !/not found/i.test(error.message || "")) throw error;
}

export const IMAGES_BUCKET = BUCKET;
