# Trexure — Logo Image-Generation Prompts

> Symbol-only marks (no text), designed to be instantly recognizable at any size
> from a 16px favicon to a hero banner.

## Sourcing note

There is **no `BRAND.md`** in this repository. These prompts are grounded in the
two brand sources that *do* exist:

- **`SPEC.md` §4** — visual direction: *"serious fintech (Stripe Dashboard /
  Mercury bank), not crypto. Restrained neutral palette + one accent, monospace
  only for hashes/JSON."*
- **`app/globals.css`** — the live design tokens:

| Token | Hex | Role |
|---|---|---|
| `--color-primary` | `#8E44AD` | Violet — primary brand |
| `--color-accent` | `#D4AF37` | Gold — the single accent |
| `--color-on-surface` / ink | `#1A1025` | Deep aubergine-black |
| `--color-background` | `#F7F9FB` | Off-white |

_If a `BRAND.md` is later added, reconcile these prompts against it._

---

## Symbol concept

**A shield whose interior is two converging streams that meet at one point.**

The mark fuses the three ideas at the heart of the product:

1. **Shield** — the ZK privacy layer (a shielded payment is opaque on the public
   ledger).
2. **Two paths merging into one** — reconciliation: the on-chain leg and the
   off-chain fiat leg settling into a single verified truth.
3. **A keyhole / notch in the negative space** at the convergence point — the
   tenant's view key that unlocks the shielded payload. The same notch reads as a
   subtle **"T"** for Trexure.

Geometry is precise, balanced, and mathematical (an homage to the Groth16 /
BLS12-381 cryptography underneath) — flat, minimal, no gradients unless stated,
no literal coins, locks, or blockchain cubes. Think Stripe/Mercury restraint, not
web3 maximalism.

**Shared directives for every variant** (paste into each prompt):

> Minimalist flat vector logo icon, single geometric symbol, no text, no
> lettering, no wordmark. A rounded-corner heraldic shield silhouette; inside it,
> two clean ribbon-like streams sweep down from the top-left and top-right and
> converge to a single point at the lower center, forming a stylized upward "T" /
> arrow at their meeting point, with a small keyhole notch cut from the negative
> space at the convergence. Perfectly symmetrical, balanced, mathematically
> precise. Centered composition, generous padding, works as an app icon and at
> 16px favicon size. Crisp edges, solid shapes, high contrast, scalable SVG-style
> vector, no photorealism, no 3D bevel, no drop shadow, no gradient mesh, plain
> background.

---

## Output 1 — Colored (primary mark)

**Prompt:**

> Minimalist flat vector logo icon, symbol only, absolutely no text or letters.
> A rounded heraldic shield containing two ribbon streams that converge to a
> single point at the lower center, forming a subtle upward "T"/arrow with a small
> keyhole notch in the negative space where they meet. Color palette strictly:
> deep aubergine-black shield body (#1A1025) with the two converging streams in
> royal violet (#8E44AD), and the keyhole/convergence accent picked out in metallic
> gold (#D4AF37). One violet, one gold accent only — restrained institutional
> fintech style (Stripe/Mercury), not crypto. Flat design, clean geometry,
> perfectly symmetrical, centered, on a plain off-white (#F7F9FB) background.
> Crisp vector edges, no gradients, no 3D, no shadow, app-icon-ready, legible at
> 16px.

- **Foreground:** shield `#1A1025`, streams `#8E44AD`, keyhole/accent `#D4AF37`
- **Background:** `#F7F9FB` (also export a transparent-background version)

---

## Output 2 — White-only on dark (silhouette)

**Prompt:**

> Minimalist flat vector logo icon, symbol only, absolutely no text or letters.
> The same shield with two streams converging to a single point and a keyhole
> notch in the negative space. Render as a solid pure-white (#FFFFFF) silhouette —
> one flat shape, no interior color, no shading, no outline — sitting on a deep
> aubergine-black (#1A1025) background. The design must remain fully readable using
> only the white positive shapes and the dark negative space between the two
> streams and inside the keyhole. Perfectly symmetrical, centered, high contrast,
> crisp vector edges, no gradient, no 3D, no shadow, app-icon-ready, legible at
> 16px.

- **Foreground:** `#FFFFFF` (single flat color)
- **Background:** `#1A1025` (dark)

---

## Output 3 — Dark on white (silhouette)

**Prompt:**

> Minimalist flat vector logo icon, symbol only, absolutely no text or letters.
> The same shield with two streams converging to a single point and a keyhole
> notch in the negative space. Render as a solid single-color dark silhouette in
> deep aubergine-black (#1A1025) — one flat shape, no interior color, no shading,
> no outline — sitting on a pure-white (#FFFFFF) background. The design must remain
> fully readable using only the dark positive shapes and the white negative space
> between the two streams and inside the keyhole. Perfectly symmetrical, centered,
> high contrast, crisp vector edges, no gradient, no 3D, no shadow, app-icon-ready,
> legible at 16px.

- **Foreground:** `#1A1025` (single flat color)
- **Background:** `#FFFFFF` (light)

---

## Consistency checklist (all three outputs)

- [ ] Identical silhouette across all three — only color/fill changes.
- [ ] No text, wordmark, or lettering of any kind.
- [ ] Reads clearly at 16px (favicon) and as a monochrome silhouette.
- [ ] Negative-space keyhole + convergence "T" survives the silhouette reduction.
- [ ] Palette limited to violet `#8E44AD` + gold `#D4AF37` + ink `#1A1025` + off-white `#F7F9FB`.
- [ ] Flat vector — no gradients, 3D, bevels, or shadows.
- [ ] Export each with a transparent-background variant for flexible placement.
