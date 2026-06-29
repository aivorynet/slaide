# Security Policy

## Supported Versions

Security fixes are applied to the latest released version. Please test against the
latest release before reporting.

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |
| older   | :x:                |

## Reporting a Vulnerability

Please report security vulnerabilities privately. **Do not open a public issue.**

Email **aivee@aivory.net** with:

- a description of the issue and its impact,
- steps to reproduce (a minimal `.slaide` deck or command if applicable),
- any suggested remediation.

You can expect an acknowledgement within a few business days. We will keep you
informed of progress toward a fix and coordinate disclosure timing with you.

### Scope notes

- slaide renders untrusted Markdown/HTML into a deck and runs it in a browser or
  WebView. `embed`/`widget` fences are intentionally sandboxed (`iframe`,
  `allow-scripts` with no same-origin). Reports of sandbox escapes are in scope.
- The importer parses untrusted `.pptx`/`.key` (zip + XML). Parser-level DoS or
  path-traversal reports are in scope.
