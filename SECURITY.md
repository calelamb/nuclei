# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Nuclei, please report it responsibly.

**Do not open a public issue.** Instead, use one of these channels:

1. **GitHub Security Advisories** (preferred): Go to the [Security tab](https://github.com/calelamb/nuclei/security/advisories/new) and create a new advisory.
2. **Email**: Contact the maintainer directly at the email listed on the GitHub profile.

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if you have one)

### Scope

The following are in scope for security reports:

- API key exposure or leakage
- Cross-site scripting (XSS) in the Tauri webview
- Code execution escalation beyond intended kernel behavior
- Path traversal or filesystem access beyond permitted directories
- Vulnerabilities in dependencies

### Out of scope

- The Python kernel executes user-provided code by design (same threat model as any local IDE)
- Social engineering attacks
- Denial of service against the local application

### Response timeline

- **48 hours**: Initial acknowledgment
- **7 days**: Assessment and severity classification
- **30 days**: Target for fix release (critical vulnerabilities prioritized)

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |
