# decibri CLA Action

A GitHub Action that enforces decibri's individual and corporate Contributor
License Agreements on pull requests. It sets a single `CLA` status check, posts
signing instructions when a contributor is not yet covered, and records an
individual signature when the contributor comments the assent phrase on their own
pull request. There is no server and no database.

## Usage

Reference the Action from a workflow in the repository you want to protect:

```yaml
name: CLA
on:
  pull_request_target:
    types: [opened, synchronize, closed]
  issue_comment:
    types: [created]
jobs:
  cla:
    runs-on: ubuntu-latest
    steps:
      - uses: decibri/decibri-cla-action@v1
        with:
          store-token: ${{ secrets.CLA_STORE_TOKEN }}
```

The `store-token` input is a token with contents read and write on decibri's
private signature store repository. The workflow's built-in `github-token` is
used for the calling repository and is picked up by default.

## Maintainers

Detailed operational documentation (token setup, the signature store, repository
onboarding, and the corporate runbook) lives in decibri's private maintainer
repository.
