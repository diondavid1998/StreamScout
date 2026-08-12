# StreamScout.icon — Liquid Glass App Icon

> ⛔ **BUILD SETTING WARNING**
>
> `ASSETCATALOG_COMPILER_APPICON_NAME` **must remain `AppIcon`** until this `.icon` bundle
> has been opened in Icon Composer, populated with real layered artwork, and saved.
>
> `actool` only recognises a `.icon` bundle that Icon Composer itself generated and saved.
> The hand-authored `icon.json` in this directory is a best-effort placeholder — `actool`
> will reject it and the build will fail with:
>
> ```
> None of the input catalogs contained a matching … app icon set, or icon stack named "StreamScout".
> ```
>
> **Only switch the setting to `StreamScout` after completing the Icon Composer workflow
> described below and confirming the build succeeds locally.**

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

for all build configurations. This points the asset-catalog compiler at
`Assets.xcassets/AppIcon.appiconset`, which contains the working flat icon and builds
successfully today.

Once you have completed the Icon Composer workflow below and saved a valid `.icon` bundle,
change the setting in **both** the Debug and Release configurations to:

```
ASSETCATALOG_COMPILER_APPICON_NAME = StreamScout;
```

That tells the compiler to use `StreamScout.icon` (matched by basename) as the primary
app icon for iOS 26+. **Do not make this change before Icon Composer has saved the bundle**
— the hand-authored `icon.json` is not a valid `actool` input and the build will fail.

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
