# The Models page

Four tabs, one table. `frontend/src/features/recipes/recipes-content/catalog-table-shell.tsx`
holds the primitives — frame, header cell, group row, data row, numeric cell,
hover action — and Recommended, Search Hugging Face, Your servers, and Downloads
all draw on them. A padding or alignment change belongs in the shell, so all
four tabs move together; a change made in one tab is a bug in the making.

Two rules in that page are easy to break by accident, so they are written down.

## Weights may take at most 70% of the pool

`FIT_BUDGET_RATIO` in `model-fit.ts`. The rest of the machine's aggregate memory
pays for the KV cache, activations, CUDA graphs, and the runtime itself, so a
checkpoint that exactly equals the pool cannot actually be served. Every fit
verdict in the app measures against `poolGb * FIT_BUDGET_RATIO`, and the curated
catalog's sizes are chosen against it.

A model that does not fit is **dimmed, never reddened**. The eye should land on
what this machine can run, not on what is broken.

Sizes come from the repository when the catalog records one, and fall back to
`total_params_b × bytes-per-param` otherwise. The per-format constants live in
`BYTES_PER_PARAM`; `q4` is 0.6, not 0.5, because Q4_K_M keeps more bits in the
attention tensors and lands near 4.8 bits/weight in practice.

## The newer catalog wins

`frontend/src/lib/api/studio.ts` compares the controller's `/studio/model-index`
against the copy bundled into the app and serves whichever carries the later
`updated` date. The app and the controller deploy separately, so without this a
freshly updated app shows stale picks until someone restarts the controller —
and restarting the controller kills the running model. Ties go to the
controller, since that is where an operator's curated override lives.

Intelligence scores are the Artificial Analysis Intelligence Index, attributed
under the table through `intelligence_source`. A model AA has not benchmarked
carries `null`, which renders as "not rated" — never as zero, which would sort
it against models that genuinely scored badly.
