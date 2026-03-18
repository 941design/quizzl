# Theme IP & Inspiration Research

> Research date: 2026-03-18 | Status: Research only — no implementation

## Executive Summary

Both "block/pixel" and "brick/building" themes can be safely implemented using **generic aesthetics** without any brand references. The key distinction is between **copyrightable/trademarkable brand elements** (names, logos, specific character designs) and **genre conventions** (pixel art, voxel geometry, interlocking bricks) that are free to use.

Your project already has scaffolded `lego` and `minecraft` theme entries in `app/src/lib/theme.ts`. The internal theme IDs are fine for development, but **user-facing labels should use generic names** like "Block World" and "Brick Builder."

---

## Part 1: Block/Pixel/Voxel Theme (Minecraft-inspired)

### What Defines the Aesthetic

| Element | Description |
|---------|-------------|
| Voxel geometry | Everything is cubes — translates to grid layouts, square cards, hard edges, `border-radius: 0` |
| Pixelated textures | 16×16 pixel textures scaled with `image-rendering: pixelated` / `crisp-edges` |
| Earthy palette | Grass greens (#477A1E, #70B237), dirt browns (#61371F, #854F2B), stone grays (#9C9D97), sky blue (#A0A0FF) |
| Pixel fonts | Blocky, bitmap-style typefaces |
| Inventory-slot grids | Uniform square cells in CSS Grid — a common game UI pattern |
| Beveled 3D frames | Lighter top-left / darker bottom-right borders for classic game panel look |

### CSS Techniques

- **`image-rendering: pixelated`** + `crisp-edges` for scaling pixel art (~95% browser support)
- **`box-shadow` pixel art**: 1×1px element with hundreds of comma-separated shadows = pure CSS sprites
- **`repeating-linear-gradient`** / `conic-gradient` for checkerboard and grid patterns
- **CSS Grid** for inventory-slot layouts: `grid-template-columns: repeat(N, 1fr); gap: 2px`
- **Step-based animations**: `animation-timing-function: steps(N)` for sprite-sheet effects

### Licensing: What's Protected

| Protected (AVOID) | Why |
|---|---|
| The word "Minecraft" | Registered trademark (USPTO #4853070) |
| Minecraft logo and lettering style | Trademarked |
| Character names: Steve, Alex, Creeper, Enderman, etc. | Copyrighted/trademarked |
| Actual game textures (.png files from the game) | Copyrighted |
| Official artwork, screenshots, marketing materials | Copyrighted |
| Game audio/music | Copyrighted |
| Any implied endorsement or association | Violates usage guidelines |

### What's Free to Use

| Element | Why it's safe |
|---|---|
| Blocky/voxel visual style | Genre convention predating the game, used by many titles |
| Pixel art style | Established art form, not owned by anyone |
| Earthy color palettes (your own hex values) | Colors are not copyrightable |
| Pixel fonts (OFL-licensed) | Independent creations |
| Inventory-grid UI pattern | Common game design pattern |
| Beveled button styles | Classic UI convention |
| Generic terms: "Block World," "Pixel Quest," "Voxel Land" | Descriptive, non-trademarked |

### If You Reference the Game at All

Required disclaimer: *"NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT."*

**Recommendation**: Don't reference it at all. Use a generic name.

### Safe Fonts

| Font | License | Notes |
|------|---------|-------|
| [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) | OFL (Google Fonts) | Classic 8-bit arcade |
| [VT323](https://fonts.google.com/specimen/VT323) | OFL (Google Fonts) | DEC terminal inspired |
| [Silkscreen](https://fonts.google.com/specimen/Silkscreen) | OFL (Google Fonts) | Small-size pixel font |
| [Monocraft](https://github.com/IdreesInc/Monocraft) | OFL (GitHub) | Monospaced, game-inspired |
| Minecraftia | **Personal use only** | Commercial license required — avoid |

### Safe Asset Sources

| Source | License | Content |
|--------|---------|---------|
| [Kenney.nl](https://kenney.nl/assets) | CC0 (public domain) | 30,000+ game assets incl. Voxel Pack (190), Pixel Platformer (200), 1-Bit Pack (1,000+) |
| [OpenGameArt.org](https://opengameart.org) | CC0 options | Pixel art tilesets, textures, sprites, UI elements |
| [itch.io CC0 assets](https://itch.io/game-assets/assets-cc0) | CC0 | Searchable marketplace |

### CSS Libraries

| Library | Description |
|---------|-------------|
| [NES.css](https://nostalgic-css.github.io/NES.css/) | 8-bit NES-style components (buttons, dialogs, progress bars). Has React wrapper (nes-ui-react) |
| [Minecraft.css](https://github.com/Jiyath5516F/Minecraft-CSS) | Recreation of game UI components. ⚠️ Check license and naming implications |
| [McIcons.css](https://www.cssscript.com/minecraft-ui-icons/) | 1,300+ pixel-style icons |

### Suggested Theme Name

For the theme selector: **"Block World"** or **"Pixel Quest"**

---

## Part 2: Brick/Building Block Theme (LEGO-inspired)

### What Defines the Aesthetic

| Element | Description |
|---------|-------------|
| Studs (circular bumps) | The most iconic element — achievable with `radial-gradient()`, `border-radius: 50%`, `box-shadow` |
| Bright primary palette | Saturated primaries at ~100% saturation, ~50% luminance |
| Rounded rectangles | Slightly rounded edges, solid tactile proportions |
| Baseplate grids | Repeating stud patterns via `radial-gradient` or SVG tiles |
| Instruction-step layouts | Numbered steps, clean backgrounds, progressive complexity |
| Chunky proportions | Oversized, solid UI elements with weight and presence |

### Key Colors (from community-calibrated sources, not official brand assets)

| Color | Hex | Usage |
|-------|-----|-------|
| Bright Red | #B40000 | Accent, danger |
| Bright Blue | #1E5AA8 | Primary, links |
| Bright Yellow | #FAC80A | Highlight, success |
| Bright Green | #58AB41 | Success, progress |
| Bright Orange | #D67923 | Warning, CTA |
| Dark Bluish Gray | #646464 | Text, borders |
| Light Bluish Gray | #969696 | Muted text, backgrounds |

### CSS Techniques

- **Radial gradient studs**: Multiple `background-image: radial-gradient()` layers with light/shadow
- **Pseudo-element studs**: `::before`/`::after` with `border-radius: 50%` and `box-shadow`
- **CSS 3D bricks**: `transform: rotateX() rotateY()` with clipped faces
- **Snap animations**: CSS `@keyframes` with `transform` (GPU-accelerated)
- **[react-legos](https://github.com/brycedorn/react-legos)**: MIT-licensed React component for CSS bricks

### Licensing: What's Protected

| Protected (AVOID) | Why |
|---|---|
| The word "LEGO" | Registered trademark — must never be used in app name, URL, or UI text |
| LEGO logo | Protected trademark and copyright |
| Set names: NINJAGO, DUPLO, FRIENDS, etc. | All registered trademarks |
| Minifigure proportions | Shape mark — cylindrical head, C-hands, specific body ratio are protected |
| Official imagery, instruction scans, renders | Copyrighted |
| Implying endorsement or affiliation | Prohibited by Fair Play policy |

### What's Free to Use

| Element | Why it's safe |
|---|---|
| Generic brick aesthetics | Basic patent expired 1978; brick shape denied trademark in 2010 |
| Stud patterns on surfaces | Generic mechanical feature, not protectable |
| Bright primary color palettes | Generic toy colors, not owned by any brand |
| Building/construction metaphors | Common language |
| Instruction-step layouts | Generic UX pattern |
| Snap-together animations | Universal building metaphor |
| CSS 3D brick effects | Rendering generic blocks |
| Terms: "building blocks," "bricks," "brick builder" | Generic English words |

### Historical Precedent: Bricks Predate the Brand

- **Build-O-Brik** (1934) — rubber blocks
- **Minibrix** (1935) — rubber interlocking blocks
- **Kiddicraft Self-Locking Bricks** (1939) — Hilary Fisher Page invented stud-on-top plastic bricks
- **American Bricks** (1939) — pressed wood blocks

The interlocking brick concept is a **category**, not a brand.

### Minifigure: Highest Risk Area

Courts have ruled the minifigure's features (head shape, body proportions, C-hands) are "designed mainly to confer human traits" and are **fully protectable**. Competitors with "strikingly similar" figures had registrations invalidated.

**If you want mascot characters**: Use clearly different proportions — round/organic shapes, different head-to-body ratio, different hand designs. Do not replicate the minifigure silhouette.

### Safe Asset Sources

| Source | License | Content |
|--------|---------|---------|
| [FreeSVG.org building blocks](https://freesvg.org/building-blocks) | CC0 | Public domain building block vectors |
| [SVG Repo](https://www.svgrepo.com/vectors/building-blocks/) | Open-licensed | Building block SVGs |
| [react-legos](https://github.com/brycedorn/react-legos) | MIT | React CSS brick components |
| [Noun Project](https://thenounproject.com/browse/icons/term/building-blocks/) | Various | 1,560+ building block icons |

### Suggested Theme Name

For the theme selector: **"Brick Builder"** or **"Block Build"**

---

## Part 3: Educational Metaphor — Building Knowledge

The brick-building metaphor maps naturally to quiz/learning progression:

| Learning Activity | Building Metaphor |
|---|---|
| Answer a question correctly | Place a brick |
| Complete a topic | Finish a build step |
| Master a subject | Complete a model |
| View progress | Watch structure grow |
| Follow a guided sequence | Follow instruction steps |

This aligns with **constructivist learning theory** — "building knowledge brick by brick."

---

## Part 4: Current Project State

Your `app/src/lib/theme.ts` already defines both themes:

| Theme | Visual Style | Brand Color | Background | Surface Pattern |
|-------|-------------|-------------|------------|-----------------|
| `lego` | `"toy"` | Yellow (#F4B400) | Grid gradient (120px) | `"studs"` |
| `minecraft` | `"pixel"` | Green (#759A2F) | Pixelated checkerboard | `"grid"` |

**Current gaps to address**:
- User-facing labels still say "Lego" and "Minecraft" — rename to generic alternatives
- No custom fonts loaded (Minecraft theme uses Trebuchet MS system fallback)
- No sound effects or interaction animations
- Stud/grid surface patterns are defined as strings but rendering implementation may be incomplete
- No CC0 assets sourced yet

---

## Part 5: Implementation Workflow Recommendation

Based on the Claude Code skills available:

1. **Rename user-facing theme labels** — quick edit to `i18n.ts` and `theme.ts`
2. **Use `/mro:feature`** to implement each enhancement as a feature:
   - Load Google Fonts (Press Start 2P, VT323) for block theme
   - Load chunky/rounded fonts for brick theme
   - Implement CSS stud pattern renderer
   - Implement CSS pixel-grid background
   - Add gamification animations (confetti, brick-stacking)
3. **Use `/audit`** to verify IP compliance before deployment
4. **Consider custom skills** for theme auditing and generation workflows

---

## Sources

### Minecraft/Block IP
- [Minecraft Usage Guidelines](https://www.minecraft.net/en-us/usage-guidelines)
- [Minecraft EULA](https://www.minecraft.net/en-us/eula)
- [Justia Trademark Record](https://trademarks.justia.com/791/45/minecraft-79145431.html)
- [GameDeveloper IP Analysis](https://www.gamedeveloper.com/business/-i-minecraft-i-intellectual-property-and-the-future-of-copyright)

### LEGO/Brick IP
- [LEGO Fair Play Policy](https://www.lego.com/en-us/legal/notices-and-policies/fair-play)
- [LEGO IP Notice](https://www.lego.com/en-us/legal/notices-and-policies/intellectual-property-notice)
- [Library of Congress: 60 Years of LEGO and Danish Patent Law](https://blogs.loc.gov/law/2018/01/60-years-of-lego-building-blocks-and-danish-patent-law/)
- [EU Court 2010: Brick Shape Not a Trademark](https://edition.cnn.com/2010/BUSINESS/09/15/eu.lego.trademark/index.html)
- [Dennemeyer: Building Blocks of LEGO Law](https://www.dennemeyer.com/ip-blog/news/everyday-ip-the-building-blocks-of-lego-law/)
- [IPKat: EU Design Registration 2024](https://ipkitten.blogspot.com/2024/01/another-brick-in-legos-modular-systems.html)
- [The Conversation: Minifigure Legal Status](https://theconversation.com/how-lego-legally-locked-in-the-iconic-status-of-its-mini-figures-43489)

### Design Resources
- [MDN: image-rendering](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/image-rendering)
- [CSS-Tricks: CSS Pixel Art](https://css-tricks.com/fun-times-css-pixel-art/)
- [CSS-Tricks: CSS in 3D](https://css-tricks.com/css-in-3d-learning-to-think-in-cubes-instead-of-boxes/)
- [Swooshable Color Chart](https://swooshable.com/parts/colors)
- [Brick Architect: Color Palette](https://brickarchitect.com/color/)

### Fonts
- [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) (OFL)
- [VT323](https://fonts.google.com/specimen/VT323) (OFL)
- [Silkscreen](https://fonts.google.com/specimen/Silkscreen) (OFL)
- [Monocraft](https://github.com/IdreesInc/Monocraft) (OFL)

### Asset Libraries
- [Kenney.nl](https://kenney.nl/assets) (CC0)
- [OpenGameArt.org](https://opengameart.org) (CC0 options)
- [FreeSVG.org Building Blocks](https://freesvg.org/building-blocks) (CC0)
- [react-legos](https://github.com/brycedorn/react-legos) (MIT)
- [NES.css](https://nostalgic-css.github.io/NES.css/) (MIT)

### CSS Examples
- [CodePen: CSS Lego Brick](https://codepen.io/philcheng/pen/ZBOLdW)
- [CodePen: Lego.css](https://codepen.io/MisterCurtis/pen/LxPpLO)
- [CodePen: CSS Lego Button](https://codepen.io/jheising/pen/yLLKaza)
- [CodePen: Stacking Bricks](https://codepen.io/nekitk/pen/RNVZpB)

---

## Part 6: Icons, Images & Illustrations

### Block/Pixel Theme — Top Picks

| Library | License | Count | Format | Notes |
|---------|---------|-------|--------|-------|
| [Pixelarticons](https://pixelarticons.com/) | **MIT** | 800 free | SVG, React, webfont | **Top pick.** Strict 24x24 grid, `npm install pixelarticons` |
| [Kenney Pixel UI Pack](https://kenney.nl/assets/pixel-ui-pack) | **CC0** | 750 assets | PNG + vector | Buttons, sliders, panels, progress bars, 5 color variants |
| [Kenney Game Icons](https://kenney.nl/assets/game-icons) | **CC0** | 105 | PNG + SVG | Trophy, star, medal, joystick, leaderboard |
| [Kenney Board Game Icons](https://kenney.nl/assets/board-game-icons) | **CC0** | 250+ | PNG + SVG | Cards, dice, actions, resources |
| [1-bit Pixel Icons (itch.io)](https://itch.io/game-assets/free/tag-icons/tag-pixel-art) | **CC0** | 1,400+ | 16x16 | Massive CC0 pixel icon set |
| [Game-icons.net](https://game-icons.net/) | CC BY 3.0 | 4,170+ | SVG/PNG | Huge game icon library (attribution required) |
| [HackerNoon Pixel Icon Library](https://pixeliconlibrary.com/) | CC BY 4.0 | 1,440+ | SVG/PNG | Light/dark variants (attribution required) |
| [Pxlkit](https://pxlkit.xyz/) | Free w/ attribution | 211 | SVG + React | Gamification pack: trophy, sword, shield, heart, coin, crown |
| [496 RPG Icons (OpenGameArt)](https://opengameart.org/content/496-pixel-art-icons-for-medievalfantasy-rpg) | **CC0** | 496 | Pixel art | Swords, shields, potions, armor, gems, scrolls |

### Brick/Building Block Theme — Top Picks

| Library | License | Count | Format | Notes |
|---------|---------|-------|--------|-------|
| [Phosphor Icons](https://phosphoricons.com/) | **MIT** | 9,000+ | SVG, React/Vue/Svelte | 6 weight variants; `buildings`, `puzzle-piece`, `trophy` |
| [Tabler Icons](https://tabler.io/icons) | **MIT** | 5,900+ | SVG/PNG/webfont | Many building/construction icons |
| [Lucide Icons](https://lucide.dev/) | **ISC** | 1,700+ | SVG, React | Has `blocks` icon (tagged: toys, kids, learning) |
| [Heroicons](https://heroicons.com/) | **MIT** | 1,288 | SVG, React | `building-office`, `puzzle-piece`, `trophy`, `academic-cap` |
| [UXWing](https://uxwing.com/) | **Free, no attribution** | Varies | SVG/PNG | Toy block and building icons |
| [Storyset](https://storyset.com/) | Free w/ attribution | Illustrations | SVG (animated) | "Building Blocks" illustrations in 3 styles |
| [Flaticon Building Blocks](https://www.flaticon.com/free-icons/building-blocks) | Free w/ attribution | 7,122+ | SVG/PNG | Largest quantity (attribution required on free tier) |

### Stud Pattern / Baseplate Generators

| Tool | URL | Notes |
|------|-----|-------|
| Hero Patterns | [heropatterns.com](https://heropatterns.com/) | 90+ SVG patterns — use "polka-dots" sized for stud grids |
| Pattern Monster | [pattern.monster](https://pattern.monster) | Customizable SVG dot grids |
| fffuel ooorganize | [fffuel.co/ooorganize](https://www.fffuel.co/ooorganize/) | SVG grid pattern generator |
| MagicUI Dot Pattern | [magicui.design](https://magicui.design/docs/components/dot-pattern) | React component, Tailwind compatible |

### Voxel / Isometric Generators

| Tool | URL | Notes |
|------|-----|-------|
| fffuel iiisometric | [fffuel.co/iiisometric](https://www.fffuel.co/iiisometric/) | Build isometric block designs, export SVG |
| Kenney Voxel Pack | [kenney.nl](https://kenney.nl/assets/voxel-pack) | 190 CC0 3D block assets |
| Kenney Isometric Blocks | [kenney.nl](https://kenney.nl/assets/isometric-blocks) | 130 CC0 isometric assets |
| Icograms | [icograms.com](https://icograms.com/) | 5,380+ isometric icons, Education Edition available |

### General Illustrations (Theme-Neutral)

| Library | License | Notes |
|---------|---------|-------|
| [unDraw](https://undraw.co/) | **Free, no attribution** | 500+ SVG illustrations (education, gaming, tech) |
| [Open Peeps](https://www.openpeeps.com/) | **CC0** | Mix-and-match character illustrations |
| [Humaaans](https://www.humaaans.com/) | **CC0** | Mix-and-match human figures |

### Unified Access Layer

[**Iconify**](https://iconify.design/) — 200,000+ icons from 150+ sets (Phosphor, Lucide, Tabler, Heroicons, Pixelarticons, etc.) via a single API/React component. Use this as a unified access layer instead of installing each library separately.

### License Summary

| License | What it means | Libraries |
|---------|---------------|-----------|
| **CC0** | Public domain, no restrictions | Kenney, Open Peeps, Humaaans, FreeSVG, some itch.io/OpenGameArt |
| **MIT / ISC** | Free, no attribution required | Pixelarticons, Phosphor, Tabler, Heroicons, Lucide, NES.css |
| **CC BY 3.0/4.0** | Free but attribution required | Game-icons.net, HackerNoon PIL, Streamline Pixel |
| **Free w/ attribution** | Commercial OK but must credit | Flaticon free, Noun Project free, Storyset, Pxlkit community |
| **Paid for no-attribution** | Free tier has restrictions | Pxlkit ($29+), Flaticon premium, Icons8, Blush.design (SVG) |
