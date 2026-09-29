# Standalone CFA bundle exporter. Does not change export_lavaan_results().
# Dependencies: lavaan, jsonlite; semTools for omega_variants().

.cfa_names <- function(x, label) {
  n <- names(x)
  if (is.null(n) || anyNA(n) || any(!nzchar(n)) || anyDuplicated(n))
    stop(label, " must have unique, nonempty names.", call. = FALSE)
  invisible(x)
}

.cfa_fits <- function(fits, name = NULL) {
  if (inherits(fits, "lavaan")) {
    if (is.null(name)) stop("Wrap a single fit in a named list: list(U1a = fit).")
    fits <- setNames(list(fits), name)
  }
  if (!is.list(fits) || !length(fits)) stop("Supply a nonempty named list of fits.")
  .cfa_names(fits, "fits")
  if (!all(vapply(fits, inherits, logical(1), what = "lavaan")))
    stop("Every entry in fits must be a fitted lavaan object.")
  fits
}

.cfa_capture <- function(expr) {
  warnings <- character()
  error <- NULL
  value <- tryCatch(withCallingHandlers(expr, warning = function(w) {
    warnings <<- c(warnings, conditionMessage(w))
    invokeRestart("muffleWarning")
  }), error = function(e) { error <<- conditionMessage(e); NULL })
  list(status = if (!is.null(error)) "error" else if (is.null(value) || !length(value))
    "unavailable" else "ok", value = value, warnings = unique(warnings), error = error)
}

# Preserve matrix axes and named vectors explicitly, including one-row matrices.
# Recursion preserves group/level structure instead of flattening it away.
.cfa_json_value <- function(x) {
  if (is.null(x)) return(NULL)
  if (is.matrix(x)) return(list(
    kind = "matrix", row_names = unname(as.list(rownames(x))),
    column_names = unname(as.list(colnames(x))),
    values = unname(lapply(seq_len(nrow(x)), function(i) unname(as.list(x[i, ]))))))
  if (is.data.frame(x)) {
    rows <- lapply(seq_len(nrow(x)), function(i) lapply(x, function(col) col[[i]]))
    return(list(kind = "table", row_names = unname(as.list(rownames(x))), rows = rows))
  }
  if (is.list(x)) return(lapply(x, .cfa_json_value))
  if (is.atomic(x) && !is.null(names(x))) return(list(
    kind = "named_values", entries = unname(lapply(seq_along(x), function(i)
      list(name = names(x)[i], value = unname(x[[i]]))))))
  if (is.atomic(x)) return(unname(x))
  stop("Unsupported supplementary result type: ", paste(class(x), collapse = "/"))
}

# Returns ordinary semTools outputs at omega[[variant_name]]. Diagnostics and
# calculation settings are retained as attributes for the exporter.
omega_variants <- function(fits, ord.scale = TRUE, obs.var = TRUE) {
  if (!requireNamespace("semTools", quietly = TRUE)) stop("Install semTools first.")
  fits <- .cfa_fits(fits)
  captured <- lapply(fits, function(fit) .cfa_capture(
    semTools::compRelSEM(fit, tau.eq = FALSE, ord.scale = ord.scale, obs.var = obs.var)))
  out <- lapply(captured, `[[`, "value")
  attr(out, "diagnostics") <- lapply(captured, function(x) x[c("status", "warnings", "error")])
  attr(out, "settings") <- list(tau.eq = FALSE, ord.scale = ord.scale,
    obs.var = obs.var, semTools_version = as.character(utils::packageVersion("semTools")))
  failed <- names(captured)[vapply(captured, function(x) x$status != "ok", logical(1))]
  if (length(failed)) warning("Omega unavailable for: ", paste(failed, collapse = ", "),
    ". See attr(result, 'diagnostics').", call. = FALSE)
  out
}

.cfa_sections <- function(p) {
  if (is.null(p)) return(NULL)
  p$section <- "other"
  ops <- c("=~" = "loading", "~" = "regression", "~1" = "intercept",
    "|" = "threshold", "~*~" = "scaling_factor", ":=" = "defined")
  for (op in names(ops)) p$section[p$op == op] <- ops[[op]]
  p$section[p$op == "~~"] <- "covariance"
  p$section[p$op == "~~" & p$lhs == p$rhs] <- "variance"
  p
}

# Optional supplementary inputs must be named lists keyed by fit name.
# Missing variants are allowed; unknown/duplicate names are rejected.
export_cfa_bundle <- function(fits, folder, name, model_syntax = NULL,
    omega = NULL, ave = NULL, fornell_larcker = NULL, htmt = NULL,
    model_title = name, variant_labels = NULL, variant_metadata = NULL,
    htmt_method = "unspecified", overwrite = FALSE) {
  for (pkg in c("lavaan", "jsonlite"))
    if (!requireNamespace(pkg, quietly = TRUE)) stop("Install ", pkg, " first.")
  if (length(name) != 1L || is.na(name) || !grepl("^[A-Za-z0-9][A-Za-z0-9._-]*$", name))
    stop("name must be a safe model ID using letters, digits, dots, underscores or hyphens.")
  fits <- .cfa_fits(fits, name)
  supplements <- list(omega = omega, ave = ave, fornell_larcker = fornell_larcker, htmt = htmt)
  for (key in names(supplements)) {
    x <- supplements[[key]]
    if (is.null(x)) next
    if (!is.list(x) || is.data.frame(x)) stop(key, " must be a named list keyed by variant.")
    .cfa_names(x, key)
    unknown <- setdiff(names(x), names(fits))
    if (length(unknown)) stop(key, " has unknown variants: ", paste(unknown, collapse = ", "))
  }
  for (x in list(variant_labels, variant_metadata)) if (!is.null(x)) {
    .cfa_names(x, "Variant labels/metadata")
    if (length(setdiff(names(x), names(fits)))) stop("Unknown variant in labels/metadata.")
  }
  htmt_method <- match.arg(htmt_method, c("unspecified", "HTMT", "HTMT2"))
  if (!is.null(model_syntax) && (!is.character(model_syntax) || anyNA(model_syntax)))
    stop("model_syntax must be a character string or NULL.")

  variants <- lapply(names(fits), function(id) {
    fit <- fits[[id]]
    diagnostics <- list()
    get <- function(key, expr) {
      result <- .cfa_capture(expr)
      diagnostics[[key]] <<- result[c("status", "warnings", "error")]
      result$value
    }
    inspect <- function(what) get(what, lavaan::lavInspect(fit, what))
    opt <- inspect("options")
    ordered <- get("ordered_variables", lavaan::lavNames(fit, type = "ov.ord"))
    observed <- get("observed_variables", lavaan::lavNames(fit, type = "ov"))
    treatment <- if (is.null(ordered)) NULL else if (!length(ordered)) "Continuous"
      else if (setequal(ordered, observed)) "Ordinal" else "Mixed"
    metadata <- list(model_id = name, variant_id = id, model_name = model_title,
      lavaan_version = as.character(utils::packageVersion("lavaan")),
      estimator = opt$estimator, estimator_requested = opt$estimator.orig,
      estimator_actual = opt$estimator, data_treatment = treatment,
      observed_variables = unname(as.list(observed)),
      ordered_variables = unname(as.list(ordered)), number_ordered_variables = length(ordered),
      converged = inspect("converged"), post_check = inspect("post.check"),
      number_parameters = inspect("npar"), number_groups = inspect("ngroups"),
      sampling_weight_variable = get("sampling_weights", fit@Data@sampling.weights))
    fields <- c(se_method = "se", test = "test", information = "information",
      h1_information = "h1.information", likelihood = "likelihood", link = "link",
      missing = "missing", parameterization = "parameterization", std_lv = "std.lv",
      meanstructure = "meanstructure", fixed_x = "fixed.x", auto_var = "auto.var",
      auto_cov_lv_x = "auto.cov.lv.x", auto_cov_y = "auto.cov.y", mimic = "mimic",
      representation = "representation", sampling_weights_normalization = "sampling.weights.normalization")
    for (key in names(fields)) metadata[key] <- list(opt[[fields[[key]]]])
    metadata$user_supplied <- variant_metadata[[id]]
    groups <- inspect("group.label")
    nobs <- inspect("nobs")
    sample_size <- if (length(nobs)) data.frame(group = if (length(groups) == length(nobs))
      groups else as.character(seq_along(nobs)), n = as.integer(nobs)) else NULL
    fm <- get("fit_measures", lavaan::fitMeasures(fit))
    parameters <- get("parameters", .cfa_sections(lavaan::parameterEstimates(fit,
      standardized = TRUE, ci = TRUE)))
    extra <- lapply(names(supplements), function(key) {
      x <- supplements[[key]]
      if (is.null(x) || !id %in% names(x)) return(list(status = "not_supplied", data = NULL))
      encoded <- .cfa_capture(.cfa_json_value(x[[id]]))
      diagnostic <- attr(x, "diagnostics")[[id]]
      list(status = if (encoded$status == "ok" && !is.null(diagnostic)) diagnostic$status else encoded$status,
        data = encoded$value, warnings = c(encoded$warnings, diagnostic$warnings),
        error = if (!is.null(encoded$error)) encoded$error else diagnostic$error,
        settings = attr(x, "settings"))
    })
    names(extra) <- names(supplements)
    extra$htmt$method <- htmt_method
    extra$fornell_larcker$criterion <- "Both AVEs must exceed the squared latent correlation."
    result <- list(id = id, label = if (id %in% names(variant_labels)) variant_labels[[id]] else id,
      metadata = metadata, model_syntax = if (is.null(model_syntax)) NULL else paste(model_syntax, collapse = "\n"),
      sample_size = sample_size,
      missing_patterns = .cfa_json_value(get("missing_patterns", lavaan::lavInspect(fit, "patterns"))),
      fit_measures = if (length(fm)) data.frame(measure = names(fm), value = as.numeric(fm)) else NULL,
      parameters = parameters,
      factor_indicators = if (is.null(parameters)) NULL else unique(parameters[
        parameters$op == "=~", intersect(c("lhs", "rhs", "group", "level"), names(parameters)), drop = FALSE]),
      r_squared = .cfa_json_value(inspect("r2")),
      modification_indices = get("modification_indices", lavaan::modificationIndices(fit, sort. = TRUE)),
      latent_correlations = .cfa_json_value(inspect("cor.lv")),
      residuals = .cfa_json_value(get("residuals", lavaan::lavResiduals(fit))),
      standardized_solution = get("standardized_solution", .cfa_sections(lavaan::standardizedSolution(
        fit, type = "std.all", se = TRUE, zstat = TRUE, pvalue = TRUE, ci = TRUE))),
      supplementary = extra)
    result$diagnostics <- diagnostics
    result
  })
  bundle <- list(schema_version = "cfa-bundle-1.0", kind = "cfa_bundle",
    metadata = list(model_id = name, model_name = model_title,
      exported_at = format(Sys.time(), "%Y-%m-%dT%H:%M:%S%z")),
    image = paste0("models/", name, ".svg"), default_variant = names(fits)[1], variants = variants)
  dir.create(folder, recursive = TRUE, showWarnings = FALSE)
  path <- file.path(folder, paste0(name, ".json"))
  if (file.exists(path) && !isTRUE(overwrite)) stop("File exists: ", path, ". Use overwrite = TRUE to replace it.")
  # Serialize before touching the destination; verify JSON in a temporary file.
  tmp <- tempfile("cfa-bundle-", tmpdir = folder, fileext = ".json")
  on.exit(unlink(tmp), add = TRUE)
  jsonlite::write_json(bundle, tmp, pretty = TRUE, auto_unbox = TRUE,
    dataframe = "rows", null = "null", na = "null", digits = 15)
  if (!jsonlite::validate(paste(readLines(tmp, warn = FALSE), collapse = "\n"))) stop("Invalid JSON generated.")
  if (!file.copy(tmp, path, overwrite = overwrite)) stop("Could not write ", path)
  message("Exported ", length(variants), " CFA variant(s): ", normalizePath(path, winslash = "/"))
  problems <- unlist(lapply(variants, function(v) {
    entries <- c(v$diagnostics, v$supplementary)
    bad <- names(entries)[vapply(entries, function(x) identical(x$status, "error") ||
      length(x$warnings) > 0L, logical(1))]
    if (length(bad)) paste0(v$id, ": ", bad) else character()
  }))
  if (length(problems)) warning("Export completed with diagnostics: ",
    paste(problems, collapse = "; "), ". Inspect the returned bundle for details.", call. = FALSE)
  invisible(bundle)
}
