# CFA results and estimation variants

## Matrix display and colors

Below each matrix, expand **Matrix display & colors**. Square matrices with
matching axes default to the lower triangle; select Upper to switch. Lower-only
Fornell–Larcker exports are mirrored for display. Rectangular tables stay full.
Numeric color rules match absolute values while keeping the displayed signs.
Correlation/HTMT defaults are [0,.2), [.2,.4), [.4,.6), [.6,.8), [.8,1).
Residual defaults split the finite off-diagonal absolute minimum and maximum
into five equal-width bands, including the maximum in the last band. Constant
tables use a single band. **Show defaults** / **Generate default ranges** restores
these editable rules; **Clear colors** removes coloring without changing the
triangle. Saved custom styles are preserved until you choose defaults.
Numeric color rules use inclusive minimums and normally exclusive maximums;
each rule has an editable Include upper bound checkbox. Incomplete
or reversed ranges are ignored with a message; overlapping ranges use the first
matching rule and show that precedence in the legend. Diagonals remain uncolored.
Pass/Fail matrices have separate color pickers. Text contrast adjusts automatically.

The legend stays visible when controls are collapsed, ready for screenshots.
Settings are per page, per model, and per matrix path (including group/level),
shared across estimation variants and single/comparison result windows. Save the
workspace to retain them in the workspace file; local recovery and undo/redo
also include these settings. Defaults and Clear colors affect only that matrix.

The frontend accepts existing single-result JSONs and `cfa-bundle-1.0` files.
Use one SVG and one JSON with matching filename stems in `web/models` and
`web/results`. Refresh the library after re-exporting a bundle.

U1a's exported bundle is installed at `web/results/U1a.json`. Its previous
single-fit file is backed up at `R/exported_cfa/U1a.before-bundle.json`.
The original staged export remains at `R/exported_cfa/U1a.json`.

Right-click a model and choose its estimation variant, or use the dropdown in
its results window. Selections are saved per page and participate in undo/redo.
Model notes, arrows, geometry, and manual stacks still belong to the diagram;
changing the fit does not change those objects. A bundle with one fit needs no
selector. Existing single-fit files need no conversion.

The new tabs are conditional on available data:

- Reliability & AVE: factor-aligned omega, AVE, and indicator counts.
- Latent correlations: labeled matrices, with group/level nesting preserved.
- Discriminant validity: HTMT/HTMT2 and Fornell–Larcker checks. Weighted fits
  without supplied HTMT show unavailable; blank FL triangles stay blank.
- Residuals: expandable matrix and summary sections from lavResiduals.
- Standardized solution: est.std estimates with their own uncertainty estimates.

Add the selected fit through the context menu, or search the comparison queue,
which lists every fit separately. Comparison identities include model and
variant IDs, so switching the displayed variant does not change queued fits.
Reliability comparisons align factors; standardized comparisons align parameter
rows and use the existing column and grouping controls. Matrix/residual
comparisons show separately labeled sections for each selected fit.

Overview exposes post-estimation checks, sampling-weight variable, and extraction
diagnostics. Unsupported values remain absent or unavailable. Source warnings
do not become automatic pass/fail judgments. Notes are shared among variants on
one page and remain isolated from other pages.

Validation: `npm run build`, `npm run lint`, `node --test tests/*.test.mjs`.
`node tests/preview-cfa.mjs` starts an isolated browser QA origin on port 5195;
it uses test page state, not the saved workspace file.
