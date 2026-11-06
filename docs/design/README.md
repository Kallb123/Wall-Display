# Design mocks

The mocks for the display, the remote and the settings pages come from the Claude Design project "Wall Display". This folder is a copy of them, so the docs and anyone working on the code can see them without access to that project. The design project is where they are changed. After a change, export it again and update this folder (see below).

Last exported 6 Nov 2026 (turn 4, the portrait mocks for PR 5.9).

| Path | What it is |
|---|---|
| `mocks/<id>.png` or `.jpg` | A picture of each mock, named by its id on the canvas (`1a` to `4r`). The ids are listed in architecture §4.3. Landscape mocks are 1280×720 and portrait mocks are 720×1280, which is half the stage size. The phone remote and the settings page are at 1:1. Mocks with a photo in them are JPEG. |
| `source/` | The export itself. `Wall Display.dc.html` is the canvas that holds every mock. Each `*.dc.html` file is one screen. `wall-data.js` and `portrait-data.js` hold the sample family, events and layout code, and `_ds/` is the Organic design system (`styles.css` holds the tokens). Use these for exact sizes, spacing and colours. |
| `render-mocks.js` | Makes `mocks/` from `source/`. |

The pictures show what each mock looks like. Where the docs and a mock disagree, the docs say which one wins (for example, architecture §4.6 gives the portrait week the `week_hours` range, not the mock's fixed 08:00–21:00).

## Updating

1. Export the design project and unzip it over `source/`. Leave out `.thumbnail`, `github.md` and the `docs/` folder. The project's `docs/portrait/*.svg` files are copies of the sketches already in `docs/portrait/`.
2. Render the pictures. The canvas loads React and Babel from unpkg and the fonts from Google Fonts. The script serves them from a local `node_modules` instead, so it also works without those hosts. It needs Playwright with Chromium.

   ```bash
   mkdir -p /tmp/mock-deps && npm i --prefix /tmp/mock-deps react@18.3.1 react-dom@18.3.1 @babel/standalone@7.29.0 @fontsource/caprasimo@5 @fontsource/figtree@5
   ```

   ```bash
   node docs/design/render-mocks.js docs/design/source docs/design/mocks /tmp/mock-deps/node_modules
   ```

3. Add any new mock ids to the table in architecture §4.3, and update the export date above.
