# Licensing register

Every chunk carries a `licenseId` resolving to an entry here, so the app can render
correct attribution per source. **Keep this current — it is the authoritative record
for the project report.**

| id | Source | License | Commercial use |
|---|---|---|---|
| `who-bec` | WHO/ICRC *Basic Emergency Care* (2018) | CC BY-NC-SA 3.0 IGO | ❌ No |
| `who-pfa` | WHO *Psychological First Aid: Guide for Field Workers* | CC BY-NC-SA 3.0 IGO | ❌ No |
| `fm-21-76` | US Army FM 21-76 / FM 21-76-1 *Survival* | Public domain (US Gov work) | ✅ Yes |
| `feis` | USFS *Fire Effects Information System* Species Reviews | Public domain (US Gov work) | ✅ Yes |
| `usda-plants` | USDA PLANTS Database | Public domain (US Gov work) | ✅ Yes |
| `usfws` | US Fish & Wildlife Service species data | Public domain (US Gov work) | ✅ Yes |
| `osm` | OpenStreetMap via Geofabrik extracts | ODbL 1.0 | ✅ With attribution + share-alike |

## Two constraints to act on

**1. The WHO first-aid material is NonCommercial.**
Fine for an academic capstone — the PocketRAG authors relied on the same corpus. But
it forecloses a paid App Store release without WHO permission, and ShareAlike
propagates to derived content. State this explicitly in the report rather than
discovering it at publication time. If commercial release ever matters, the
substitution target is a permissively licensed or self-authored first-aid corpus.

**2. USDA PLANTS gives you checklists, not knowledge.**
"Colorado has ~2,800 vascular plant species" is a *list*. It does not RAG — there is
nothing to retrieve and nothing to ground an answer in. Descriptive prose is what
the pipeline needs: identification, habitat, toxicity, edibility.

Use them in combination:
- **USDA PLANTS / USFWS** → the per-state *filter* (which species belong in this pack)
- **FEIS** → the *text* (~1,100 peer-reviewed Species Reviews, public domain)

FEIS coverage is the highest-risk assumption in the data plan. **Validate coverage
for your pilot states in M1, before committing to those states.** If FEIS is thin for
a chosen state, switch states rather than degrading the corpus.

## ODbL and maps
OpenStreetMap-derived tiles require attribution and carry share-alike obligations on
the derived database. Display the attribution in the map view, not buried in an
About screen.
