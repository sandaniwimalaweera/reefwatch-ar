# Development Challenges and Solutions

This log feeds the compulsory challenges section of the technical report,
which is worth 5 of the 25 marks.

Write an entry the moment a problem happens — not from memory later. Include
real numbers wherever you can measure something.

---

## Template — copy this for each new entry

## Challenge N: [Short title]

**Date:**

**Symptom:** What actually went wrong, exactly what I saw on screen.

**Cause:** Why it happened, once I worked it out.

**What I tried that failed:** Dead ends. Worth writing — they show real
engineering rather than a lucky first guess.

**Solution:** The exact fix. Code, settings, numbers.

**Result:** Measured improvement where possible.

---

## Challenge 1: *(your first real bug goes here)*

**Date:**

**Symptom:**

**Cause:**

**What I tried that failed:**

**Solution:**

**Result:**

---

# Asset optimisation record

Fill this in on day 2. These numbers are direct evidence for the
"appropriately optimized for web delivery" requirement.

| Model | Original size | Original tris | Final size | Final tris | Technique |
|---|---|---|---|---|---|
| coral.glb | 87 KB (unpacked glTF + bin + textures) | — | 225 KB | — | GLB bundling + Draco compression |
| reef.glb | (check raw folder size) | — | 433 KB | — | GLB bundling + Draco compression |

Note: both GLB files are larger than the raw `.bin` mesh data because the GLB
bundles mesh, materials and textures into a single binary. This trades a small
size increase for one HTTP request instead of several, which loads faster on
mobile data. Both models are well under the 2 MB target.