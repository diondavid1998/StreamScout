# WhatsOn.icon — Liquid Glass App Icon

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
> None of the input catalogs contained a matching … app icon set, or icon stack named "WhatsOn".
> ```
>
> **Only switch the setting to `WhatsOn` after completing the Icon Composer workflow
> described below and confirming the build succeeds locally.**

## What this bundle is

`WhatsOn.icon` is an **Icon Composer** bundle for an iOS 26 Liquid Glass app icon.
It contains a layered manifest (`icon.json`) plus generated orange-gradient background and
gold eye/play foreground artwork that matches the current brand direction.

---

## How to complete the icon in Icon Composer

### Prerequisites
- Xcode 26 or later (includes Icon Composer)
- Layered source artwork for the WhatsOn logo (Sketch / Figma / Illustrator / SVG).
  *The only asset in the repo today is a flattened PNG
  (`Assets.xcassets/StreamScoreLogo.imageset/WhatsOn.png`); new layered art is required
  for a quality result.*

### Step-by-step workflow

1. **Open Icon Composer**
   In Xcode 26: *File ▶ Open* → select `WhatsOn/WhatsOn.icon`.
   Icon Composer will read `icon.json` and display the layer stack.

2. **Refine the included layers if needed**

   | Layer | What to put here |
   |-------|-----------------|
   | **Background** (Default / Light) | Orange gradient glass base: `#FFAA58` → `#AA4C0C` with soft highlights. |
   | **Background** (Dark) | Darker amber version of the same gradient for dark appearance. |
   | **Foreground** | Gold/bronze eye-outline with centered play triangle, exported on transparency for Liquid Glass treatment. |

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
ASSETCATALOG_COMPILER_APPICON_NAME = WhatsOn;
```

That tells the compiler to use `WhatsOn.icon` (matched by basename) as the primary
app icon for iOS 26+. **Do not make this change before Icon Composer has saved the bundle**
— the hand-authored `icon.json` is not a valid `actool` input and the build will fail.

**The existing `AppIcon.appiconset` is kept unchanged** as the fallback for devices running
iOS 25 and earlier. No deletion is needed; the build system selects the appropriate icon
automatically based on the OS version.

---

## Colour reference (Sunset Amber brand mark)

| Token | Hex | Use |
|-------|-----|-----|
| `brandOrangeLight` | `#FFAA58` | Background gradient start |
| `brandOrangeDark` | `#AA4C0C` | Background gradient end |
| `brandGold` | `#E2AE58` | Eye/play motif tint |

These values are used by the generated icon assets in this folder and the fallback flat icon.

---

## Notes for reviewers / maintainers

- The included PNG layers already match the current orange/gold brand mark, but opening and
  re-saving the bundle in Icon Composer is still recommended if you want Xcode to emit the
  final system-authored Liquid Glass variant.
- The `icon.json` manifest schema used here is a best-effort representation of the Icon
  Composer format as documented for Xcode 26 beta. Open and re-save the bundle in Icon
  Composer to normalise the format to whatever schema Xcode currently expects.
- Vectors (PDF/SVG) or transparent PNGs are preferred for each layer; avoid importing the
  existing flattened `AppIcon.png` as a layer because the glass system cannot decompose it.
