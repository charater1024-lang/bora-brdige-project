# Security and public source

Report suspected security problems through GitHub's private vulnerability reporting feature when it is enabled for this repository. If it is unavailable, use the operator contact on the deployed service's privacy page. Do not put keys, member records, session cookies, infrastructure access details, or exploit results containing private data in public issues.

## Before a commit

Run `npm run hooks:install` once in each clone. The pre-commit hook scans the actual Git index, including files added with `git add -f`, and never prints a detected value. Run `npm run check:public-source` manually if your Git client does not execute hooks. Hooks are local safeguards and can be bypassed; the pull-request/push workflow provides a second check. Require that workflow through branch protection or a repository ruleset before accepting outside contributions.

Keep all credentials in ignored local configuration or a secret manager. Examples contain no working secrets. Runtime databases, user data, caches, logs, model weights, backups, virtual environments, generated runtime configuration and tunnel credentials do not belong in Git. Do not add broad exceptions or suppress a finding simply to pass a check. The checks are defense in depth, not a guarantee that every possible encoded secret will be detected.

## Operator configuration

- Set `DEVELOPER_ADMIN_IDENTITIES` to verified immutable `provider:subject` identities. Subjects are case-sensitive. There is no built-in administrator or email-based privilege.
- Set `LEGAL_CONTACT_EMAIL` to a working public support mailbox. This is displayed to visitors and must not be treated as private authentication information.
- Generate separate Local LLM inference and administration tokens with `python local-llm-server/setup_tokens.py`; do not paste generated tokens into source, documentation, issues or terminal recordings.
- Review [deployment instructions](docs/deployment-public.md) before installing service definitions.

## If a credential is committed

Revoke or rotate the credential at its issuer first and update the protected runtime configuration. Deleting a file in a new commit does not remove it from history. Review branches, tags, pull requests, forks, caches, releases and CI artifacts as relevant to the incident. Coordinate any history rewrite with repository collaborators; it is not performed automatically by these scripts.

## Publishing an existing private repository

A clean current tree does not sanitize old commits. Earlier commits in this project's private development history contain operator contact information and machine-specific paths. `check:public-source:history` checks reachable history for credentials/runtime artifacts; its legacy privacy metadata is explicitly outside that mode. Current-tree checks also enforce public-source privacy rules.

For an initial public release without the private development history, run `npm run export:public-source` from a clean, committed and validated checkout. It creates a checked source ZIP without `.git` or other branches. Extract it into a new directory and initialize a new repository there. Review commit author email settings (for example a GitHub no-reply address), repository description, releases, wiki and issue attachments before making that new repository public. Do not push the existing private repository's old branches or tags to the new one.

Changing the visibility of the original repository would expose its existing reachable history. That is a separate publication decision; this hardening work does not rewrite history or change repository visibility.
