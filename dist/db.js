// db.js
// ------------------------------------------------------------------
// Thin wrapper around the Supabase client for journal entries.
// In mock mode (no backend) it returns canned data so the UI is
// demoable end-to-end without a Supabase project.
//
// All public methods are async and return `{ data, error }` shaped
// results so the views can render either branch the same way.
// ------------------------------------------------------------------

import { isMockMode } from "./config.js";
import { getSupabaseClient } from "./supabase-client.js";

async function getSupabase() {
  return getSupabaseClient();
}

// ------------------------------------------------------------------
// Mock data store (in-memory, scoped to the tab)
// ------------------------------------------------------------------
const today = new Date();
function isoDate(daysAgo) {
  const d = new Date(today);
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}
function isoNow() {
  return new Date().toISOString();
}

const mockUserId = "00000000-0000-0000-0000-000000000001";
let mockEntries = [
  {
    id: "e-1",
    user_id: mockUserId,
    title: "First day with the new app",
    body:
      "Finally got around to setting up a journal. The plan is to write a few lines every evening before bed — nothing fancy, just capture the day. If I can stick to this for a month I'll be delighted.",
    mood: 4,
    entry_date: isoDate(0),
    created_at: isoNow(),
    updated_at: isoNow(),
  },
  {
    id: "e-2",
    user_id: mockUserId,
    title: "Coffee with Mara",
    body:
      "Caught up with Mara at the corner cafe. She's thinking about going back to school for her MLIS. We talked about libraries, neighbourhood changes, and the strange joy of a quiet afternoon.",
    mood: 5,
    entry_date: isoDate(0),
    created_at: isoNow(),
    updated_at: isoNow(),
  },
  {
    id: "e-3",
    user_id: mockUserId,
    title: null,
    body:
      "Rainy day. Stayed in and read for hours. Made soup from whatever was in the fridge. The dog was unimpressed with the soup but very impressed with the rain.",
    mood: 3,
    entry_date: isoDate(1),
    created_at: isoNow(),
    updated_at: isoNow(),
  },
  {
    id: "e-4",
    user_id: mockUserId,
    title: "Long walk along the river",
    body:
      "Six kilometres, no headphones. Noticed how much the light has shifted — it's definitely autumn now. The chestnut trees are turning. I should look up when the market is on Saturdays.",
    mood: 4,
    entry_date: isoDate(2),
    created_at: isoNow(),
    updated_at: isoNow(),
  },
  {
    id: "e-5",
    user_id: mockUserId,
    title: "Tough meeting",
    body:
      "Project review went long and the room was tense. I think we landed in an okay place but I'm tired. Reminder: prep notes earlier in the day, not ten minutes before.",
    mood: 2,
    entry_date: isoDate(4),
    created_at: isoNow(),
    updated_at: isoNow(),
  },
  {
    id: "e-6",
    user_id: mockUserId,
    title: "Trip recap",
    body:
      "Back from the long weekend. Highlights: the trail at sunrise, the bakery in the next town over, falling asleep to actual silence. Lowlights: forgot the sunscreen, very much regretted by hour two.",
    mood: 4,
    entry_date: isoDate(8),
    created_at: isoNow(),
    updated_at: isoNow(),
  },
];

function nextId() {
  return "e-" + Math.random().toString(36).slice(2, 10);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ------------------------------------------------------------------
// Public API
// ------------------------------------------------------------------
export const db = {
  isMock: isMockMode,

  // ---- Entries ----
  async listEntries() {
    if (isMockMode) {
      await sleep(80);
      // newest entry_date first, tiebreak by created_at desc
      const data = [...mockEntries].sort((a, b) => {
        if (a.entry_date !== b.entry_date) {
          return a.entry_date < b.entry_date ? 1 : -1;
        }
        return a.created_at < b.created_at ? 1 : -1;
      });
      return { data, error: null };
    }
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from("entries")
      .select("*")
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false });
    return { data: data || [], error };
  },

  async getEntry(id) {
    if (isMockMode) {
      await sleep(40);
      const data = mockEntries.find((e) => e.id === id) || null;
      return { data, error: data ? null : { message: "Not found" } };
    }
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from("entries")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    return { data, error };
  },

  async createEntry({ user_id, title, body, mood, entry_date, image_paths }) {
    const trimmedTitle = (title || "").trim();
    if (isMockMode) {
      // Mock: build a complete record with a fake id, since the in-memory
      // store needs to address rows by id.
      const record = {
        id: nextId(),
        user_id,
        title: trimmedTitle.length ? trimmedTitle : null,
        body: body || "",
        mood: Number.isFinite(mood) ? mood : null,
        entry_date: entry_date || new Date().toISOString().slice(0, 10),
        image_paths: Array.isArray(image_paths) ? image_paths : [],
        created_at: isoNow(),
        updated_at: isoNow(),
      };
      await sleep(80);
      mockEntries.push(record);
      return { data: record, error: null };
    }
    // Live: do NOT send `id` (DB generates via DEFAULT gen_random_uuid()).
    // Do NOT send `created_at` / `updated_at` (DB defaults to now()).
    // Sending our own would either be ignored (if same default) or rejected
    // (if a custom string is sent and the column is uuid).
    const record = {
      user_id,
      title: trimmedTitle.length ? trimmedTitle : null,
      body: body || "",
      mood: Number.isFinite(mood) ? mood : null,
      entry_date: entry_date || new Date().toISOString().slice(0, 10),
      image_paths: Array.isArray(image_paths) ? image_paths : [],
    };
    const supabase = await getSupabase();
    const { data, error } = await supabase
      .from("entries")
      .insert(record)
      .select()
      .single();
    return { data, error };
  },

  async updateEntry(id, patch) {
    if (isMockMode) {
      await sleep(80);
      const idx = mockEntries.findIndex((e) => e.id === id);
      if (idx === -1) return { data: null, error: { message: "Not found" } };
      const next = {
        ...mockEntries[idx],
        ...patch,
        title:
          patch.title !== undefined
            ? (patch.title || "").trim() || null
            : mockEntries[idx].title,
        updated_at: isoNow(),
      };
      mockEntries[idx] = next;
      return { data: next, error: null };
    }
    const supabase = await getSupabase();
    const sanitized = { ...patch, updated_at: new Date().toISOString() };
    if (sanitized.title !== undefined) {
      const t = (sanitized.title || "").trim();
      sanitized.title = t.length ? t : null;
    }
    if (sanitized.image_paths !== undefined && !Array.isArray(sanitized.image_paths)) {
      sanitized.image_paths = [];
    }
    const { data, error } = await supabase
      .from("entries")
      .update(sanitized)
      .eq("id", id)
      .select()
      .single();
    return { data, error };
  },

  async deleteEntry(id) {
    if (isMockMode) {
      await sleep(60);
      const before = mockEntries.length;
      mockEntries = mockEntries.filter((e) => e.id !== id);
      return { data: { ok: before !== mockEntries.length }, error: null };
    }
    const supabase = await getSupabase();
    const { error } = await supabase.from("entries").delete().eq("id", id);
    return { data: { ok: !error }, error };
  },
};
