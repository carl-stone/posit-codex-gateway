# Security

## Local trust boundary

`posit-codex-gateway` is a local OAuth gateway. It binds to `127.0.0.1` only and accepts loopback Host and browser Origin values so RStudio can use it. Any process running locally as you should be considered capable of using the gateway while it is running.

Do not reverse-proxy it, tunnel it, bind it to a public interface, or run it on a shared host. The project does not provide client authentication or multi-user isolation.

Diagnostics are opt-in and metadata-only. Please redact credentials, prompts, tool content, headers, and OAuth material from security reports.

## Reporting

Report vulnerabilities privately through GitHub Security Advisories for this repository. Do not open a public issue containing credentials or private conversation data.
