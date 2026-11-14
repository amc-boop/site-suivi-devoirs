---
version: "alpha"
name: "Manga Instructional Comic"
description: "Manga style landing page, black and white comic, speed lines, dynamic panels, ink aesthetic, instructional comic design, with red and green spot colors for urgent/negative and positive highlights. Ideal for landing pages, modern websites. AI-ready template."
colors:
  primary: "#FFFFFF"
  secondary: "#000000"
  tertiary: "#1A1A1A"
  neutral: "#CCCCCC"
  surface: "#000000"
  accent: "#FFFFFF"
  danger: "#A60321"
  on-danger: "#FFFFFF"
  success: "#90E098"
  on-success: "#000000"
typography:
  h1:
    fontFamily: Manga Temple
    fontSize: 2.5rem
    fontWeight: 700
  body-md:
    fontFamily: Manga Temple
    fontSize: 1rem
    fontWeight: 400
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral}"
    padding: 12px
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-danger}"
    padding: 12px
  button-success:
    backgroundColor: "{colors.success}"
    textColor: "{colors.on-success}"
    padding: 12px
  alert-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-danger}"
    padding: 16px
  alert-success:
    backgroundColor: "{colors.success}"
    textColor: "{colors.on-success}"
    padding: 16px
---

## Overview

Manga style landing page, black and white comic, speed lines, dynamic panels, ink aesthetic, instructional comic design. Ideal for landing pages, modern websites. AI-ready template. Manga as instructional medium didn't emerge from some corporate brainstorm. It grew organically in post-war Japan, where publishers realized sequential art could teach everything from cooking to electronics repair. The format exploded in the 1960s and 70s — government manuals, workplace safety guides, even tax filing instructions rendered in panels with expressive characters and dramatic pacing. What made it stick wasn't novelty. It was comprehension. Studies consistently showed readers retained more from manga-format instructions than from plain text equivalents.

The retro-pop aesthetic we associate with instructional manga — bold screentones, exaggerated reactions, speed lines on mundane tasks — crystallized in the 1980s. Publishers like Gakken and Shogakukan perfected the formula: a relatable protagonist encounters a problem, a mentor figure appears, knowledge transfers through dialogue and visual demonstration. The format respected readers enough to entertain them while teaching.

Western design finally caught on decades later. Now everyone wants "manga-style onboarding" without understanding the grammar. The panel transitions, the emotional beats between information dumps, the careful balance of white space and density — these aren't decorative choices. They're pedagogical architecture refined over sixty years.

Color is used the way a two-color manga print uses a spot ink: sparingly and with intent. The page stays black and white, and two spot colors — a deep red and a soft green — flag what the reader must notice. Red marks what is urgent, risky or negative. Green marks what is positive, successful or safe. Anything else stays in ink and paper.

- Density: 5/10 — Balanced
- Variance: 7/10 — Dynamic
- Motion: 4/10 — Subtle

- **Style:** Energetic, Expressive, Narrative
- **Keywords:** manga, comic, japanese, black and white, spot color, speed lines, ink, action, panel
- **Era:** Modern Manga
- **Light/Dark:** ✓ Full / ✗ No

## Colors

- **Background** (#FFFFFF) — Primary background surface
- **Text** (#000000) — Primary text color
- **Accent** (#1A1A1A) — Primary accent, CTAs and interactive elements
- **Screen Tone** (#CCCCCC) — Extended palette, decorative use
- **Speed Line** (#000000) — Extended palette, decorative use
- **Paper White** (#FFFFFF) — Secondary surface
- **Danger Red** (#A60321) — Spot color. Urgent, critical, negative or destructive information only
- **Success Green** (#90E098) — Spot color. Positive, successful, confirmed or safe information only

### Semantic Spot Colors

The base palette remains black, white and gray. Red and green are the only colors allowed on the page, and they carry meaning, never decoration.

| Role | Color | Use it for | Paired text |
|---|---|---|---|
| Danger | #A60321 | Urgent deadlines, errors, failed states, warnings, destructive actions, negative deltas, "stop" steps in a tutorial | #FFFFFF |
| Success | #90E098 | Confirmations, completed steps, positive deltas, "safe to proceed" steps, validated inputs | #000000 |

Usage rules:

- **Spot-color budget:** red and green together cover at most ~10% of any viewport. If everything is highlighted, nothing is. One dominant highlight per screen section.
- **Fill, not text, on the wrong background:** Success Green on white has too little contrast to be text (about 1.5:1). Use it as a fill with black text, or as a thick border/underline with black text beside it. Danger Red on black is also too weak for text (about 2.6:1): on black surfaces use it as a fill with white text and a white 2px border.
- **Safe text pairings:** white on Danger Red (about 7.9:1), black on Success Green (about 13:1), Danger Red text on white (about 7.9:1), Success Green text on black (about 13:1).
- **Never color alone:** red and green are hard to tell apart for many readers. Every colored element also carries an icon (Lucide `triangle-alert`, `octagon-x`, `circle-check`, `shield-check`), a text label, and where it fits an SFX word in the manga lettering style.
- **Tints are screentones:** to soften red or green (backgrounds, hover areas, large panels), use a halftone dot screen of the color at 10–20% density rather than a transparent flat tint. Never introduce lighter or darker variants of the two colors as new palette entries.
- **No gradients, no glows** on red or green. Flat ink fills only, with the same 1–2px black outline used elsewhere.
- **Dark sections:** the palette doesn't change. Green reads naturally on black; red stays a filled shape with a white outline.

## Typography

- **Display / Hero:** Manga Temple — Weight 700, tight tracking, used for headline impact
- **Body:** Manga Temple — Weight 400, 16px/1.6 line-height, max 72ch per line
- **UI Labels / Captions:** Manga Temple — 0.875rem, weight 500, slight letter-spacing
- **Monospace:** JetBrains Mono — Used for code, metadata, and technical values
- **SFX / Alert lettering:** Manga Temple — Weight 700, uppercase, tight tracking, optionally skewed -6deg. Short words only ("WARNING!", "URGENT!", "OK!", "DONE!"). Set in white on Danger Red or black on Success Green.

Scale:
- Hero: clamp(2.5rem, 5vw, 4rem)
- H1: 2.25rem
- H2: 1.5rem
- Body: 1rem / 1.6
- Small: 0.875rem

## Layout

- **Grid:** CSS Grid primary. Max-width containment: 1280px centered with 1.5rem side padding.
- **Spacing rhythm:** Balanced. Base unit: 0.5rem (8px).
- **Section vertical gaps:** clamp(4rem, 8vw, 8rem).
- **Hero layout:** Asymmetric composition.
- **Feature sections:** Asymmetric grid with varied card sizes. No 3-equal-columns.
- **Mobile collapse:** All multi-column layouts collapse below 768px. No horizontal overflow.
- **z-index contract:** base (0) / sticky-nav (100) / overlay (200) / modal (300) / toast (500).
- **Alert placement:** urgent banners sit at the top of their section or as a sticky strip under the nav (z-index 100). Inline alerts sit directly above the content they refer to. Toasts (z-index 500) use Success Green for confirmations and Danger Red for failures.

## Elevation & Depth

Dynamic comic paneling, speed lines (beta flash), impact bursts, expressive character acting, traditional ink aesthetics, halftone screentones.

- **Physics:** Ease-out curves, 200-300ms duration. Smooth and predictable.
- **Entry animations:** Fade + translate-Y (16px → 0) over 420ms ease-out. Staggered cascades for lists: 80ms between items.
- **Hover states:** Subtle color shift + shadow adjustment over 200ms.
- **Page transitions:** Fade only (200ms).
- **Performance:** Only transform and opacity animated. No layout-triggering properties.
- **Impact bursts in color:** a Danger Red burst (spiky starburst shape, black outline) can frame an urgent callout; a Success Green burst can frame a positive result. Use one burst per section at most.
- **Urgent emphasis:** a Danger Red alert may play a single short "impact" shake on entry (translateX ±4px, 300ms, once). Success Green never shakes. Disabled entirely under `prefers-reduced-motion`.

## Shapes

Base corner radius: 8px. See rounded tokens in front matter for the full scale. Red and green shapes keep the same 2px black ink outline as every other panel. For high-energy moments, a colored panel may use an angled edge (clip-path, 3–6deg) like a dynamic manga frame.

## Components

- **Primary Button:** Subtly rounded (0.5rem) shape. Accent color fill. Hover: 8% darken + subtle lift shadow. Active: -1px translate tactile press. Font weight 600. No outer glows.
- **Secondary / Ghost Button:** Outline variant. 1.5px border in muted color. Text in primary color. Hover: subtle background fill.
- **Danger Button:** Same shape as the primary button. Fill Danger Red (#A60321), white text, 2px black outline. Reserved for destructive or irreversible actions (delete, cancel subscription). Hover: 8% darken + subtle lift shadow. Always paired with an icon or a clear label, never color alone.
- **Success Button:** Same shape as the primary button. Fill Success Green (#90E098), black text, 2px black outline. Reserved for confirming or completing a positive action (confirm, finish, validate). Hover: 8% darken + subtle lift shadow.
- **Cards:** Subtly rounded (0.5rem) corners. Surface background. Subtle shadow (0 2px 12px rgba(0,0,0,0.06)). 1px border stroke.
- **Highlighted Cards:** a card may carry a 6px left edge (or an angled corner flag) in Danger Red or Success Green to signal status. The card body stays black and white.
- **Alerts / Callouts:** Panel-style box with a 2px black border, 0.5rem radius, icon on the left, bold SFX-style title, then a short body line.
  - *Danger alert:* Danger Red fill, white text and icon. For urgent, blocking or negative messages.
  - *Success alert:* Success Green fill, black text and icon. For confirmations and positive messages.
  - Optional halftone dot pattern in a slightly darker/lighter dot of the same color on the panel corner.
- **Badges / Status Chips:** Small pill, 1.5px black border. "Urgent", "Overdue", "Failed" in Danger Red with white text. "Done", "Active", "Passed" in Success Green with black text. Each includes an icon.
- **Numbers & Deltas:** negative or worsening figures are set on a Danger Red chip (white text); positive or improving figures on a Success Green chip (black text), always with an arrow icon and a sign (+/−).
- **Inputs:** Label above input. 1px border stroke. Focus ring: 2px accent color offset 2px. Error text below in Danger Red (#A60321) with an alert icon, and the border turns Danger Red at 2px. Valid state: 2px Success Green border plus a check icon (text stays black). No floating labels.
- **Navigation:** Primary surface background. Active item: accent color indicator. Font weight 500 when active. A notification dot uses Danger Red with a white 1.5px outline.
- **Progress & Steps (instructional):** completed steps use Success Green fill with a check, the current step is outlined in black, and a blocked or failed step uses Danger Red with an alert icon. Connecting lines stay black.
- **Skeletons:** Shimmer animation matching component dimensions. No circular spinners.
- **Empty States:** Icon-based composition with descriptive text and action button.

## Do's and Don'ts

- No emojis in UI — use icon system only (Lucide, Heroicons)
- No pure black (#000000) — use off-black or charcoal variants
- No oversaturated accent colors (saturation cap: 80%). The only exceptions are the two defined spot colors, Danger Red #A60321 and Success Green #90E098, used as specified in the Colors section.
- No 3-column equal-width feature layouts — use zig-zag or asymmetric grid
- No `h-screen` — use `min-h-[100dvh]`
- No AI copywriting clichés: "Elevate", "Seamless", "Unleash", "Next-Gen"
- No broken external image links — use picsum.photos or inline SVG
- No generic lorem ipsum in demos
- No red or green for decoration, branding or illustration. They always carry meaning.
- No other hues (blue, yellow, orange, purple) and no new tints or shades of red and green
- No red/green meaning conveyed by color alone. Always add an icon and a label.
- No green text on white backgrounds and no red text on black backgrounds

- Do Black and White dominant
- Do Manga style speed lines
- Do Angled/Dynamic panels
- Do Screentone textures
- Do Sound effect graphics (text)
- Do Red (#A60321) for urgent, risky or negative information
- Do Green (#90E098) for positive, successful or safe information
- Do Keep red and green rare so they stay readable as signals
- Do Use halftone dots of red or green for soft emphasis areas
- Do Outline every colored shape in black ink like the rest of the panels

## Use Case

Landing pages, Modern websites

<!-- Source: https://designmd.app/library/manga-instructional-comic · designmd.app -->
