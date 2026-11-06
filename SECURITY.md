# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/krizaka/verikora/security/advisories/new) or by e-mail to
**security@krizaka.com**. Do not open a public issue. We acknowledge reports within 72 hours.

## Security model (summary)

- **Accounts**: created by an operator; sign-up is closed by the server (`AUTH_SIGNUP_ENABLED`). Passwords hashed with
  scrypt; a wrong address and a wrong password get the same answer after the same work; sign-in is rate-limited per
  address and per IP.
- **Sessions**: a random token in an HttpOnly, Secure, SameSite=Lax cookie; the database keeps only its keyed hash; the
  account is re-read on every request.
- **Documents**: visible to their owner only (another person's document is a 404); checked by their first bytes (PDF) or
  as UTF-8 text; at most 10 MB; served `Cache-Control: private, no-store`.
- **Analyses**: sent only to Sovkora, with Verikora's service key, over HTTPS; no model is called from this code.
- **Administration**: a session, the ADMIN role and an allowed IP address (none in production by default).
- **HTTP**: Content-Security-Policy `default-src 'self'`, HSTS, `nosniff`, `frame-ancestors 'self'`, strict referrer and
  permissions policies.
- **Configuration**: a production server refuses to start without its secrets; no demo mode.
