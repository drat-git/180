# Project working preferences

## Keep verification focused and usage efficient

- Use the smallest meaningful set of checks for each change. Test the behavior and files affected, rather than running every suite by default.
- For small copy or styling changes, use a quick inspection or targeted check. Do not add tests that merely repeat the implementation.
- Reserve full unit/browser/database suites for major changes, shared infrastructure changes, or a concrete regression risk that targeted checks cannot cover.
- Once relevant checks pass, stop testing. Repeat or broaden checks only when new edits, failures, or unresolved concerns justify it.
- Avoid duplicate builds, repeated visual inspections, and redundant tool calls. Batch independent reads and checks when useful.
- Keep progress updates and final reports concise. Summarize relevant verification and any remaining limitations without listing routine steps.

These preferences apply to all future work in this repository, including new chats. Preserve checks required for the specific change, security, or correctness; do not substitute broad testing for judgment.
