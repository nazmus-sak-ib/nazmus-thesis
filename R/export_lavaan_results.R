
# Drop-in update based on your supplied exporter; source this before exporting.

#' Export lavaan model results for the SEM model-development website
#'
#' @description
#' Extracts a structured, web-safe set of results from a fitted lavaan model
#' and writes them to a JSON file for use by the React/React Flow frontend.
#'
#' The function is intended to work across different lavaan model types,
#' including:
#'
#'   - CFA and SEM
#'   - ordinal/categorical models
#'   - continuous models
#'   - WLSMV/DWLS models
#'   - ML-family models
#'   - single-group models
#'   - multi-group models
#'
#' It deliberately exports the results that actually exist for a fitted
#' model rather than assuming that every model contains thresholds,
#' intercepts, robust fit indices, R-squared values, etc.
#'
#' @param fit
#'   A fitted lavaan object.
#'
#' @param folder
#'   Folder where the model-result JSON file should be written.
#'   For the website this will normally be:
#'
#'       web/results
#'
#' @param name
#'   Stable model ID used across the project.
#'   Example: "B2.1.1"
#'
#'   This ID determines the JSON filename and expected diagram filename.
#'
#' @param model_syntax
#'   Optional character string containing the lavaan model syntax.
#'   Stored in the JSON for later inspection.
#'
#' @param model_title
#'   Optional human-readable model title.
#'   If NULL, defaults to paste("Model", name).
#'
#' @param image_ext
#'   File extension of the corresponding model diagram.
#'   Defaults to "svg".
#'
#' @param register_model
#'   Defaults to FALSE: the web app discovers paired files directly.
#'   If TRUE, automatically creates or updates the model's entry in
#'   models.json.
#'
#' @details
#' The exported JSON contains:
#'
#'   metadata
#'     Resolved lavaan estimation/model settings and basic model information.
#'
#'   sample_size
#'     Number of observations, by group when applicable.
#'
#'   missing_patterns
#'     Number of missing-data patterns when lavaan provides this information.
#'
#'   model_syntax
#'     Original lavaan syntax supplied to this function.
#'
#'   fit_measures
#'     All fit measures returned by lavaan::fitMeasures().
#'
#'   parameters
#'     Full parameterEstimates() output, including standardized estimates
#'     and a derived "section" variable used by the frontend.
#'
#'     Possible sections include:
#'       loading
#'       regression
#'       intercept
#'       threshold
#'       variance
#'       covariance
#'       scaling_factor
#'       defined
#'       other
#'
#'   r_squared
#'     R-squared values when available.
#'
#'   modification_indices
#'     Modification indices when available.
#'
#' Thresholds therefore do NOT need a separate export object. They are
#' preserved as rows of `parameters` where section == "threshold".
#'
#' @return
#' Invisibly returns the same R list that is written to JSON.
#'
#' @examples
#' export_lavaan_results(
#'   fit = fit_semB211,
#'   folder = RESULTS_FOLDER_PATH,
#'   name = "B2.1.1",
#'   model_syntax = model_semB211
#' )
#'
export_lavaan_results <- function(
    fit,
    folder,
    name,
    model_syntax = NULL,
    model_title = NULL,
    image_ext = "svg",
    register_model = FALSE
) {
  
  
  # _________________________________________________________________________
  # 0. Basic validation
  # _________________________________________________________________________
  
  if (!inherits(fit, "lavaan")) {
    stop("`fit` must be a fitted lavaan object.")
  }
  
  if (
    length(name) != 1L ||
    is.na(name) ||
    !nzchar(name)
  ) {
    stop("`name` must be a single non-empty model ID.")
  }
  
  
  # Remove a leading period if supplied as ".svg" instead of "svg".
  image_ext <- sub("^\\.", "", image_ext)
  
  
  # Create results directory if it does not already exist.
  dir.create(
    folder,
    recursive = TRUE,
    showWarnings = FALSE
  )
  
  
  # _________________________________________________________________________
  # 1. Basic model identifiers
  # _________________________________________________________________________
  
  # Stable internal ID used for filenames and model registration.
  model_id <- name
  
  
  # Human-readable title shown by the website.
  if (is.null(model_title)) {
    model_title <- paste("Model", name)
  }
  
  
  # _________________________________________________________________________
  # 2. Internal helper functions
  # _________________________________________________________________________
  
  # Safely call lavInspect().
  #
  # Some pieces of information simply do not exist for all model
  # types. Returning NULL instead of stopping the exporter makes the
  # JSON structure tolerant of ordinal, continuous, ML, WLSMV, etc.
  safe_inspect <- function(what, ...) {
    
    tryCatch(
      lavaan::lavInspect(
        fit,
        what,
        ...
      ),
      error = function(e) NULL
    )
  }
  
  
  # Return x unless it is NULL; otherwise use y.
  #
  # Used mostly when a particular lavaan option is unavailable.
  `%||%` <- function(x, y) {
    
    if (is.null(x)) {
      y
    } else {
      x
    }
  }
  
  
  # _________________________________________________________________________
  # 3. Resolved lavaan options
  # _________________________________________________________________________
  
  # This is especially useful because it describes how lavaan
  # actually resolved the model settings, including defaults.
  #
  # For example, a requested WLSMV model internally uses DWLS
  # estimation together with robust SE/test machinery.
  options <- safe_inspect("options")
  
  
  if (is.null(options)) {
    options <- list()
  }
  
  
  # _________________________________________________________________________
  # 4. Observed and ordered variables
  # _________________________________________________________________________
  
  ordered_variables <- tryCatch(
    lavaan::lavNames(fit, type = "ov.ord"),
    error = function(e) NULL
  )
  
  
  if (is.null(ordered_variables)) {
    ordered_variables <- character(0)
  }
  
  
  # Retrieve all observed variables involved in the model.
  observed_variables <- tryCatch(
    lavaan::lavNames(
      fit,
      type = "ov"
    ),
    error = function(e) character(0)
  )
  
  
  # ____________________________________________________________--
  # Derive an easy-to-display treatment label
  # ____________________________________________________________--
  #
  # Continuous:
  #   No observed variables are treated as ordered.
  #
  # Ordinal:
  #   All observed model variables are ordered.
  #
  # Mixed:
  #   Some are ordered and some are continuous.
  #
  # This is a convenience variable for the frontend; the actual
  # ordered-variable names are also preserved.
  
  if (length(ordered_variables) == 0L) {
    
    data_treatment <- "Continuous"
    
  } else if (
    length(observed_variables) > 0L &&
    setequal(
      ordered_variables,
      observed_variables
    )
  ) {
    
    data_treatment <- "Ordinal"
    
  } else {
    
    data_treatment <- "Mixed"
  }
  
  
  # _________________________________________________________________________
  # 5. Parameter estimates
  # _________________________________________________________________________
  
  # parameterEstimates() contains the major model quantities,
  # including:
  #
  #   factor loadings
  #   regressions
  #   variances/covariances
  #   thresholds
  #   intercepts/means
  #   user-defined parameters
  #
  # standardized = TRUE adds standardized estimates such as
  # std.lv and std.all when they are available.
  
  parameters <- lavaan::parameterEstimates(
    fit,
    standardized = TRUE,
    ci = TRUE
  )
  
  
  # ____________________________________________________________--
  # Classify parameter rows for easy frontend filtering
  # ____________________________________________________________--
  #
  # IMPORTANT:
  #
  # We retain every row from parameterEstimates().
  # The "section" variable only provides a convenient label.
  #
  # Therefore, if a future model introduces a parameter type that
  # is not explicitly classified here, it is still retained under
  # section == "other".
  
  parameters$section <- ifelse(
    
    parameters$op == "=~",
    "loading",
    
    ifelse(
      
      parameters$op == "~",
      "regression",
      
      ifelse(
        
        parameters$op == "~1",
        "intercept",
        
        ifelse(
          
          parameters$op == "|",
          "threshold",
          
          ifelse(
            
            parameters$op == "~*~",
            "scaling_factor",
            
            ifelse(
              
              parameters$op == ":=",
              "defined",
              
              ifelse(
                
                parameters$op == "~~" &
                  parameters$lhs == parameters$rhs,
                "variance",
                
                ifelse(
                  
                  parameters$op == "~~",
                  "covariance",
                  
                  "other"
                )
              )
            )
          )
        )
      )
    )
  )
  
  
  # _________________________________________________________________________
  # 6. Fit measures
  # _________________________________________________________________________
  
  # Not every estimator/model necessarily produces every possible
  # fit statistic. Export whatever lavaan actually returns.
  
  fm <- tryCatch(
    lavaan::fitMeasures(fit),
    error = function(e) NULL
  )
  
  
  if (!is.null(fm)) {
    
    fit_measures <- data.frame(
      measure = names(fm),
      value = as.numeric(fm),
      row.names = NULL
    )
    
  } else {
    
    fit_measures <- NULL
  }
  
  
  # _________________________________________________________________________
  # 7. R-squared
  # _________________________________________________________________________
  
  # Request group-aware R-squared output.
  #
  # Some models may not contain endogenous variables for which R²
  # exists. In that case r_squared remains NULL.
  
  r2_raw <- safe_inspect(
    "r2",
    drop.list.single.group = FALSE
  )
  
  
  group_labels <- safe_inspect(
    "group.label"
  )
  
  
  if (!is.null(r2_raw)) {
    
    
    # If lavaan provides no named group labels, use numeric group IDs.
    if (
      is.null(group_labels) ||
      length(group_labels) == 0L
    ) {
      
      group_labels <-
        seq_along(r2_raw)
    }
    
    
    r_squared <- do.call(
      rbind,
      lapply(
        seq_along(r2_raw),
        function(i) {
          
          x <- r2_raw[[i]]
          
          
          data.frame(
            group =
              as.character(
                group_labels[i]
              ),
            
            variable =
              names(x),
            
            r2 =
              as.numeric(x),
            
            row.names = NULL
          )
        }
      )
    )
    
  } else {
    
    r_squared <- NULL
  }
  
  
  # _________________________________________________________________________
  # 8. Modification indices
  # _________________________________________________________________________
  
  # Modification indices are useful diagnostics but are not
  # available/appropriate for every possible fitted model.
  #
  # Failure to compute them should therefore not prevent the rest
  # of the model from being exported.
  
  modification_indices <- tryCatch(
    
    lavaan::modificationIndices(
      fit,
      sort. = TRUE
    ),
    
    error = function(e) NULL
  )
  
  
  # _________________________________________________________________________
  # 9. Sample sizes
  # _________________________________________________________________________
  
  nobs_raw <- safe_inspect(
    "nobs"
  )
  
  
  if (!is.null(nobs_raw)) {
    
    
    if (
      is.null(group_labels) ||
      length(group_labels) !=
      length(nobs_raw)
    ) {
      
      nobs_labels <-
        seq_along(nobs_raw)
      
    } else {
      
      nobs_labels <-
        group_labels
    }
    
    
    sample_size <- data.frame(
      
      group =
        as.character(
          nobs_labels
        ),
      
      n =
        as.integer(
          nobs_raw
        ),
      
      row.names = NULL
    )
    
  } else {
    
    sample_size <- NULL
  }
  
  
  # _________________________________________________________________________
  # 10. Missing-data patterns
  # _________________________________________________________________________
  
  # lavaan may expose missing-data pattern information depending on
  # estimator and missing-data treatment.
  #
  # If it does not exist, this section is simply NULL.
  
  patterns <- safe_inspect(
    "patterns",
    drop.list.single.group = FALSE
  )
  
  
  missing_patterns <- NULL
  
  
  if (!is.null(patterns)) {
    
    
    pattern_labels <-
      group_labels
    
    
    if (
      is.null(pattern_labels) ||
      length(pattern_labels) !=
      length(patterns)
    ) {
      
      pattern_labels <-
        seq_along(patterns)
    }
    
    
    pattern_counts <- vapply(
      
      patterns,
      
      function(x) {
        
        n <- nrow(x)
        
        if (is.null(n)) {
          0L
        } else {
          as.integer(n)
        }
      },
      
      integer(1)
    )
    
    
    missing_patterns <- data.frame(
      
      group =
        as.character(
          pattern_labels
        ),
      
      n_patterns =
        pattern_counts,
      
      row.names = NULL
    )
  }
  
  
  # _________________________________________________________________________
  # 11. Model metadata
  # _________________________________________________________________________
  
  # Metadata intentionally contains methodological information that
  # may help distinguish one model iteration from another.
  #
  # These fields are resolved from the fitted lavaan object rather
  # than relying only on what was explicitly written in sem()/cfa().
  #
  # This allows the frontend to show a compact cue such as:
  #
  #   WLSMV · Ordinal · Pairwise
  #
  # while keeping the more technical settings in an Overview or
  # Method-details view.
  
  metadata <- list(
    
    
    # ____________________________________________________________
    # Identification
    # ____________________________________________________________
    
    model_id =
      model_id,
    
    model_name =
      model_title,
    
    exported_at =
      format(
        Sys.time(),
        "%Y-%m-%dT%H:%M:%S%z"
      ),
    
    lavaan_version =
      as.character(
        packageVersion("lavaan")
      ),
    
    
    # ____________________________________________________________
    # Estimation
    # ____________________________________________________________
    
    # Preserve the old field for backward compatibility with the
    # existing frontend.
    estimator =
      options$estimator %||%
      NULL,
    
    
    # Requested estimator, when lavaan preserves it.
    #
    # Example:
    #   estimator_requested = "WLSMV"
    #   estimator_actual    = "DWLS"
    estimator_requested =
      options$estimator.orig %||%
      options$estimator %||%
      NULL,
    
    estimator_actual =
      options$estimator %||%
      NULL,
    
    
    se_method =
      options$se %||%
      NULL,
    
    test =
      options$test %||%
      NULL,
    
    information =
      options$information %||%
      NULL,
    
    h1_information =
      options$h1.information %||%
      NULL,
    
    
    # Relevant especially for ML-family estimators.
    likelihood =
      options$likelihood %||%
      NULL,
    
    
    # Relevant especially for categorical models.
    link =
      options$link %||%
      NULL,
    
    
    # ____________________________________________________________
    # Data treatment / missingness
    # ____________________________________________________________
    
    data_treatment =
      data_treatment,
    
    missing =
      options$missing %||%
      NULL,
    
    ordered_variables =
      ordered_variables,
    
    number_ordered_variables =
      length(
        ordered_variables
      ),
    
    
    # ____________________________________________________________
    # Parameterization / latent-variable scaling
    # ____________________________________________________________
    
    parameterization =
      options$parameterization %||%
      safe_inspect(
        "parameterization"
      ),
    
    std_lv =
      options$std.lv %||%
      NULL,
    
    
    # ____________________________________________________________
    # Model-building defaults actually used by lavaan
    # ____________________________________________________________
    
    meanstructure =
      options$meanstructure %||%
      NULL,
    
    fixed_x =
      options$fixed.x %||%
      NULL,
    
    auto_var =
      options$auto.var %||%
      NULL,
    
    auto_cov_lv_x =
      options$auto.cov.lv.x %||%
      NULL,
    
    auto_cov_y =
      options$auto.cov.y %||%
      NULL,
    
    
    # ____________________________________________________________
    # Additional lavaan behavior
    # ____________________________________________________________
    
    mimic =
      options$mimic %||%
      NULL,
    
    representation =
      options$representation %||%
      NULL,
    
    
    # ____________________________________________________________
    # Model status / size
    # ____________________________________________________________
    
    converged =
      safe_inspect(
        "converged"
      ),
    
    post_check =
      safe_inspect(
        "post.check"
      ),
    
    number_parameters =
      safe_inspect(
        "npar"
      ),
    
    number_groups =
      safe_inspect(
        "ngroups"
      )
  )
  
  
  # Latent-variable matrices: total model-implied relationships, not residual
  # correlations and not correlations between estimated factor scores.
  # Preserve matrix labels and all group/level nesting, including 1x1 matrices.
  matrix_json <- function(x) {
    if (is.null(x)) return(NULL)
    if (is.matrix(x)) {
      return(list(
        kind = "matrix",
        row_names = unname(as.list(rownames(x))),
        column_names = unname(as.list(colnames(x))),
        values = unname(lapply(seq_len(nrow(x)), function(i) {
          row <- as.numeric(x[i, ])
          row[!is.finite(row)] <- NA_real_
          unname(as.list(row))
        }))
      ))
    }
    if (is.list(x)) return(lapply(x, matrix_json))
    stop("Unexpected latent matrix structure.")
  }

  latent_diagnostics <- list()
  get_latent_matrix <- function(what) {
    messages <- character()
    value <- tryCatch(
      withCallingHandlers(
        matrix_json(lavaan::lavInspect(fit, what)),
        warning = function(w) {
          messages <<- c(messages, conditionMessage(w))
          invokeRestart("muffleWarning")
        }
      ),
      error = function(e) {
        messages <<- c(messages, conditionMessage(e))
        NULL
      }
    )
    if (length(messages)) latent_diagnostics[[what]] <<- unname(as.list(unique(messages)))
    value
  }

  latent_variables <- tryCatch(
    lavaan::lavNames(fit, type = "lv"),
    error = function(e) character(0)
  )
  latent_correlations <- get_latent_matrix("cor.lv")
  latent_covariances <- get_latent_matrix("cov.lv")
  metadata$latent_variables <- unname(as.list(latent_variables))
  metadata$observed_variables <- unname(as.list(observed_variables))
  metadata$group_labels <- unname(as.list(safe_inspect("group.label")))
  metadata$latent_correlation_source <- 'lavaan::lavInspect(fit, "cor.lv")'
  metadata$latent_covariance_source <- 'lavaan::lavInspect(fit, "cov.lv")'

  # _________________________________________________________________________
  # 12. Build complete JSON object
  # _________________________________________________________________________
  
  # Version 1.2 adds labeled latent matrices and variable identities.
  # Existing result fields retain their previous structure.
  
  results <- list(
    
    schema_version = "1.2",
    
    metadata =
      metadata,
    
    sample_size =
      sample_size,
    
    missing_patterns =
      missing_patterns,
    
    model_syntax =
      model_syntax,
    
    fit_measures =
      fit_measures,
    
    parameters =
      parameters,
    
    r_squared =
      r_squared,
    
    modification_indices =
      modification_indices,

    latent_correlations = latent_correlations,
    latent_covariances = latent_covariances,
    latent_matrix_diagnostics = latent_diagnostics
  )
  
  
  # _________________________________________________________________________
  # 13. Write model-result JSON
  # _________________________________________________________________________
  
  json_file <- file.path(
    folder,
    paste0(
      model_id,
      ".json"
    )
  )
  
  
  jsonlite::write_json(
    
    results,
    
    json_file,
    
    pretty = TRUE,
    
    auto_unbox = TRUE,
    
    dataframe = "rows",
    
    na = "null",
    
    digits = 15
  )
  
  
  # _________________________________________________________________________
  # 14. Register/update model in models.json
  # _________________________________________________________________________
  
  if (register_model) {
    
    
    # Expected structure:
    #
    # web/
    # ├── models/
    # │   └── B2.1.1.svg
    # ├── results/
    # │   └── B2.1.1.json
    # └── models.json
    #
    # Since `folder` normally points to public/results,
    # dirname(folder) resolves to web/ for the current project.
    
    public_folder <-
      dirname(folder)
    
    
    catalog_file <- file.path(
      public_folder,
      "models.json"
    )
    
    
    new_model <- list(
      
      id =
        model_id,
      
      title =
        model_title,
      
      image =
        paste0(
          "models/",
          model_id,
          ".",
          image_ext
        ),
      
      results =
        paste0(
          "results/",
          model_id,
          ".json"
        )
    )
    
    
    # ____________________________________________________________
    # Read existing catalogue
    # ____________________________________________________________
    
    if (file.exists(catalog_file)) {
      
      catalog <-
        jsonlite::fromJSON(
          catalog_file,
          simplifyVector = FALSE
        )
      
    } else {
      
      catalog <- list(
        
        schema_version =
          "1.0",
        
        models =
          list()
      )
    }
    
    
    # Be tolerant of an incomplete/empty catalogue.
    if (is.null(catalog$models)) {
      catalog$models <- list()
    }
    
    
    # ____________________________________________________________
    # Locate existing model entry
    # ____________________________________________________________
    
    ids <- vapply(
      
      catalog$models,
      
      function(x) {
        x$id %||% ""
      },
      
      character(1)
    )
    
    
    existing <-
      which(
        ids == model_id
      )
    
    
    # ____________________________________________________________
    # Update or append
    # ____________________________________________________________
    
    if (length(existing) > 0L) {
      
      # modifyList() preserves any additional catalogue fields that
      # may have been added later by the web application while
      # updating the fields controlled by this exporter.
      
      catalog$models[[existing[1]]] <- utils::modifyList(
        catalog$models[[existing[1]]],
        new_model
      )
      
    } else {
      
      catalog$models[[length(catalog$models) + 1L]] <- new_model
      
    }
    
    # ____________________________________________________________
    # Write updated catalogue
    # ____________________________________________________________
    
    jsonlite::write_json(
      
      catalog,
      
      catalog_file,
      
      pretty = TRUE,
      
      auto_unbox = TRUE
    )
  }
  
  
  # _________________________________________________________________________
  # 15. Console confirmation
  # _________________________________________________________________________
  
  message(
    "Exported model: ",
    model_id,
    "\nResults: ",
    json_file
  )
  
  
  # Return results invisibly so the function can also be assigned:
  #
  # exported <- export_lavaan_results(...)
  #
  # without printing the entire object to the console.
  
  invisible(results)
}




