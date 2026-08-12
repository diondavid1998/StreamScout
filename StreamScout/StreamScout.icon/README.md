# StreamScout.icon — Liquid Glass App Icon

> ⚠️ **IMPORTANT — Build setting prerequisite**
>
> `ASSETCATALOG_COMPILER_APPICON_NAME` **must remain set to `AppIcon`** in
> `StreamScout.xcodeproj/project.pbxproj` until you have completed the Icon Composer
> workflow described below. Do **not** change it to `StreamScout` until you have:
> 1. Opened `StreamScout.icon` in Icon Composer,
> 2. Populated every layer with real layered artwork, and
> 3. Saved the bundle from Icon Composer (⌘S).
>
> That save is what produces a valid `actool` input. Switching the setting before that
> step causes `actool` to fail with:
> *"None of the input catalogs contained a matching … app icon set, or icon stack named
> 'StreamScout'"*, which breaks the entire build.

## What this bundle is

`StreamScout.icon` is an **Icon Composer** bundle for an iOS 26 Liquid Glass app icon.
It contains a layered manifest (`icon.json`) and placeholder layer art that you must replace
with real layered artwork before the icon looks correct.

> ⚠️ **The placeholder files in `Assets/` are solid-colour fills.** They exist only to
> satisfy the build and to demonstrate the layer structure. Replace them before shipping.

---

## How to complete the icon in Icon Composer

### Prerequisites
- Xcode 26 or later (includes Icon Composer)
- Layered source artwork for the StreamScout logo (Sketch / Figma / Illustrator / SVG).
  *The only asset in the repo today is a flattened PNG
  (`Assets.xcassets/StreamScoreLogo.imageset/StreamScout.png`); new layered art is required
  for a quality result.*

### Step-by-step workflow

1. **Open Icon Composer**
   In Xcode 26: *File ▶ Open* → select `StreamScout/StreamScout.icon`.
   Icon Composer will read `icon.json` and display the layer stack.

2. **Replace placeholder layers**

   | Layer | What to put here |
   |-------|-----------------|
   | **Background** (Default / Light) | A gradient or solid fill using the app's signature violet palette: `#8C7BFF` → `#5B8CFF` at 135 °. A 1024 × 1024 transparent PNG or a vector fill works best. |
   | **Background** (Dark) | Deeper version of the same palette (`#5B8CFF` → `#3B5BDB`). |
   | **Foreground** | The StreamScout logo glyph with a transparent background (PNG or vector). Place it centred with adequate safe-area margin so it isn't clipped by the squircle mask. |

3. **Tune per-layer glass settings**
   Select each layer and adjust the *Specular*, *Refraction*, and *Shadow* sliders in the
   Inspector panel to achieve the desired glass depth.

4. **Preview all four appearance variants**
   Use the variant switcher at the top of the canvas to verify:
   - **Default** (light system appearance)
   - **Dark** (dark system appearance)
   - **Clear** (wallpaper shows through)
   - **Tinted** (user-chosen tint colour)

5. **Save**
   *⌘S* — Icon Composer writes the updated manifest and any embedded asset data back into
   the `.icon` bundle. Xcode picks it up automatically on the next build.

---

## How it is wired into the Xcode project

`project.pbxproj` currently sets:

```
ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
```

for all build configurations. This points `actool` at the existing `AppIcon.appiconset`,
which is the working flat-PNG icon.

**Once you have completed the Icon Composer workflow** (opened `StreamScout.icon`, replaced
all placeholder layers with real layered artwork, and saved), change the build setting to:

```
ASSETCATALOG_COMPILER_APPICON_NAME = StreamScout;
```

in **both** the Debug and Release configurations in `project.pbxproj`. That change tells
`actool` to use `StreamScout.icon` (matched by basename) as the primary app icon for
iOS 26+ with Liquid Glass.

**The existing `AppIcon.appiconset` is kept unchanged** as the fallback for devices running
iOS 25 and earlier. No deletion is needed; the build system selects the appropriate icon
automatically based on the OS version.

---

## Colour reference (Signature Violet theme)

| Token | Hex | Use |
|-------|-----|-----|
| `mkAccent` / accent | `#8C7BFF` | Background gradient start, foreground tint |
| `mkAccentAlt` / accentAlt | `#5B8CFF` | Background gradient end |
| `mkBackground` | `#0A0B14` | Dark-mode canvas background |

These values come from `AppTheme.signatureViolet` in `StreamScoutApp.swift`.

---

## Notes for reviewers / maintainers

- **This PR sets up scaffolding only.** The `.icon` bundle **must** be opened in Icon
  Composer and supplied with real layered artwork before the Liquid Glass effect appears on
  device.
- The `icon.json` manifest schema used here is a best-effort representation of the Icon
  Composer format as documented for Xcode 26 beta. Open and re-save the bundle in Icon
  Composer to normalise the format to whatever schema Xcode currently expects.
- Vectors (PDF/SVG) or transparent PNGs are preferred for each layer; avoid importing the
  existing flattened `AppIcon.png` as a layer because the glass system cannot decompose it.
