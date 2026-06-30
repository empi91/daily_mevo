---
date: 2026-06-13T12:00:00+02:00
researcher: Claude
git_commit: bb8e937
branch: main
repository: daily_mevo
topic: "RODO/GDPR compliance requirements for MevoStats user authentication"
tags: [research, rodo, gdpr, user-auth, compliance, privacy]
status: complete
last_updated: 2026-06-13
last_updated_by: Claude
---

# Research: RODO/GDPR Compliance for MevoStats User Authentication

**Date**: 2026-06-13
**Git Commit**: bb8e937
**Branch**: main
**Repository**: daily_mevo

## Research Question

What is the minimum required set of things to be RODO/GDPR compliant for MevoStats — a small Polish web app that stores user email, hashed password, and favourite station IDs? What technical features, legal documents, and processes are required? What exemptions exist for solo developers?

## Summary

RODO/GDPR fully applies to MevoStats — no exemption covers a public web app with real users. However, the compliance burden for this minimal data set is manageable. The key findings:

1. **Legal basis**: Use Art. 6(1)(b) — contract performance, not consent. This eliminates the need for a data-processing consent checkbox.
2. **No cookie banner needed**: The httpOnly auth cookie is strictly necessary and exempt under both ePrivacy Directive and Polish Prawo telekomunikacyjne art. 173.
3. **Privacy policy is mandatory**: A one-page Polish-language document covering Art. 13 elements, linked from the registration form.
4. **Account deletion is mandatory**: Users must be able to delete their account and all associated data (right to erasure, Art. 17).
5. **Data export is mandatory**: A "download my data" feature returning JSON with email + favourites (right to portability, Art. 20).
6. **No DPO, no DPIA, no UODO registration** required for this scale.
7. **Enforcement risk is low** for a small, good-faith project — but non-zero if a user files a complaint and you fail to cooperate.

## Detailed Findings

### 1. Legal Basis for Processing — Art. 6(1)(b) Contract Performance

**Use Art. 6(1)(b) — performance of a contract. NOT consent.**

When a user registers an account to use favourites, that creates a service contract. Processing email and password is objectively necessary to perform that contract. The EDPB Guidelines 2/2019 confirm: if data processing is necessary to deliver a service the user explicitly requested, contract performance is the correct basis.

**Why NOT consent (Art. 6(1)(a)):**
- If consent is the only way to use the service, it cannot be "freely given" per Art. 7(4)
- Using consent where contract applies is considered an abuse by EDPB
- Consent triggers the obligation to let users withdraw at any time (which would break authentication)
- UODO guidance confirms: do not use consent where contract is the proper basis

**Why NOT legitimate interest (Art. 6(1)(f)):**
- Requires a documented balancing test
- Unnecessary complexity when Art. 6(1)(b) clearly applies

**Practical implication:** Document Art. 6(1)(b) as the legal basis in your privacy policy and internal records. No consent checkbox needed for authentication data.

### 2. Registration Form Requirements

Since the legal basis is contract performance (not consent):

**Required:**
- **Regulamin (Terms of Service) checkbox** — mandatory, unticked by default. This comes from Polish civil law (Kodeks Cywilny), not RODO. Text: "Akceptuję [Regulamin](link)". User cannot register without ticking it.
- **Privacy policy link** — must be visible on the registration page before the submit button. Does NOT need its own checkbox — informing the user is sufficient under Art. 6(1)(b).

**NOT required:**
- Data processing consent checkbox (would be legally incorrect under contract basis)
- Separate privacy policy acceptance checkbox
- Double opt-in or email verification (not a RODO requirement)

**Registration form example:**
```
[Email field]
[Password field]
☐ Akceptuję Regulamin (link)
Rejestrując się, potwierdzasz zapoznanie się z naszą Polityką Prywatności (link).
[Zarejestruj się]
```

### 3. Privacy Policy — Art. 13 Mandatory Elements

A publicly accessible privacy policy page (`/polityka-prywatnosci`) must be present and contain:

| Element | What to write for MevoStats |
|---|---|
| Controller identity + contact (Art. 13(1)(a)) | Full name, email address (as a natural person / sole trader) |
| Purpose of processing (Art. 13(1)(c)) | Account management, storing favourite stations |
| Legal basis (Art. 13(1)(c)) | Art. 6(1)(b) RODO — performance of contract |
| Recipients (Art. 13(1)(e)) | Hosting provider (name it — Mikr.us, Supabase, etc.) |
| Third country transfers (Art. 13(1)(f)) | State if data leaves EEA (depends on hosting) |
| Retention period (Art. 13(2)(a)) | Until account deletion + backup retention (e.g. 30 days) |
| Right to access (Art. 15) | Yes — state it |
| Right to rectification (Art. 16) | Yes — state it |
| Right to erasure (Art. 17) | Yes — via account deletion in settings |
| Right to restriction (Art. 18) | Yes — state it |
| Right to data portability (Art. 20) | Yes — via data download in settings |
| Right to lodge complaint with UODO (Art. 13(2)(d)) | Urząd Ochrony Danych Osobowych, ul. Stawki 2, 00-193 Warszawa, https://uodo.gov.pl |
| Whether data provision is required (Art. 13(2)(e)) | Email and password required to create account; favourites optional |
| Cookie information | Auth cookie: name, purpose, 30-day TTL, httpOnly, no tracking |

**Language:** Must be in Polish (Art. 12 requires "clear and plain language" understandable to the target audience).

**Length:** Can be a single page. RODO says "concise, transparent, intelligible."

### 4. Cookie Banner — NOT Required

**No cookie banner needed for MevoStats.**

The httpOnly JWT auth cookie is strictly necessary for the service explicitly requested by the user (logging in). Both frameworks exempt it:

- **ePrivacy Directive Art. 5(3):** Exempts cookies "strictly necessary to provide a service explicitly requested by the user"
- **Polish Prawo telekomunikacyjne Art. 173(3):** Consent not required when cookies are necessary to provide an electronic service explicitly requested by the user

**Requirement:** Mention the cookie in the privacy policy (name, purpose, TTL). That's the transparency obligation — not a consent obligation.

**Warning:** If analytics (GA4, Hotjar, etc.) are ever added, those are NOT strictly necessary and WOULD require a cookie consent banner.

### 5. Technical Features — MUST Implement

#### 5a. Right to Erasure — Art. 17

**"Delete my account" button** that permanently removes:
- Email address
- Hashed password
- All favourites linked to the user
- Any logs containing the email (if stored)

**Timeframe:** Immediate automated deletion satisfies the requirement. The one-month clock in Art. 17 applies to manual request handling — if deletion is instant via a button, no clock runs.

**Backups:** Data in backups does not need immediate deletion. EDPB accepts backup retention for a reasonable operational period (e.g. 30 days) as long as data is not actively processed from backups. Document this retention period.

#### 5b. Right to Data Portability — Art. 20

**"Download my data" button** returning a JSON file:
```json
{
  "email": "user@example.com",
  "favourites": ["station_123", "station_456"]
}
```

Art. 20 applies because: processing is based on contract (Art. 6(1)(b)) AND processing is automated. Both conditions met.

**Scope:** Data the user "provided" — email and favourites. Hashed password is excluded (derived/transformed data).

**Format:** JSON is the safest — "structured, commonly used, machine-readable" per Art. 20(1).

#### 5c. Right to Access — Art. 15

Users can request a copy of all data held about them. For this minimal data set, the data export feature (Art. 20) effectively covers this too. Providing a contact email for formal requests is sufficient — no automated portal needed. Response deadline: 30 days.

### 6. Documentation Requirements

#### 6a. Record of Processing Activities (RoPA) — Art. 30 — MUST

The <250 employee exemption (Art. 30(5)) does NOT apply because processing is "not occasional" (maintaining persistent user accounts is continuous/systematic). UODO guidance confirms this interpretation.

**What it is:** A private internal document (not published). For MevoStats, one entry:

| Field | Value |
|---|---|
| Controller | [Your name + contact] |
| Purpose | User account management + favourites |
| Categories of data subjects | Registered users |
| Categories of personal data | Email, hashed password, favourite station IDs |
| Recipients | Hosting provider (Mikr.us/Supabase) |
| Retention | Until account deletion + 30 days backup |
| Security measures | Password hashing (bcrypt/argon2), HTTPS, httpOnly cookies |

**Format:** No prescribed format. A markdown file or spreadsheet kept privately is sufficient.

#### 6b. Data Processor Agreement (DPA) — MUST if using third-party hosting

If Supabase, Fly.io, Mikr.us, or any hosting provider processes data on your behalf, you need a DPA. Major providers (Supabase, Fly.io) offer standard DPAs — sign/accept and keep a copy.

#### 6c. Breach Notification Process — Art. 33

**Not a software feature, but a process you must know:**
- Notify UODO within 72 hours of becoming aware of a personal data breach
- Via online form at https://uodo.gov.pl/525
- Must include: nature of breach, approximate affected users, contact point, likely consequences, measures taken
- If breach poses HIGH risk to users: also notify affected users directly (Art. 34)
- **Maintain an internal breach register** (Art. 33(5)) — a simple file documenting any incidents, even minor ones

### 7. What is NOT Required

| Obligation | Required? | Reason |
|---|---|---|
| DPO (Data Protection Officer) | No | No large-scale systematic monitoring or special-category data (Art. 37) |
| DPIA (Impact Assessment) | No | No high-risk processing — email + favourites scores zero on EDPB risk criteria (Art. 35) |
| UODO registration | No | Abolished since May 2018 when GIODO became UODO |
| Cookie consent banner | No | Auth cookie is strictly necessary (Prawo telekomunikacyjne art. 173(3)) |
| Consent checkbox for data processing | No | Legal basis is contract (Art. 6(1)(b)), not consent |
| Email verification | No | Not a RODO requirement |

### 8. Exemptions — None Apply

- **Household exemption (Art. 2(2)(c)):** Does not apply — MevoStats is a publicly accessible web app. CJEU consistently holds: once data is available to the public via a website, even non-commercial, this exemption is excluded.
- **Art. 30(5) (<250 employees):** Does not exempt from RoPA because processing is not "occasional."
- **No blanket small-business exemption** exists in GDPR or Polish law.

### 9. Enforcement Risk Assessment

| Risk Factor | Assessment |
|---|---|
| Proactive UODO enforcement against small hobby apps | Very low — no documented cases, not in UODO inspection priorities |
| Fine triggered by user complaint | Low-medium — possible if deletion request is ignored or credentials leak |
| Fine amount (cooperative first violation) | Likely PLN 1,000–15,000; reprimand possible under Recital 148 |
| Fine amount (non-cooperation with UODO) | Escalates significantly — non-cooperation is the #1 risk multiplier |
| Data breach risk | The real operational risk — leaked emails trigger both UODO notification and user complaints |

**UODO enforcement data (2023-2025):** Overwhelmingly targets banks, telecoms, insurers, healthcare, and e-commerce with data breaches. No public evidence of UODO fining a solo developer running a small web app. Enforcement is complaint-driven, not proactive scanning.

**Art. 83(2) proportionality factors** that protect small projects: minimal data set, small user base, no special-category data, no profit motive, negligent (not intentional) if any violation. Recital 148 allows a reprimand instead of a fine when a fine would be disproportionate to a natural person.

## Implementation Checklist for user-auth Plan

### MUST add to the plan (legal obligations)

- [ ] Privacy policy page (`/polityka-prywatnosci`) with all Art. 13 elements, in Polish
- [ ] Regulamin (Terms of Service) page — even a minimal one
- [ ] Registration form: Regulamin checkbox (unticked) + privacy policy link (no checkbox needed)
- [ ] Account deletion endpoint: `DELETE /api/v1/users/me` — removes user + all favourites
- [ ] Account deletion UI: button in user settings/profile
- [ ] Data export endpoint: `GET /api/v1/users/me/data` — returns JSON with email + favourites
- [ ] Data export UI: "Download my data" button
- [ ] Internal RoPA document (private markdown file, not in the app)
- [ ] Internal breach register document (private, ready to fill in)
- [ ] DPA with hosting provider (sign Mikr.us/Supabase standard DPA)

### NOT needed in the plan

- Cookie consent banner
- Data processing consent checkbox
- DPO appointment
- DPIA document
- UODO registration

## Regulamin vs Privacy Policy — Clarification

These are two separate documents:

- **Regulamin (Terms of Service):** Contract terms for using the service. Required by Polish civil law. Covers: what the service is, user obligations, liability limitations, complaint procedure. Needs a mandatory checkbox at registration.
- **Polityka Prywatności (Privacy Policy):** RODO Art. 13 information notice. Covers: what data, why, legal basis, user rights, retention, UODO complaint right. Needs to be linked/visible at registration, no checkbox required.

Both must be in Polish. Both can be short, plain-language documents for a simple app.

## Open Questions

1. **Regulamin content:** What should the Terms of Service contain for MevoStats? This is a civil law question, not RODO — may need a basic template or legal consultation.
2. **Hosting provider DPA:** Which hosting providers are used in production? Need to verify DPA availability for each.
3. **Third-country transfers:** Does any data leave the EEA? Depends on hosting (Mikr.us is Poland-based; Supabase may route through US). This affects privacy policy content.
4. **Backup retention policy:** What is the actual backup retention period? Needs to be documented and stated in the privacy policy.

## Sources

- [Art. 6 GDPR — Lawfulness of processing](https://gdpr-info.eu/art-6-gdpr/)
- [EDPB Guidelines 2/2019 on Art. 6(1)(b) — Contractual Necessity](https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines-art_6-1-b-adopted_after_public_consultation_en.pdf)
- [Art. 13 GDPR — Information to be provided](https://gdpr-info.eu/art-13-gdpr/)
- [Art. 17 GDPR — Right to erasure](https://gdpr-info.eu/art-17-gdpr/)
- [Art. 20 GDPR — Right to data portability](https://gdpr-info.eu/art-20-gdpr/)
- [Art. 30 GDPR — Records of processing activities](https://gdpr-info.eu/art-30-gdpr/)
- [Art. 33 GDPR — Data breach notification](https://gdpr-info.eu/art-33-gdpr/)
- [Art. 83 GDPR — Conditions for fines](https://gdpr-info.eu/art-83-gdpr/)
- [Rejestrowanie czynności przetwarzania — UODO](https://uodo.gov.pl/pl/383/214)
- [Zgłaszanie naruszeń — UODO](https://uodo.gov.pl/pl/525/2582)
- [Umowa jako podstawa przetwarzania — PARP](https://www.parp.gov.pl/component/content/article/81346)
- [Prawo telekomunikacyjne art. 173 — cookies](https://sjezierski.pl/prawo/rodo-a-pliki-cookies/)
- [Kary RODO 2024 — Grant Thornton](https://grantthornton.pl/publikacja/kto-placi-za-naruszenie-rodo-kary-pieniezne-nalozone-przez-prezesa-uodo-w-2024-r-raport/)
- [EDPB SME Guide — lawful processing](https://www.edpb.europa.eu/sme-data-protection-guide/process-personal-data-lawfully_en)
- [Obowiązkowe checkboxy w serwisie — prokonsumencki.pl](https://prokonsumencki.pl/blog/obowiazkowe-checkboxy-w-kazdym-sklepie/)
- [Cookie consent exemptions — CookieYes](https://www.cookieyes.com/blog/cookie-consent-exemption-for-strictly-necessary-cookies/)
