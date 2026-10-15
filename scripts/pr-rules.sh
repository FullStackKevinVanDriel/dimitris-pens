#!/usr/bin/env bash
# PR rules for PRs into development (#49): the branch is feature/<name> or
# fix/<name>, and the body closes an open issue in this repo.
#   HEAD_REF=feature/x PR_BODY="Fixes #12" REPO=owner/repo bash scripts/pr-rules.sh
# Uses `gh api` to check the issue (GH_TOKEN in CI). Exit 0 pass, 1 fail.
set -u
fail=0
say() { printf '%s\n' "$*"; }

if [[ "${HEAD_REF:-}" =~ ^(feature|fix)/[A-Za-z0-9._-]+$ ]]; then
  say "ok   branch '${HEAD_REF}' is a feature/ or fix/ branch"
else
  say "FAIL branch '${HEAD_REF:-}' must be named feature/<name> or fix/<name> (branch off a fresh development)"
  fail=1
fi

nums=$(printf '%s' "${PR_BODY:-}" | grep -oiE '\b(close[sd]?|fix(e[sd])?|resolve[sd]?)[[:space:]]+#[0-9]+' | grep -oE '[0-9]+$' | sort -u)
if [ -z "$nums" ]; then
  say "FAIL the PR body needs a line like 'Fixes #12' naming the issue this PR resolves"
  fail=1
else
  open_issue=0
  for n in $nums; do
    info=$(gh api "repos/${REPO}/issues/${n}" --jq '[.state, (.pull_request != null)] | @tsv' 2>/dev/null) \
      || { say "FAIL #$n not found in ${REPO}"; continue; }
    state=${info%%$'\t'*}; is_pr=${info##*$'\t'}
    if [ "$is_pr" = "true" ]; then say "FAIL #$n is a pull request, not an issue"
    elif [ "$state" != "open" ]; then say "FAIL issue #$n is $state; link an open issue"
    else say "ok   closes open issue #$n"; open_issue=1; fi
  done
  [ "$open_issue" -eq 1 ] || fail=1
fi
exit $fail
