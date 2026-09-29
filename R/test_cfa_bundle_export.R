source("R/cfa_bundle_export.R")
model <- 'visual =~ x1 + x2 + x3
          textual =~ x4 + x5 + x6'
dat <- lavaan::HolzingerSwineford1939
fit <- lavaan::cfa(model, data = dat, estimator = "MLR", std.lv = TRUE)
ordinal <- dat
for (x in paste0("x", 1:6)) ordinal[[x]] <- as.integer(cut(dat[[x]], 4))
ord <- lavaan::cfa(model, data = ordinal, ordered = paste0("x", 1:6),
  estimator = "WLSMV", std.lv = TRUE)
dat$test_weight <- seq(0.8, 1.2, length.out = nrow(dat))
weighted <- lavaan::cfa(model, data = dat, estimator = "MLR", sampling.weights = "test_weight")
fits <- list(example = ord, example_ml = fit, example_ml_wt = weighted)
omega <- omega_variants(fits)
ave <- lapply(fits, semTools::AVE)
fl <- matrix(c("", "TRUE", "", ""), 2, dimnames = list(c("visual", "textual"), c("visual", "textual")))
htmt <- list(example_ml = semTools::htmt(model, data = dat))
folder <- tempfile("cfa-export-test-")
dir.create(folder)
b <- export_cfa_bundle(fits, folder, "example", model_syntax = model,
  omega = omega, ave = ave, htmt = htmt, fornell_larcker = list(example = noquote(fl)), htmt_method = "HTMT2")
out <- jsonlite::read_json(file.path(folder, "example.json"), simplifyVector = FALSE)
stopifnot(length(out$variants) == 3,
  out$variants[[1]]$supplementary$htmt$status == "not_supplied",
  out$variants[[2]]$supplementary$htmt$status == "ok",
  out$variants[[1]]$latent_correlations$kind == "matrix",
  out$variants[[1]]$supplementary$fornell_larcker$data$values[[2]][[1]] == "TRUE",
  out$variants[[1]]$metadata$data_treatment == "Ordinal",
  out$variants[[2]]$metadata$data_treatment == "Continuous",
  length(out$variants[[2]]$standardized_solution) > 0,
  out$variants[[2]]$diagnostics$residuals$status == "ok",
  out$variants[[3]]$metadata$sampling_weight_variable == "test_weight")
stopifnot(inherits(try(export_cfa_bundle(fits, folder, "bad", ave = list(wrong = 1)), silent = TRUE), "try-error"))
stopifnot(inherits(try(export_cfa_bundle(fits, folder, "example"), silent = TRUE), "try-error"))
single <- export_cfa_bundle(fit, folder, "single")
stopifnot(length(single$variants) == 1)
groupfit <- lavaan::cfa(model, data = dat, group = "school")
group <- export_cfa_bundle(list(groups = groupfit), folder, "groups")
stopifnot(length(group$variants[[1]]$latent_correlations) == 2)
unlink(folder, recursive = TRUE)
cat("CFA bundle tests passed.\n")
