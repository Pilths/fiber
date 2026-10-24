---
name: Fiber
description: Fiber core occupancy for network planners, set as Malaysian expressway signage.
colors:
  ground: "#eef0ec"
  panel: "#ffffff"
  panel-2: "#f7f8f5"
  ink: "#1b211e"
  ink-2: "#47504b"
  ink-3: "#5b645f"
  line: "#d3d8d2"
  line-2: "#e3e7e1"
  field-stroke: "#8c958f"
  asphalt: "#20262a"
  asphalt-2: "#2d353a"
  on-dark: "#f3f5f2"
  on-dark-2: "#c3ccc8"
  green: "#006a45"
  green-deep: "#00543a"
  green-tint: "#e3f1ea"
  blue: "#1d4f9c"
  yellow: "#f3c300"
  yellow-tint: "#fff6cf"
  yellow-edge: "#b08d00"
  red: "#b3261e"
  red-tint: "#fbe9e7"
typography:
  display:
    fontFamily: "Barlow Semi Condensed, Barlow, system-ui, sans-serif"
    fontSize: "44px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.02em"
  headline:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1
    fontFeature: "tnum"
  title:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "tnum"
  body-small:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.3
  label:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.05em"
  micro:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.02em"
rounded:
  plate-sm: "3px"
  sm: "4px"
  control: "5px"
  panel: "6px"
  plate-inner: "7px"
  plate: "10px"
spacing:
  cell-gap: "6px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.green}"
    textColor: "{colors.panel}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "42px"
  button-primary-hover:
    backgroundColor: "{colors.green-deep}"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "42px"
  button-secondary-hover:
    backgroundColor: "{colors.panel-2}"
  input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "40px"
  sign-plate:
    backgroundColor: "{colors.green}"
    textColor: "{colors.panel}"
    typography: "{typography.display}"
    rounded: "{rounded.plate}"
    padding: "5px"
  core-cell-available:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.green-deep}"
    rounded: "{rounded.control}"
    height: "58px"
  core-cell-chosen:
    backgroundColor: "{colors.green}"
    textColor: "{colors.panel}"
    rounded: "{rounded.control}"
    height: "58px"
  core-cell-requested:
    backgroundColor: "{colors.yellow-tint}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "58px"
  core-cell-reserved:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.panel}"
    rounded: "{rounded.control}"
    height: "58px"
  core-cell-in-use:
    backgroundColor: "{colors.asphalt}"
    textColor: "{colors.panel}"
    rounded: "{rounded.control}"
    height: "58px"
  core-cell-faulty:
    backgroundColor: "{colors.red-tint}"
    textColor: "{colors.red}"
    rounded: "{rounded.control}"
    height: "58px"
  chip-chosen:
    backgroundColor: "{colors.green}"
    textColor: "{colors.panel}"
    rounded: "{rounded.control}"
    height: "30px"
    padding: "0 6px 0 10px"
  status-pill:
    rounded: "{rounded.sm}"
    padding: "5px 8px 5px 6px"
    typography: "{typography.label}"
  badge-count:
    backgroundColor: "{colors.yellow}"
    textColor: "{colors.ink}"
    height: "20px"
    padding: "0 6px"
  top-bar:
    backgroundColor: "{colors.asphalt}"
    textColor: "{colors.on-dark}"
    height: "56px"
    padding: "0 24px"
---

# Design System: Fiber

## Overview

**Creative North Star: "The Expressway Sign"**

Fiber reads like JKR road signage. A span is a green direction plate with two site codes and a distance, and its cores sit in fixed cells like the lanes on a sign. The palette is the road-sign set, and each colour does one job: asphalt for the shell, expressway green for the identity plate and for anything you can book or press, federal-road blue for Reserved, warning yellow for Requested, ink for In use, red for Faulty. Everything else is concrete-grey ground, white panels and hairline rules.

The screen is dense and built for long desk sessions. Three columns (span list, span detail, reserve and approvals) sit on a flat grey ground. One road-sign grotesk (Barlow) with tabular numerals carries the whole system, so every ID, count and core number lines up in fixed cells. Rank comes from weight and size on a tight scale, not from extra faces or decoration. The design rejects the grey SaaS card grid with a hero metric. The headline number here is an equation that visibly adds up.

**Key Characteristics:**
- A green sign plate with a white inset border as the identity of every span and site code.
- Status shown by fill, symbol and text label together, never by colour alone.
- Tabular numerals everywhere. Counts sit right-aligned like the km figures on a sign.
- Flat white panels with 1px hairlines on concrete ground. Only the Reserve panel lifts.
- Saturated green only where something can be done, or as the identity plate.

## Colors

The JKR road-sign palette on concrete grey. Every saturated colour carries a fixed status meaning.

### Primary
- **Expressway Green** (green): sign plates, site-code plates, Available cell borders, the Chosen fill, the Reserve button, the current span in the list, the active nav underline, and chosen-core chips.
- **Deep Expressway Green** (green-deep): text on white in green contexts (Available core numbers, the free-to-reserve figure, links), plus hover on green fills.
- **Green Wash** (green-tint): hover fill on Available cells.

### Secondary
- **Federal Blue** (blue): the Reserved status fill. Also the focus ring colour (3px outline, 2px offset).

### Tertiary
- **Warning Yellow** (yellow): count badges (Approvals, Waiting for approval) with ink text, the Requested hatch stripes, and text selection.
- **Yellow Wash** (yellow-tint): Requested cell ground and warning notes.
- **Yellow Edge** (yellow-edge): the Requested cell border.
- **Signal Red** (red): Faulty status border and text, a zero free count, "Required" markers.
- **Red Wash** (red-tint): Faulty cell ground under a light red hatch.

### Neutral
- **Asphalt** (asphalt): the top bar, the mobile action bar, and the In use status fill.
- **Asphalt Raised** (asphalt-2): nav hover and the avatar on the dark shell.
- **On-Asphalt** (on-dark) / **On-Asphalt Muted** (on-dark-2): active and resting text on the shell.
- **Concrete** (ground): the page ground.
- **Panel White** (panel) / **Panel Off-White** (panel-2): panel surfaces; panel-2 for table heads, row hover, and the count-only table row.
- **Ink** (ink), **Ink Secondary** (ink-2), **Ink Tertiary** (ink-3): primary text, supporting text, then placeholders, operators and units. All three pass 4.5:1 on white and on panel-2.
- **Hairline** (line) / **Inner Hairline** (line-2): panel borders, then dividers inside panels.
- **Field Stroke** (field-stroke): borders on inputs and secondary buttons. This is the lightest grey that holds 3:1 against white.

### Named Rules
**The Colour Has a Job Rule.** Each saturated colour means one thing. Blue is Reserved (and focus), yellow is Requested or "needs a look", red is Faulty or blocked, ink fill is In use. Never use them as decoration.

**The Green Means Go Rule.** Saturated green appears only where something can be done (Available, Chosen, Reserve, current selection) or as an identity plate (span sign, site-code plates, brand mark).

**The Never Colour Alone Rule.** Every status carries a symbol and a text label next to its fill. Requested and Faulty also carry a hatch pattern.

## Typography

**Display Font:** Barlow Semi Condensed (with Barlow, system-ui)
**Body Font:** Barlow (with system-ui, sans-serif)

**Character:** A single road-sign grotesk family. The semi-condensed cut is reserved for sign plates and the wordmark. Barlow does all the other work, with tabular numerals set on body.

### Hierarchy
- **Display** (600, 44px, line-height 1, +0.02em, semi-condensed): site codes on the sign plate. The km figure uses 40px with a 22px unit. Drops to 30px / 28px below 640px.
- **Headline** (600, 28px, line-height 1): terms of the capacity equation. The result term goes to 44px / 700 in deep green and drops to 34px on mobile.
- **Title** (600, 17px, line-height 1.2): panel headings. The span-list heading and span names use 15px / 600.
- **Body** (400, 15px, line-height 1.45, tabular): default text. Tables use 14px.
- **Body Small** (500, 13px): hints, supporting lines, legend, crumbs, meta.
- **Label** (600, 12px, +0.05em, uppercase): table column heads, tube labels (13px, +0.04em), the "free" unit under counts, and the free-to-reserve caption.
- **Micro** (600, 11px): status text inside core cells. This is the floor; nothing goes smaller.

### Named Rules
**The Tabular Everything Rule.** All numbers are tabular (`font-variant-numeric: tabular-nums` on body). Identifiers are never truncated.

**The Semi-Condensed Is Signage Rule.** Barlow Semi Condensed appears only on sign plates and the wordmark.

## Layout

Three columns: 272px span list, a fluid centre (min 0), and a 360px side rail. The gap is 20px, with 20px 24px 40px padding inside a 1600px max width, aligned to the top. The centre and side rail stack their panels at a 16px gap. Panel interiors pad 14px on top and 20px at the sides (18px in the side rail). The core grid is fixed at 12 equal columns per tube row with a 6px gap and a 64px tube label column.

- **At 1240px and below:** a 240px list plus the centre. The side rail moves under the centre as two columns.
- **At 900px and below:** one column. The nav wraps to a full-width scrolling row with 44px targets. The content order becomes crumbs, sign, capacity, cores, side, holdings, span list. A fixed asphalt action bar ("Review and reserve") appears and hides once the Reserve form is in view.
- **At 640px and below:** padding tightens to 16px. Tube rows keep 12 cells and scroll sideways (min 572px, 4px gap) with a hint. The table turns into stacked rows with the core number pinned left.

## Elevation & Depth

Flat by default. Depth comes from tone (white panels on concrete ground) and 1px hairlines. There is exactly one soft lift: the Reserve panel, together with its green border, marks where the job ends. The sign plate uses an inset white border line rather than a shadow.

### Shadow Vocabulary
- **Reserve lift** (`box-shadow: 0 1px 2px rgba(0,40,25,.06), 0 6px 18px -8px rgba(0,60,40,.18)`): the Reserve panel only.
- **Chosen ring** (`box-shadow: 0 0 0 2px #fff, 0 0 0 4px var(--green)`): a double ring on a chosen core cell. This is a state marker, not elevation.
- **Plate inset** (`box-shadow: inset 0 0 0 1px var(--green), inset 0 0 0 2px #fff`): the white inner border on small site-code plates and the brand mark (3.5px on the mark).

### Named Rules
**The One Lift Rule.** Only the panel where the user commits an action is lifted. Everything else stays flat on hairlines.

## Shapes

Gently squared, sign-like corners: 10px on the sign plate, 7px on its white inset frame, 6px on panels, 5px on controls and core cells, 4px on pills, swatches and the route shield, and 3px on small site-code plates. Only count badges (10px on 20px) and the avatar are fully round. Borders are 1px hairlines on panels, 1.5px on status cells and pills, and 2.5px for the sign's white inset. A dashed outline means "no cells": count-only holds and the not-surveyed note.

## Components

### Buttons
- **Shape:** gently squared (5px), 42px tall (44px in the mobile bar), 1.5px border.
- **Primary:** green fill, white 15px / 600 text, 0 16px padding, fills the row. Its label states the count ("Reserve 1 core").
- **Hover / Focus:** hover goes to deep green, active nudges down 1px, focus shows a 3px blue outline at 2px offset. Disabled is a grey fill (#c9d0cb) with ink-2 text.
- **Secondary:** white with a field-stroke border and ink text. Hover goes to panel-2.

### Chips
- **Chosen core chip:** green fill, white 14px / 600 text, 30px tall, with a 22px remove button that turns deep green on hover.
- **Status pill:** 12px / 600 text, 12px symbol, 4px radius. Fills match the core-cell vocabulary. "Not assigned" uses a white fill with a dashed ink-3 border.
- **Count badge:** yellow fill with ink 12px / 700 text, 20px round.

### Cards / Containers
- **Corner Style:** 6px.
- **Background:** white on concrete.
- **Shadow Strategy:** none except the Reserve lift (see Elevation).
- **Border:** 1px hairline. Inner dividers use the inner hairline. The Reserve panel has a green border.
- **Internal Padding:** 14px top, 18 to 20px sides.

### Inputs / Fields
- **Style:** white, 1px field-stroke border, 5px radius, 40px tall (36px in the span-list filter), 0 10px padding. Labels sit above in 13px / 600 with a red "Required" tag.
- **Focus:** 3px blue outline. Search fields with icons use the same ring via focus-within.
- **Hover:** the border darkens to ink-3.

### Navigation
- **Top bar:** asphalt, 56px. Wordmark in semi-condensed 19px beside the green plate mark. Links in 500 on-dark-2. Hover goes to white on asphalt-2. The current link is white 600 with a 3px green underline. Below 900px it becomes a full-width horizontal scroll row.
- **Span list:** span name on the left, free count right-aligned with an uppercase "free" unit underneath, like sign km. The current span is a green plate. A zero count shows in red with "full". Not-surveyed spans say so in muted text.

### Span Sign Plate (signature)
A green plate with 5px padding and a 2.5px white inset frame (7px radius) holding two site codes joined by a white bar (34 by 4px), the km figure right-aligned, and a meta row under a 35% white rule. A white "shield" tag carries the route group. Small site-code plates in route rows reuse the same plate-and-inset language.

### Capacity Equation (signature)
A row of terms: Available − held, not assigned = Free to reserve. Operators in ink-3, the result in 44px / 700 deep green, and a side column of secondary counts behind a hairline. Capacity is always shown as arithmetic that adds up, never as a lone metric.

### Core Cell (signature)
A real button, 58px tall in a 12-column tube row, holding the core number (16px / 600), a 14px stroked symbol, and an 11px status label. The vocabulary: Available (white, green border, open circle), Chosen (green fill, check, double ring), Requested (yellow wash with a 135° yellow hatch, clock), Reserved (blue, lock), In use (asphalt, pulse), Faulty (red wash with a 45° red hatch, cross). Only Available and Chosen are pressable. The others carry aria-disabled and a not-allowed cursor. Hovering or focusing a cell writes its details to a single inspector line under the grid. Transitions run 0.16s ease-out on colour and shadow, only when motion is allowed.

## Do's and Don'ts

### Do:
- **Do** show every status as fill + symbol + text label, with a hatch for Requested and Faulty.
- **Do** keep tube rows at 12 cells and let them scroll sideways on small screens rather than reflowing.
- **Do** set every number in tabular figures and right-align counts like sign distances.
- **Do** present capacity as an equation whose terms add up.
- **Do** use the 3px blue focus outline (2px offset) on every interactive element.
- **Do** keep text at 11px or larger and at 4.5:1 or better. Control borders use field-stroke (3:1 on white).

### Don't:
- **Don't** use saturated green for decoration. It means "can act" or "identity plate".
- **Don't** reuse blue, yellow or red for anything outside their status meanings (blue also serves as focus).
- **Don't** add shadows to panels other than the Reserve panel.
- **Don't** introduce a second type family. Barlow Semi Condensed stays on sign plates and the wordmark.
- **Don't** draw cells for un-surveyed cores. State their count instead.
