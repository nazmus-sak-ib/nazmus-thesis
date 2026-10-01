source('R/export_lavaan_results.R')
library(lavaan)
run_checks <- function() {
  folder <- tempfile('exporter-test-')
  dir.create(folder)
  on.exit(unlink(folder, recursive=TRUE), add=TRUE)
  model <- 'visual =~ x1 + x2 + x3
            textual =~ x4 + x5 + x6
            speed =~ x7 + x8 + x9
            speed ~ visual + textual'
  check <- function(fit, id) {
    result <- export_lavaan_results(fit,folder,id,model_syntax=model)
    parsed <- jsonlite::read_json(file.path(folder,paste0(id,'.json')),simplifyVector=FALSE)
    stopifnot(parsed$schema_version=='1.2', !file.exists(file.path(dirname(folder),'models.json')))
    raw <- lavInspect(fit,'cor.lv')
    verify <- function(encoded,matrix) {
      if(is.matrix(matrix)) {
        stopifnot(encoded$kind=='matrix',identical(unlist(encoded$row_names),rownames(matrix)))
        actual <- do.call(rbind,lapply(encoded$values, function(row) vapply(row,function(v)if(is.null(v))NA_real_ else v,numeric(1))))
        if(length(matrix)) stopifnot(max(abs(as.numeric(actual)-as.numeric(matrix)),na.rm=TRUE)<1e-12)
      } else for(i in seq_along(matrix))verify(encoded[[i]],matrix[[i]])
    }
    verify(parsed$latent_correlations,raw)
    stopifnot(length(parsed$parameters)==nrow(parameterEstimates(fit,standardized=TRUE,ci=TRUE)))
    result
  }
  fit <- sem(model,HolzingerSwineford1939)
  check(fit,'single')
  check(sem(model,HolzingerSwineford1939,group='school'),'groups')
  dat <- HolzingerSwineford1939
  for(n in paste0('x',1:3)) dat[[n]] <- cut(dat[[n]],breaks=3,labels=FALSE)
  ordinal <- check(cfa('visual =~ x1+x2+x3',dat,ordered=paste0('x',1:3),estimator='WLSMV'),'ordinal')
  stopifnot(ordinal$metadata$data_treatment=='Ordinal',length(ordinal$latent_correlations$values)==1,length(ordinal$latent_correlations$values[[1]])==1)
  check(sem('x2 ~ x1',HolzingerSwineford1939),'observed')
  cat('PASS: continuous SEM, multi-group SEM, ordinal CFA, observed-only model; JSON matrix labels and values preserved.\n')
}
run_checks()

