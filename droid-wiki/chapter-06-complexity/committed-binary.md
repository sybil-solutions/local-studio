# 14 — Committed CLI binary

> **Severity:** Low
> **Cross-link:** [Chapter 3 — architecture overview](../chapter-03-cli/architecture-overview.md)

## What's in the tree

```
-rwxr-xr-x  60,308,320 bytes  cli/vllm-studio
```

A **60 MB pre-built CLI binary** committed to the repo root under
`cli/vllm-studio`. The mode bit (`+x`) is preserved by git.

## Why it's complex (more accurately, costly)

- Every `git clone` of the repo downloads 60 MB of binary content. Over
  the typical contributor's lifetime — clones, fresh checkouts, CI
  workspaces, multiple worktrees — this costs real time and real
  bandwidth.
- A binary file in source control is opaque to diff tooling. `git log -p
  cli/vllm-studio` produces useless output. `git blame` cannot identify
  which source change produced a behaviour change in the binary.
- The binary may go **stale** relative to the source under `cli/src/`.
  Without a CI gate that rebuilds and verifies bit-equivalence, there is
  no guarantee the committed binary matches the source — and if a
  contributor edits `cli/src/` without rebuilding, the next user to run
  `./cli/vllm-studio` runs old code.
- The binary defeats CI build verification. CI cannot fail "the CLI
  doesn't build from source" if no one is asked to run that build.
- Security-wise, a committed binary is a supply-chain blob. Any reviewer
  who notices the size delta has to take it on trust that the binary is
  what its source claims to be.

## What could simplify it

- Move the binary out of git. Build it during release / packaging,
  ship it through GitHub Releases or an artefact store, fetch it via a
  setup script for users who need a prebuilt copy.
- If the binary must be in tree (e.g., for offline distribution),
  Git LFS is the canonical place for it — `git clone` then becomes
  fast and the LFS object is fetched on demand.
- Add a CI check that rebuilds the CLI from source and compares — even
  a hash check — so drift is caught.
- Document in `cli/README.md` (or the root README) how to rebuild it
  locally and what compiler / runtime version produced the committed
  copy.
