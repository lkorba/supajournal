// prompts-state.js
// ------------------------------------------------------------------
// Prompt of the day. Picks a deterministic prompt from the list for
// today's date so the same user sees the same prompt across reloads
// (and the entire user base sees the same prompt in their time
// zone on the same day).
// ------------------------------------------------------------------

function hashStringToInt(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function todayKey() {
  // YYYY-MM-DD in local time
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function pickPromptOfTheDay(prompts) {
  if (!Array.isArray(prompts) || prompts.length === 0) return null;
  const idx = hashStringToInt(todayKey()) % prompts.length;
  return prompts[idx];
}
