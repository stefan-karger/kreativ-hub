Für SaaS mit **Free/Pro/Max** ist die gängigste “Best Practice” nicht **entweder Polar ODER Rollen**, sondern ein **Hybrid**:

- **Billing-System (Polar) ist Source of Truth für Zahlstatus/Plan**
- **Deine App hält eine eigene, schnelle “Entitlements-/Plan-Snapshot”-Sicht** (DB) und macht daraus Feature-Gates + Limits
- **Admin-Overrides** werden **separat** modelliert (nicht als “Fake-Abo”)

Damit bekommst du: schnell, robust gegen Webhook-Ausfälle, auditierbar, und du kannst “manuell hochstufen” ohne Polar zu verbiegen.

---

## Option A: “Nur Polar checken” (bei jedem Request prüfen: paid? welcher Plan?)

### Vorteile

- **Ein System** als Wahrheit (weniger Daten-Duplikate).
- Weniger eigene Logik zu “Plan->Features”.

### Nachteile (in der Praxis schmerzhaft)

- **Latenz & Verfügbarkeit**: Du willst nicht bei _jeder_ API-Route/DB-Query erst Polar abfragen.
- **Asynchronität**: Subscription-Status ändert sich “von allein” (Renewals, Past due, Cancellations). Billing-Anbieter empfehlen explizit, das über **Webhooks** zu verarbeiten, weil viel asynchron passiert. ([Stripe-Dokumentation][1])
- **Admin-Hochstufung**: “gezielt hochstufen” ist dann entweder
  - ein Sonderfall überall im Code oder
  - du fängst an, Polar-Zustände zu “simulieren” (unschön/fehleranfällig).

**Kurz:** Als alleiniger Mechanismus okay für MVP, aber skaliert schlecht.

---

## Option B: “Rollen setzen, wenn Abo abgeschlossen/geupdated wird” (Webhook → User.role)

### Vorteile

- **Schnell**: Zugriffskontrolle ist ein DB-Read, keine externe API.
- **Sauberer App-Layer**: AuthZ/Feature-Gates sind lokal.
- Billing-Anbieter empfehlen grundsätzlich, Statusänderungen per Webhook zu handlen und lokal zu spiegeln. ([Stripe-Dokumentation][1])

### Nachteile

- **Rollen ≠ Plan**: RBAC (Admin/User/Org-Rollen) und Pricing-Pläne (Free/Pro/Max) sind unterschiedliche Konzepte. Wenn du das vermischst, wird es später schwer (z. B. Org-Rollen _und_ Plan _und_ Add-ons).
- Webhooks können **duplicated / delayed / out-of-order** kommen – du brauchst idempotente Verarbeitung. ([Stripe-Dokumentation][2])
- Du brauchst eine Strategie für **Grace Period** (“cancel_at_period_end”, “past_due” etc.). Polar beschreibt z. B. Cancellations als Sequenzen, und “canceled” kann noch Zugang bis Periodenende bedeuten. ([Polar][3])

**Kurz:** Grundrichtung richtig, aber “Plan als Role” ist langfristig unflexibel.

---

## Was andere Services typischerweise machen (Pattern)

**Pattern-Name:** _Entitlements / Plan Snapshot + RBAC separat_

- **RBAC**: “Wer darf was administrativ?” (Admin, Org-Owner, Org-Member etc.)
- **Entitlements**: “Welche Features/Limits sind freigeschaltet?” (Free/Pro/Max + ggf. Add-ons)
- **Billing**: liefert Events → aktualisiert Entitlements-Snapshot

Das passt auch zu better-auth:

- better-auth **Admin Plugin** bringt Rollen/Permissions für Admin-Operationen (z. B. `admin` Rolle) ([Better Auth][4])
- better-auth **Organization Plugin** bringt Org-Rollen (owner/admin/member) und Permission-Checks innerhalb eines Tenants ([Better Auth][5])
  Diese Rollen sind _nicht_ deine Pricing-Tiers – die sollten daneben existieren.

---

## Coupons/Rabattaktionen

Die kannst du problemlos **losgelöst in Polar** fahren:

- Polar hat Discounts mit Codes, Laufzeit/Redemptions/Zeitraum/Produkt-Einschränkungen usw. ([Polar][6])
  Deine App muss dafür i. d. R. nichts tun außer: Checkout-Link/Session erlauben, Code anwenden.

---

## Konkreter Implementierungsvorschlag (empfohlen)

### 1) Trenne sauber: **Admin/Org-Rollen** vs **Plan/Entitlements**

- better-auth:
  - `admin` Rolle = “darf alles / Superuser” (global) ([Better Auth][4])
  - Org-Rollen (owner/admin/member) für Team-/Tenant-Rechte ([Better Auth][5])

- Deine App-DB:
  - `plan` / `tier` = `free | pro | max`
  - `entitlements` = Features + Limits (z. B. max Locations, max Projekte, Team-Features, …)

### 2) Halte einen **Billing Snapshot** in Postgres (Drizzle)

Beispiel-Felder (minimal, aber robust):

- `billingCustomerId` (Polar customer)
- `billingSubscriptionId` (Polar subscription)
- `plan` (free/pro/max)
- `status` (active/trialing/past_due/canceled/… so wie Polar)
- `currentPeriodEnd` (wichtig für “Zugang bis Periodenende”)
- `updatedAt`

Polar liefert dafür passende Events:

- Für Subscriptions: `subscription.created`, `subscription.updated`, `subscription.canceled`, `subscription.revoked`, … ([Polar][3])
- Praktisch zusätzlich: `customer.state_changed` (“includes active subscriptions and granted benefits”) – super als “gesamtzustand neu berechnen”-Trigger. ([docs.polar.sh][7])

### 3) Webhook → **idempotent** snapshot aktualisieren → Entitlements ableiten

- Verifiziere Webhook-Signatur (Polar nutzt Standard Webhooks Spec inkl. Timestamp/Signatur; in deren Ökosystem wird genau das empfohlen) ([communitynodes.com][8])
- **Idempotenz**: speichere `event_id` und ignoriere Duplikate.
- **Out-of-order**: update nur, wenn `event.timestamp` neuer ist als dein Snapshot.

> Wichtig: Bei “cancel_at_period_end” ist Sub ggf. noch `active`, aber `cancel_at_period_end=true` (Polar beschreibt das explizit). D. h. Zugang erlauben bis `currentPeriodEnd`. ([Polar][3])

### 4) Admin “gezielt hochstufen” ohne Polar zu ändern

Mach es als **Override-Schicht**, z. B. Tabelle `planOverride`:

- `userId`
- `overridePlan` (pro/max)
- `startsAt`, `endsAt` (optional)
- `reason`, `createdByAdminId`
- `priority` / `isActive`

Entscheidungslogik:

1. Wenn `user.role` enthält `admin` → **treat as max** (wie von dir gewünscht)
2. Sonst wenn aktives Override → nutze Override-Plan
3. Sonst nutze Billing-Snapshot-Plan

Das ist sauber auditierbar und du kannst Aktionen wie “3 Monate Max als Entschädigung” machen.

### 5) Feature-Gating: nicht nur Plan, sondern **Entitlements**

Leite aus `plan` ein Set ab:

- boolean features (z. B. “Organizations”, “Advanced Search”, “Watermark Export”)
- numeric limits (z. B. max `locations`, max `projects`, max `models`, max Storage)

Das ist später extrem hilfreich, wenn Max nicht nur “alles”, sondern z. B. “höhere Limits” + einzelne Flags ist.

---

## Pros/Cons des empfohlenen Hybrids

### Stärken

- **Schnell & zuverlässig** im Alltag (DB read statt extern).
- **Saubere Domänen-Trennung**: RBAC bleibt RBAC, Billing bleibt Billing.
- **Admin-Hochstufung** ist ein First-Class-Feature (Audit, Ablaufdatum, Grund).
- **Weniger Coupling** an Polar: Plan-Definitionen kannst du ändern, ohne jede Route anzufassen.
- Umgang mit “asynchronen Realitäten” (renewals, past_due, revoke) ist standardisiert über Webhooks. ([Stripe-Dokumentation][1])

### Schwächen

- Mehr initiale Arbeit (Webhook-Handling, Snapshot-Tabellen, Idempotenz).
- Du musst klar definieren, welche Statuskombinationen Zugang geben (active + cancel_at_period_end etc.). Polar-Event-Sequenzen helfen dabei. ([Polar][3])

---

## Fazit (klare Empfehlung)

**Nimm Polar als Source of Truth fürs Billing, aber spiegle den Zustand in deiner DB und entscheide Zugriffe über einen lokalen “Entitlements Snapshot” + separate Admin-Overrides.**
Rollen (better-auth Admin/Organization) nutzt du für **“wer darf administrativ was”**, nicht für “wer hat Pro/Max”.

Wenn du willst, kann ich dir als nächsten Schritt ein konkretes **DB-Schema (Drizzle)** skizzieren (Tabellen + Indizes) und eine **Webhook-Handler-Struktur** (TanStack Start server route) inkl. Idempotenz-Pattern – passend zu deinem Stack (SolidJS + Drizzle + Postgres + better-auth).

[1]: https://docs.stripe.com/billing/subscriptions/webhooks?utm_source=chatgpt.com "Using webhooks with subscriptions | Stripe Documentation"
[2]: https://docs.stripe.com/get-started/checklist/go-live?utm_source=chatgpt.com "Go-live checklist | Stripe Documentation"
[3]: https://polar.sh/docs/integrate/webhooks/events?utm_source=chatgpt.com "Webhook Events - Polar"
[4]: https://www.better-auth.com/docs/plugins/admin?utm_source=chatgpt.com "Admin | Better Auth"
[5]: https://www.better-auth.com/docs/plugins/organization?utm_source=chatgpt.com "Organization | Better Auth"
[6]: https://polar.sh/docs/features/discounts?utm_source=chatgpt.com "Discounts - Polar"
[7]: https://docs.polar.sh/api-reference/webhooks?utm_source=chatgpt.com "customer.state_changed - Polar"
[8]: https://communitynodes.com/n8n-nodes-polar/?utm_source=chatgpt.com "Polar – Community Nodes"
