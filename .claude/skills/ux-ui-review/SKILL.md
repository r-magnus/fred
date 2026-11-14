---
name: ux-ui-review
description: Audit and clean up Fred's mobile UX/UI against researched best practices (touch targets, text size, contrast, stress and outdoor use, AI-answer trust, navigation, states and feedback, accessibility). Use when asked to review, polish or redesign any screen in apps/mobile, before merging a UI change, or when a screen "feels off".
---

# UX/UI review for Fred

Fred is read **outdoors, one-handed, often stressed or hurt, sometimes in
gloves, in bright sun or a dark tent, offline, on a low battery.** Generic
app advice is the floor; these conditions raise it. Every rule below says
where it comes from, so a finding can be argued with.

## How to run a review

1. **Inventory.** List every screen and state in scope: empty chat, a written
   answer, a card answer, a decline, an error, needs-location, clarify
   buttons, the map, the side menu, About, setup, loading, a failed load.
   States are where most problems hide (see section 6).
2. **Measure, don't eyeball.** Read the styles. Work out each tappable area
   (size + padding + hitSlop) and each text size. Run the contrast checker on
   every text/background pair actually used:
   `python3 -I .claude/skills/ux-ui-review/contrast.py apps/mobile/src/theme.tsx`
3. **Check each rule** in sections 1-8 against each screen. Record findings in
   a table: screen · rule · what's wrong (with the number) · severity · fix.
   Severity: **S1** could cost someone in an emergency (hidden safety info,
   unreadable warning, dead end); **S2** slows or confuses (small target,
   jargon, missing feedback); **S3** polish.
4. **Fix S1 and S2 first.** Keep changes inside the app's look (theme.tsx
   palette, `radius`, the journal face for the hiker's words): the review
   cleans up, it doesn't restyle.
5. **Verify.** `npm test` and `npm run typecheck`, then look at it on a phone,
   in day and night colours, at the largest system font size. Write the audit
   to `docs/ux-audit-<date>.md`.

## 1. Touch targets

- **At least 48 x 48 dp** for anything tappable (Material Design; Android
  accessibility). Apple's floor is 44 x 44 pt; WCAG 2.2 AA is 24 px with
  spacing, AAA 44 px. Use 48: it satisfies all of them, and fingers in
  gloves or shaking hands need more, not less.
- **At least 8 dp between targets** (Material).
- A small visual is fine: make the *target* big with padding, `minHeight`,
  or `hitSlop`. Text links inside a sentence ("Open article") are the
  classic miss: give them their own row or a `hitSlop`.
- The main action sits where the thumb already is (bottom of the screen).

## 2. Text

- **Body 16 sp, never below 13 sp for anything a person must read** (sources,
  disclaimers, hints). Below 12 sp only for decoration. Small, faint text
  disappears first in sunlight.
- Line height about 1.4-1.5x for body text.
- **Respect the system font size.** Don't set `allowFontScaling={false}`;
  avoid fixed heights around text (badges, pills) that clip when text grows.
  Test at the largest setting (iOS Dynamic Type can reach about 200%).
- When swapping a fixed size for `minWidth`/`minHeight` so a shape can grow,
  add `alignSelf: 'flex-start'` inside a row: a row stretches its children
  to its own height, and a round step badge became a long pill (2026-11-14).
- Avoid ALL CAPS for anything longer than a two-word label: it reads slower
  under stress (Robin Camille Davis; NN/g on scannability).
- Plain words. No error codes, model names or internal terms on screen.

## 3. Contrast and colour

- **4.5:1** for text, **3:1** for large text (18 pt, or 14 pt bold) and for
  icons and control edges (WCAG 2.2 1.4.3, 1.4.11).
- **Aim for 7:1 on safety text** (warnings, steps, the disclaimer): WCAG's AAA
  level, and the margin sunlight glare eats. WCAG ignores the viewing
  environment; Fred can't.
- Never colour alone: a warning has words ("Don't…") and a shape (the warning
  block), not just red.
- Check both palettes. Night colours fail differently from day ones.

## 4. Designing for stress (the emergency case is the main case)

From Smashing Magazine's *Designing for Stress and Emergency* (2025) and
NN/g's *Minimize Cognitive Load*:

- Stress narrows attention, cuts reading comprehension and fine motor
  control. So: **one thing at a time**, short scannable chunks, the most
  important action first.
- **Fewer things on screen.** Every repeated label, decoration or always-on
  footer competes with the step that matters.
- **Safe defaults**; the likely or safest choice preselected.
- **Undo instead of "are you sure?"** for destructive actions where possible;
  if a confirm is needed, say what will happen in words.
- **Never a dead end.** Every decline, error and empty state ends with a next
  step the person can take (rephrase, open the card, use location, retry).
- Treat stress cases as core scenarios, not edge cases; test them.

## 5. AI answers and trust

From NN/g's *Explainable AI in Chat Interfaces*:

- Confident presentation earns undeserved trust. Make the **basis** of an
  answer visible: what it came from.
- **Citations visually distinct** from the answer, with descriptive labels
  (the book's name, not "Source 1"), and **the passage itself reachable**,
  not just a page number (also Fred's US-03).
- Don't repeat the same heavy block after every reply: a compact,
  expandable source line keeps the basis visible without crowding the
  steps (Fred #215).
- Disclaimers go **next to the answer**, in plain words, paired with an
  action ("Get medical help if…"), and are introduced during onboarding.
- Neutral wording about what the system did ("From the Army first-aid
  manual"), not human-like claims ("I thought about it").
- Show progress while waiting, naming the step ("Reading the guides…").

## 6. States and feedback

Every screen needs all of these designed, not left to chance:

- **Empty**: what this is for, plus one or two things to try (tappable).
- **Loading**: what's happening, roughly how long. Over ~1 s, show progress.
- **Error**: what went wrong in plain words, what to do next, a retry. The
  raw message only as small print for bug reports.
- **Partial / stopped**: say what happened.
- **Success of an action** (removed, saved, downloaded): brief confirmation,
  with Undo where it applies.

## 7. Navigation

From NN/g's hamburger-menu study (179 participants): hidden navigation is
found about 20% less often and makes tasks feel harder than visible
navigation. On mobile the cost is smaller, and with more than four
destinations a menu is a fair trade.

- Keep **the primary action visible** (Ask). Use the menu for secondary places.
- Inside a menu, **order by use**: the most common action first, then the rest.
- **Don't hide a destination behind a gesture only**: if something opens by
  tapping the logo or swiping, it also needs a labelled entry somewhere.
- The menu closes on back, on a tap outside, and has a visible way out.
- Label each entry in words; an icon is a helper, not the label.
- **Open a menu with a button where people look for one** (a top corner),
  not an edge tab or a drag. On Android a swipe from the screen's edge is
  "back", so anything pulled from the edge fights the system (Fred's
  bookmark tab, replaced in the 2026-11-14 second pass after a UX
  designer's review).

## 7a. Affordance

- Something you can open should look openable: a card with an edge and a
  clear +/− or chevron in its own spot, not a "▸" typed into a sentence.
- Tappable and static text must not look the same. Links get a colour and
  an underline or a button shape.

## 8. Accessibility basics

- Every control: `accessibilityRole` and an `accessibilityLabel` that says
  what it does. Toggles and expanders say their state
  (`accessibilityState={{ expanded }}`).
- Decorative glyphs ("▸", dots, pictures of controls) hidden from screen
  readers, or replaced by a label.
- Reading order follows the visual order; headings marked as headers.
- Motion: anything that moves for decoration respects reduced motion
  (`AccessibilityInfo.isReduceMotionEnabled`).

## Fred-specific don'ts

- Don't change answer wording or card text in a UI pass: words are measured
  separately (docs/results-*.md).
- Don't drop the Wikivoyage credit (article, authors, licence, link) from
  wherever its passages are shown (docs/licensing.md).
- Don't add network calls, analytics or fonts that need downloading: Fred is
  offline.
- Keep the battery line honest: it is a key result (US-13).

## Output

`docs/ux-audit-<date>.md`: the inventory, the findings table, what was fixed
and what was left, and screenshots or notes from the phone check.
