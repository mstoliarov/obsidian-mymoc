# MyMOC

An Obsidian plugin that keeps folder tables of contents up to date.

**It never creates files on its own.** It updates notes you have marked yourself, and
creates index notes only when you explicitly ask with the recursive marker. What gets
processed is defined by markers you place, not by folder lists you maintain.

## How it works

Create a note with **any name** in the folder you want indexed and type:

```
%% MOC %%
```

The marker expands into a block as you type:

```
%% MOC:start %%
🗂️ docs
📄 [[01_PROJECTS/VPS/mymoc/README.sync-conflict-20260802-135235-Q7SYFUK|README.sync-conflict-20260802-135235-Q7SYFUK]]
%% MOC:end %%
```

From then on the list updates itself whenever files and folders are added, removed or
renamed next to it. Anything you write **above or below** the block stays untouched —
put your headings, notes and manual links there.

### Indexing a whole tree at once

Type `%% MOC+ %%` instead, and the plugin walks every subfolder below the note, creating
an index note in each one. The file is named after its folder with a configurable prefix,
`-Archive.md` by default.

The marker then collapses into an ordinary block, so the pass happens **once**. Nothing
is generated in the background afterwards — the created notes simply keep themselves up
to date like any other index.

Folders are skipped when they already contain an index, when a file of that name exists,
or when they hold nothing but attachments. Existing files are never overwritten.

> **Try it on a small folder first.** Placed high in a vault, `%% MOC+ %%` can create
> dozens of notes across unrelated projects in one go, and the only way back is deleting
> them by hand. Run it on a throwaway folder with two or three subfolders, see the shape
> it produces, then use it where you meant to.

### Writing *about* the marker

Wrap it in backticks — `` `%% MOC:start %%
🗂️ docs
📄 [[01_PROJECTS/VPS/mymoc/README.sync-conflict-20260802-135235-Q7SYFUK|README.sync-conflict-20260802-135235-Q7SYFUK]]
%% MOC:end %%` `` — and the plugin ignores it. The same goes for
fenced code blocks. Without this, any note documenting the plugin would turn itself into
an index mid-sentence.

To stop indexing a folder, delete the block **including both delimiters**. Removing only
`%% MOC:end %%` leaves the plugin unable to recognise the block, and it will quietly
leave it alone.

## How it differs from similar plugins

|  | MyMOC | Zoottelkeeper | Waypoint |
|---|---|---|---|
| Creates index files unprompted | no | yes, in every folder | no |
| Can create a whole tree on request | yes, `%% MOC+ %%` | — | no |
| Index file name | any | folder name + prefix | must equal folder name |
| Which folders are processed | those you mark | include/exclude lists | those you mark |

The practical consequence: with MyMOC a vault cannot be flooded with generated files,
because generating files is not something the plugin does. And an index can be called
`Overview`, `Start here` or `Карта` — whatever fits your vault.

## What goes into the list

- Contents of **one** folder, the one holding the note. It does not recurse
- Notes (`.md`) and canvases (`.canvas`). Images, PDFs and other attachments are skipped
- Folders first, then files; alphabetical within each group, using locale-aware
  comparison so non-Latin scripts sort correctly
- The note itself is never listed inside its own index
- A subfolder links to its own index note if one exists there; otherwise it appears as
  plain text, since Obsidian cannot link to a directory

## Settings

| Setting | Default | Purpose |
|---|---|---|
| Marker word | `MOC` | change if `%% MOC %%` collides with something else |
| Prefix for created notes | `-` | naming of notes made by `%% MOC+ %%` |
| Icons | `📄` `🎨` `🗂️` | appearance of the three row types |
| Reverse order | off | sort Z to A instead of A to Z |

## Installation

Not yet in the community plugin directory. Two options:

**Manual.** Download `main.js`, `manifest.json` and `styles.css` from the
[latest release](https://github.com/mstoliarov/obsidian-mymoc/releases/latest) and put
them into `<your vault>/.obsidian/plugins/mymoc/`. Then enable **MyMOC** under
Settings → Community plugins.

**Via BRAT.** Add `mstoliarov/obsidian-mymoc` as a beta plugin.

## Development

```bash
npm install
npm test      # tests for the list-building logic
npm run check # type checking
npm run build # produces main.js
```

All meaningful logic lives in `src/buildIndex.ts` — it has no dependency on the Obsidian
API and is covered by plain `node --test` tests. `src/main.ts` is a thin layer wiring
vault events to that logic.

## License

MIT
