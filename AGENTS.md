# Notes for coding agents

The app is in `calendar-app/` (Nuxt 4, pnpm, Node 24). Run commands from there.

## Before you push: run what CI runs

CI (`.github/workflows/ci.yml`) has two jobs for the app. Both must pass.

**`app` job:**

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

**`display` job (visual tests):**

```bash
pnpm build
pnpm test:visual
```

`pnpm test` does **not** run the visual tests. A change can pass lint, typecheck,
build and every unit, component and e2e test, and still fail CI here. **Always
run `pnpm test:visual` before pushing a change to anything under `app/`**
(pages, components, CSS, `app/utils`) or to `shared/` code the pages render.
`pnpm test:visual` serves the built app (`.output/`), so run `pnpm build` first
and again after every change.

### Visual baselines

The screenshots in `test/visual/*-snapshots/` are pixel baselines
(`maxDiffPixelRatio: 0.002`). Any visible change to a page fails every test
whose screenshot includes it, including pages you didn't touch. Shared chrome
breaks screenshots across tabs. For example, an extra settings tab made the
tab bar wrap on a phone, which changed every full-page phone screenshot of
the settings pages (Layouts, Stars, Special days).

When the change is intended:

1. Run the whole visual suite and note every test that fails.
2. Look at each failure's `*-diff.png` and `*-actual.png` in `test-results/`.
   Only update a baseline when the difference is the change you meant.
3. Update only those tests, by file and line:
   ```bash
   pnpm exec playwright test test/visual/settings.spec.ts:336 --update-snapshots
   ```
   (`pnpm test:visual:update` rewrites every baseline. Only use it when you
   mean to.)
4. Run the whole visual suite again, check that it passes, and commit the
   changed `.png` files with the change that caused them.

Baselines must come from the Chromium build that matches the pinned
`@playwright/test` version in `package.json`, because a different build draws
different pixels. Locally, `pnpm exec playwright install chromium` gets the
right one. In a Claude Code cloud session that build is already in
`/opt/pw-browsers`, so run Playwright with `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`
and don't install another one. If the baselines that you didn't touch fail on
your machine too, your renderer doesn't match CI's. Fix that rather than
regenerating them.

## Other things that have caught people out

- **Auto-imports share one namespace.** Nuxt auto-imports every export from
  `app/utils/*` and `app/composables/*`. If two files export the same name,
  one silently shadows the other everywhere. `pnpm typecheck` and
  `pnpm build` only show this as a `Duplicated imports` warning. Check new
  exports for an existing name (`grep -rn "export function <name>" app/`).
- **Settings and remote APIs never return secrets.** Routes under
  `server/api/settings/` copy out named fields only: no Home Assistant token,
  MQTT credentials, PIN, API keys, ICS addresses or credentials in a URL. The
  e2e tests in `test/e2e/settings.test.ts` check every GET route for these
  secrets, so add a new route to those lists.
- **Settings tabs** are listed in `app/pages/settings.vue`, and
  `test/nuxt/settings.test.ts` checks the exact list. If you add a tab, update
  that test and the visual baselines (see above).
