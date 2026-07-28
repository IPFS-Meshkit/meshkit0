# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.2.x   | Yes       |
| 1.1.x   | No        |
| 1.0.x   | No        |

## Encryption security properties

All encrypted payloads use the **EMSH** (Encrypted MeSHkit) wire format:

| Property | Detail |
|---|---|
| Cipher | AES-256-GCM — authenticated encryption, detects any bit-level tampering |
| Key derivation | PBKDF2-SHA256, default 200,000 iterations (OWASP 2023 minimum) |
| Salt | 128-bit random, unique per `encrypt()` call |
| Nonce | 96-bit random, unique per `encrypt()` call |
| Iteration bounds | Minimum 1,000 on encrypt; maximum 10,000,000 on decrypt (DoS guard) |
| Dependencies | `@noble/ciphers` and `@noble/hashes` — [Cure53-audited](https://cure53.de/pentest-report_noble-crypto.pdf) |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report security issues privately via [GitHub Security Advisories](https://github.com/IPFS-Meshkit/meshkit0/security/advisories/new) or by opening a confidential issue with the maintainers.

Include:

- A description of the vulnerability
- Steps to reproduce
- Impact assessment (if known)
- Affected versions

We aim to acknowledge reports within a few business days and will work on a fix before public disclosure when possible.
