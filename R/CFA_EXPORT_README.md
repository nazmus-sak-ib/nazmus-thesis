# CFA bundle exporter

Source `R/cfa_bundle_export.R`. It defines new functions only and does not call or
change the existing exporter, fitting functions, models.json, or frontend.
Tested with semTools 0.5.9 and locally fitted ordinal, continuous, weighted, and
multi-group CFA models. Required packages: lavaan, semTools, jsonlite.

## Your example

```r
source("D:/Sakib/nazmus-thesis/R/cfa_bundle_export.R")

# Calculate omega from each existing fit; no CFA is refitted.
omega_four <- omega_variants(fit_cfa_U1a_four)
omega_four[["U1a"]]
attr(omega_four, "diagnostics")

# These names must match the corresponding names in fit_cfa_U1a_four.
names(fit_cfa_U1a_four)
names(htmt_two)  # U1a, U1a_ml
names(ave_four)
names(FL_four)

bundle <- export_cfa_bundle(
  fits = fit_cfa_U1a_four,
  folder = "D:/Sakib/nazmus-thesis/R/exported_cfa",
  name = "U1a",
  model_title = "Model U1a",
  model_syntax = model_cfa_U1a,
  omega = omega_four,
  ave = ave_four,
  fornell_larcker = FL_four,
  htmt = htmt_two,
  htmt_method = "HTMT2", # only if you used htmt2 = TRUE (the default)
  variant_labels = c(
    U1a = "WLSMV",
    U1a_wt = "WLSMV · Weighted",
    U1a_ml = "MLR",
    U1a_ml_wt = "MLR · Weighted"
  )
)
```

The initial destination is a staging folder, created automatically. Once the
frontend supports bundles, put `U1a.json` in `web/results/` and its matching
`U1a.svg` in `web/models/`. Only one SVG is needed. Do not overwrite your current
working U1a.json yet: the current frontend does not understand this new schema.
Use a structural diagram without variant-specific numerical estimates for a
shared SVG. The exporter does not create or copy SVGs.

For repeat exports, explicitly add `overwrite = TRUE`. Existing files are
protected by default. The exporter never updates models.json.

## One or fewer variants

Pass any nonempty named subset of fits; omit optional objects or pass matching
subsets. Unknown supplementary variant names are errors. A single lavaan fit is
also accepted and gets the bundle name as its variant ID. For omega calculation,
wrap a single fit in a named list, e.g. `omega_variants(list(U1a = fit))`.

Missing supplementary variants are marked `not_supplied`. To omit a supplied
variant, remove its list entry; NULL entries are recorded as `unavailable`.
Never rename results by position unless you have verified the original mapping.

## Schema and diagnostics

Schema `cfa-bundle-1.0` has root metadata, an SVG reference, a default_variant ID,
and an array of variants. Each variant contains:

- Estimation metadata, sample sizes, supplied syntax, fit measures, parameter
  estimates, factor/indicator mapping, R-squared and modification indices.
- `latent_correlations`, `residuals`, and `standardized_solution` (std.all).
- `supplementary`: omega, AVE, Fornell–Larcker decisions, and HTMT.
- Extraction diagnostics with status, warnings and error messages.

Matrix payloads explicitly preserve row_names, column_names, and row-wise values.
Named numeric vectors use named_values entries. Data frames in nested diagnostic
objects use table payloads; group/level lists retain their nesting. Standard
parameter tables are JSON row arrays. Nonfinite/missing numbers become null;
blank Fornell–Larcker upper-triangle entries remain empty strings, not FALSE.
The exporter preserves supplied Fornell–Larcker decisions without recomputing them.

Optional `variant_metadata` is a named list of per-variant descriptions/settings;
it is kept under metadata$user_supplied, separate from settings extracted from
the fitted object. The original syntax must be supplied: a fit does not reliably
preserve the original R variable's name or verbatim source text.

Inspect `bundle$variants[[1]]$diagnostics` for computation warnings/errors.
Omega diagnostics also remain at `attr(omega_four, "diagnostics")`.
Supplementary calculation failures do not suppress successful fit results.
Nonconverged fits are exported with their convergence status, not presented as
valid by assumption. No raw participant data or individual sampling weights are
exported. The sampling-weight variable name and normalization setting are saved.

The code does not compute alpha, AVE, HTMT, or Fornell–Larcker checks. Supply the
latter three objects you already calculated. Set htmt_method to HTMT, HTMT2, or
unspecified according to the actual calculation; it cannot be inferred from the
matrix alone. Omega uses tau.eq=FALSE, ord.scale=TRUE, obs.var=TRUE by default,
and records those settings and the semTools version.

## Verification

From the repository root run:

```r
source("R/test_cfa_bundle_export.R")
```

The tests fit small example models and write only temporary JSON files. They
check matrix axes, name matching, optional HTMT, weighted metadata, single and
multi-group fits, standardized/residual extraction, and overwrite protection.
