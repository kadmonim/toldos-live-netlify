// Mirrors one blob store into another, a little at a time (see functions/photo-backup.mjs):
// - new or changed blobs are copied (by etag); a blob replaced on the site keeps its previous copy
//   under "prev/<key>" (one version back);
// - a blob deleted on the site keeps its copy for GRACE_DAYS, then the copy goes too;
// - each run stops after `budgetMs`, so a big batch spreads over several runs.
// State (etags copied, when deletions were first seen) is kept in the mirror as "state.json".
export const GRACE_DAYS = 90;

export async function mirror(src, dst, { budgetMs = 20000, now = Date.now() } = {}) {
  const start = Date.now();
  const state = (await dst.get('state.json', { type: 'json' })) ?? { etags: {}, deleted: {} };
  const { blobs } = await src.list();
  const live = new Set(blobs.map((b) => b.key));
  let copied = 0, kept = 0, removed = 0, done = true;
  for (const b of blobs) {
    if (state.etags[b.key] === b.etag) continue;
    if (Date.now() - start > budgetMs) { done = false; break; }
    const cur = await src.getWithMetadata(b.key, { type: 'arrayBuffer' });
    if (!cur) continue;
    if (state.etags[b.key]) {   // replaced on the site: keep the copy we had as the previous version
      const old = await dst.getWithMetadata(b.key, { type: 'arrayBuffer' });
      if (old) { await dst.set(`prev/${b.key}`, old.data, { metadata: old.metadata }); kept++; }
    }
    await dst.set(b.key, cur.data, { metadata: cur.metadata ?? {} });
    state.etags[b.key] = b.etag;
    delete state.deleted[b.key];
    copied++;
  }
  // Deleted on the site: note when, and drop the copy (and its previous version) after the grace period.
  for (const key of Object.keys(state.etags)) {
    if (live.has(key)) continue;
    state.deleted[key] ??= now;
    if (now - state.deleted[key] > GRACE_DAYS * 864e5) {
      await dst.delete(key); await dst.delete(`prev/${key}`);
      delete state.etags[key]; delete state.deleted[key]; removed++;
    }
  }
  state.lastRun = new Date(now).toISOString();
  state.complete = done;
  await dst.setJSON('state.json', state);
  return { copied, kept, removed, complete: done, mirrored: Object.keys(state.etags).length, pendingDeletion: Object.keys(state.deleted).length };
}
