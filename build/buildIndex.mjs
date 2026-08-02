// src/buildIndex.ts
var DEFAULT_SETTINGS = {
  marker: "MOC",
  icons: { note: "\u{1F4C4}", canvas: "\u{1F3A8}", folder: "\u{1F5C2}\uFE0F" },
  descending: false
};
var stripExtension = (path) => path.replace(/\.md$/, "");
var displayName = (name) => name.replace(/\.(md|canvas)$/, "");
var link = (target, label) => `[[${target}|${label}]]`;
function buildIndex(entries, selfPath, settings) {
  const keep = entries.filter((e) => {
    if (e.path === selfPath) return false;
    if (e.isFolder) return true;
    return e.name.endsWith(".md") || e.name.endsWith(".canvas");
  });
  const direction = settings.descending ? -1 : 1;
  keep.sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    return direction * displayName(a.name).localeCompare(displayName(b.name));
  });
  return keep.map((e) => {
    const label = displayName(e.name);
    if (e.isFolder) {
      return e.mocPath ? `${settings.icons.folder} ${link(stripExtension(e.mocPath), label)}` : `${settings.icons.folder} ${label}`;
    }
    const icon = e.name.endsWith(".canvas") ? settings.icons.canvas : settings.icons.note;
    return `${icon} ${link(stripExtension(e.path), label)}`;
  });
}
var escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
var startMarker = (marker) => `%% ${marker}:start %%`;
var endMarker = (marker) => `%% ${marker}:end %%`;
function hasMarker(content, marker) {
  const m = escapeRegExp(marker);
  return new RegExp(`%%\\s*${m}\\s*%%`).test(content) || new RegExp(`%%\\s*${m}:start\\s*%%`).test(content);
}
function applyMocBlock(content, lines, marker) {
  const m = escapeRegExp(marker);
  const block = [startMarker(marker), ...lines, endMarker(marker)].join("\n");
  const expanded = new RegExp(
    `%%\\s*${m}:start\\s*%%[\\s\\S]*?%%\\s*${m}:end\\s*%%`
  );
  if (expanded.test(content)) {
    const updated = content.replace(expanded, block);
    return updated === content ? null : updated;
  }
  const bare = new RegExp(`%%\\s*${m}\\s*%%`);
  if (bare.test(content)) return content.replace(bare, block);
  return null;
}
export {
  DEFAULT_SETTINGS,
  applyMocBlock,
  buildIndex,
  endMarker,
  hasMarker,
  startMarker
};
