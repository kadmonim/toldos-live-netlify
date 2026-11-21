// Nothing is deleted through the site. A picture kept under one fixed name (a profile picture, a family picture:
// "<id>", "orig-<id>", "roots-<id>") would be lost when it is removed or replaced, so its file is first copied
// aside, under "archived/<name>/<time>", where it stays.
export async function keepAside(store, ...keys) {
  const at = new Date().toISOString().replace(/[:.]/g, '-');
  await Promise.all(keys.map(async (key) => {
    const cur = await store.getWithMetadata(key, { type: 'arrayBuffer' });
    if (cur) await store.set(`archived/${key}/${at}`, cur.data, { metadata: { ...(cur.metadata ?? {}), archived: at } });
  }));
}
