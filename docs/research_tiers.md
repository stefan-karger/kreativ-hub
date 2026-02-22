## Gesamtplan: Billing/Plans/Overrides + Limits in TanStack Start (Solid) + Drizzle (Postgres) + better-auth (Admin/Org/Polar)

Ziel: **Free/Pro/Max** pro User, **Admin kann alles**, **manuelle Hochstufung** über Overrides, **Polar** als Billing-Source-of-Truth (über better-auth Polar Plugin), **Org** ist primär Datenraum/Access-Control (keine eigenen Pläne in v1), **Limits** (z.B. Locations 10/100/unbegrenzt) sauber prüfbar (UI + serverseitig).

---

# 0) Leitentscheidungen (festgezurrt)

### Plan-Logik (Hybrid)

Reihenfolge für _effective tier_:

1. **Admin role** (`user.role` enthält `admin`) ⇒ immer `max`
2. **Aktiver Override** (`plan_override`) ⇒ Override-Tier
3. **Assignment** (`plan_assignment`) ⇒ `free|pro|max`

**Best practice Trennung:**

- `plan_assignment` ist **starr**: nur `system|polar` (automatisch), **nie manuell** überschreiben.
- `plan_override` ist **manuell** (Support/Admin), optional temporär (`endsAt`) & revokebar.

### Free default

**Immer** ein `plan_assignment` (free) bei User-Erstellung anlegen (kein “kein Eintrag = free”), um Special-Cases zu vermeiden.

### Org vs User Billing

v1: **Plan ist user-scoped**, Org ist Datenraum/ACL.
→ Mehrere User in gleicher Org können verschiedene Pläne haben.
→ “Invite senden” ist plan-basiert: Free darf nicht einladen.

---

# 1) DB/Drizzle Schema (nur deine Zusatz-Tabellen)

> better-auth erzeugt seine Core-Tabellen selbst (user/session/account/verification etc.) + Org-Tabellen. Du ergänzt nur Plan/Override (+ optional usage counter).

## 1.1 Enums & Tables

```ts
// db/schema/billing.ts
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
  integer,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const subjectTypeEnum = pgEnum("subject_type", ["user", "organization"]);
export const planTierEnum = pgEnum("plan_tier", ["free", "pro", "max"]);
export const planSourceEnum = pgEnum("plan_source", ["system", "polar"]); // starr

// (optional) Polar product->tier mapping
export const polarProductMap = pgTable(
  "polar_product_map",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    polarProductId: text("polar_product_id").notNull(),
    slug: text("slug"),
    tier: planTierEnum("tier").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    polarProductIdUx: uniqueIndex("polar_product_map_polar_product_id_ux").on(
      t.polarProductId,
    ),
    slugUx: uniqueIndex("polar_product_map_slug_ux").on(t.slug),
  }),
);

// Current + history via effectiveTo; exactly one current row
export const planAssignment = pgTable(
  "plan_assignment",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    subjectType: subjectTypeEnum("subject_type").notNull(),
    subjectId: text("subject_id").notNull(), // user.id or organization.id (strings)

    tier: planTierEnum("tier").notNull().default("free"),
    source: planSourceEnum("source").notNull().default("system"),

    polarProductId: text("polar_product_id"),
    polarSubscriptionId: text("polar_subscription_id"),
    status: text("status"),

    effectiveFrom: timestamp("effective_from", { withTimezone: true })
      .notNull()
      .defaultNow(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),

    reason: text("reason"), // e.g. "initial_free", "polar_webhook_update"
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    subjectLookupIx: index("plan_assignment_subject_lookup_ix").on(
      t.subjectType,
      t.subjectId,
    ),
    currentOnlyUx: uniqueIndex("plan_assignment_current_only_ux")
      .on(t.subjectType, t.subjectId)
      .where(sql`${t.effectiveTo} is null`),
  }),
);

// Manual override: wins over assignment; can expire/revoke
export const planOverride = pgTable(
  "plan_override",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    subjectType: subjectTypeEnum("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    tier: planTierEnum("tier").notNull(),

    startsAt: timestamp("starts_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByUserId: text("revoked_by_user_id"),

    createdByUserId: text("created_by_user_id").notNull(),
    reason: text("reason"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    subjectLookupIx: index("plan_override_subject_lookup_ix").on(
      t.subjectType,
      t.subjectId,
    ),
    activeOnlyUx: uniqueIndex("plan_override_active_only_ux")
      .on(t.subjectType, t.subjectId)
      .where(
        sql`${t.revokedAt} is null and (${t.endsAt} is null or ${t.endsAt} > now())`,
      ),
  }),
);

// Optional “no-race” quota counter (recommended for robust limits)
export const usageCounter = pgTable(
  "usage_counter",
  {
    id: text("id").primaryKey(), // `${userId}:${orgId}:${resource}`
    userId: text("user_id").notNull(),
    orgId: text("org_id").notNull(),
    resource: text("resource").notNull(), // "locations" etc.
    used: integer("used").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    ux: uniqueIndex("usage_counter_ux").on(t.userId, t.orgId, t.resource),
  }),
);
```

---

# 2) better-auth Integration

## 2.1 Hook: On user create ⇒ create FREE planAssignment

**Zweck:** Garantie, dass `plan_assignment` immer einen aktuellen Eintrag hat.

```ts
// auth.ts (sketch)
import { betterAuth } from "better-auth";
import { db } from "~/db";
import { planAssignment } from "~/db/schema/billing";

export const auth = betterAuth({
  // plugins: admin(), organization(), polar(...)

  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await db
            .insert(planAssignment)
            .values({
              subjectType: "user",
              subjectId: user.id,
              tier: "free",
              source: "system",
              reason: "initial_free",
            })
            .onConflictDoNothing(); // relies on currentOnlyUx
        },
      },
    },
  },
});
```

---

# 3) Server-Layer (TanStack Start createServerFn)

## 3.1 Core helpers (server-only)

### `setCurrentPlan(...)`

**Zweck:** Setzt den aktuellen Plan (close current, insert new).
**Einsatz:** Polar Webhooks (upgrade/downgrade) + system maintenance.

```ts
// server/billing.server.ts
import { db } from "~/db";
import { planAssignment } from "~/db/schema/billing";
import { and, eq, isNull, sql, desc } from "drizzle-orm";

export async function setCurrentPlan(input: {
  subjectType: "user" | "organization";
  subjectId: string;
  tier: "free" | "pro" | "max";
  source: "system" | "polar";
  polarProductId?: string | null;
  polarSubscriptionId?: string | null;
  status?: string | null;
  reason?: string | null;
}) {
  await db
    .update(planAssignment)
    .set({ effectiveTo: sql`now()` })
    .where(
      and(
        eq(planAssignment.subjectType, input.subjectType),
        eq(planAssignment.subjectId, input.subjectId),
        isNull(planAssignment.effectiveTo),
      ),
    );

  await db.insert(planAssignment).values({
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    tier: input.tier,
    source: input.source,
    polarProductId: input.polarProductId ?? null,
    polarSubscriptionId: input.polarSubscriptionId ?? null,
    status: input.status ?? null,
    reason: input.reason ?? null,
  });
}

export async function getCurrentPlan(input: {
  subjectType: "user" | "organization";
  subjectId: string;
}) {
  return db.query.planAssignment.findFirst({
    where: and(
      eq(planAssignment.subjectType, input.subjectType),
      eq(planAssignment.subjectId, input.subjectId),
      isNull(planAssignment.effectiveTo),
    ),
  });
}

export async function getLastPlan(input: {
  subjectType: "user" | "organization";
  subjectId: string;
}) {
  return db.query.planAssignment.findFirst({
    where: and(
      eq(planAssignment.subjectType, input.subjectType),
      eq(planAssignment.subjectId, input.subjectId),
    ),
    orderBy: [desc(planAssignment.effectiveFrom)],
  });
}
```

### Override helpers

**Zweck:** Support/Admin Hochstufung (temporär, revokebar).

```ts
// server/override.server.ts
import { db } from "~/db";
import { planOverride } from "~/db/schema/billing";
import { and, eq, isNull, sql, desc } from "drizzle-orm";

export async function createOverride(input: {
  subjectType: "user" | "organization";
  subjectId: string;
  tier: "free" | "pro" | "max";
  createdByUserId: string;
  reason?: string | null;
  endsAt?: Date | null;
}) {
  // revoke existing active override for simplicity
  await db
    .update(planOverride)
    .set({ revokedAt: sql`now()`, revokedByUserId: input.createdByUserId })
    .where(
      and(
        eq(planOverride.subjectType, input.subjectType),
        eq(planOverride.subjectId, input.subjectId),
        isNull(planOverride.revokedAt),
        sql`(${planOverride.endsAt} is null or ${planOverride.endsAt} > now())`,
      ),
    );

  await db.insert(planOverride).values({
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    tier: input.tier,
    createdByUserId: input.createdByUserId,
    reason: input.reason ?? null,
    endsAt: input.endsAt ?? null,
  });
}

export async function getActiveOverride(input: {
  subjectType: "user" | "organization";
  subjectId: string;
}) {
  return db.query.planOverride.findFirst({
    where: and(
      eq(planOverride.subjectType, input.subjectType),
      eq(planOverride.subjectId, input.subjectId),
      isNull(planOverride.revokedAt),
      sql`(${planOverride.endsAt} is null or ${planOverride.endsAt} > now())`,
    ),
    orderBy: [desc(planOverride.startsAt)],
  });
}
```

### `getEffectiveTierForUser(userId)`

**Zweck:** Single source of truth fürs Feature-Gating.
**Einsatz:** überall, wo du planabhängig prüfst (Invites, Limits, Exporte, …).

```ts
// server/tier.server.ts
import { getActiveOverride } from "./override.server";
import { getCurrentPlan } from "./billing.server";

export async function isAdminUser(userId: string): Promise<boolean> {
  // TODO: read user via better-auth adapter/db and check user.role contains "admin"
  return false;
}

export async function getEffectiveTierForUser(
  userId: string,
): Promise<"free" | "pro" | "max"> {
  if (await isAdminUser(userId)) return "max";

  const ov = await getActiveOverride({
    subjectType: "user",
    subjectId: userId,
  });
  if (ov) return ov.tier;

  const plan = await getCurrentPlan({ subjectType: "user", subjectId: userId });
  return plan?.tier ?? "free"; // should rarely happen due to onCreate seed
}
```

---

## 3.2 TanStack Start ServerFns

### Plan read (last/current)

**Zweck:** UI/Admin-Panel & Debug (welcher Plan gilt aktuell/zuletzt?)

```ts
// server/billing.functions.ts
import { createServerFn } from "@tanstack/solid-start";
import { z } from "zod";
import { getLastPlan } from "./billing.server";

export const getLastPlanByUserIdFn = createServerFn({ method: "GET" })
  .validator(z.object({ userId: z.string() }))
  .handler(async ({ data }) => {
    return getLastPlan({ subjectType: "user", subjectId: data.userId });
  });
```

### Override set/check

**Zweck:** Admin Support-Tooling.

```ts
import { createServerFn } from "@tanstack/solid-start";
import { z } from "zod";
import { createOverride, getActiveOverride } from "./override.server";

export const createOverrideFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      subjectType: z.enum(["user", "organization"]),
      subjectId: z.string(),
      tier: z.enum(["free", "pro", "max"]),
      reason: z.string().nullable().optional(),
      endsAt: z.coerce.date().nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const adminUserId = "TODO_FROM_SESSION";
    // TODO: require admin
    await createOverride({ ...data, createdByUserId: adminUserId });
    return { ok: true };
  });

export const checkOverrideFn = createServerFn({ method: "GET" })
  .validator(
    z.object({
      subjectType: z.enum(["user", "organization"]),
      subjectId: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    return getActiveOverride(data);
  });
```

---

# 4) TanStack Query `queryOptions` (Solid)

**Zweck:** konsistente QueryKeys + typed queries.

```ts
// utils/billing.queries.ts
import { queryOptions } from "@tanstack/solid-query";
import {
  getLastPlanByUserIdFn,
  checkOverrideFn,
} from "~/server/billing.functions";

export const lastPlanByUserIdQuery = (userId: string) =>
  queryOptions({
    queryKey: ["billing", "plan", "last", { userId }] as const,
    queryFn: () => getLastPlanByUserIdFn({ data: { userId } }),
    staleTime: 30_000,
  });

export const activeOverrideQuery = (
  subjectType: "user" | "organization",
  subjectId: string,
) =>
  queryOptions({
    queryKey: [
      "billing",
      "override",
      "active",
      { subjectType, subjectId },
    ] as const,
    queryFn: () => checkOverrideFn({ data: { subjectType, subjectId } }),
    staleTime: 10_000,
  });
```

---

# 5) Polar (better-auth Polar Plugin) → PlanAssignment Sync

**Zweck:** Polar ist Billing-Source-of-Truth. Webhooks setzen Plan automatisch.

## TODOs

1. Polar Plugin konfigurieren (checkout + portal + webhooks).
2. In Webhook Hooks: `syncTierFromPolarPayload(...)` aufrufen.
3. In `syncTier...`:
   - subject bestimmen (v1: userId)
   - aktives Produkt → tier map (`polar_product_map` oder config)
   - `setCurrentPlan(... source="polar")`
   - Downgrade erst wenn wirklich beendet (Period-End beachten)

> Für v1 kannst du **nur user** syncen; `subjectType="organization"` bleibt unbenutzt, ist aber future-proof.

---

# 6) Limits / Quotas (z.B. Locations 10/100/unlimited)

Du willst:

- UI: “Add Location” Button deaktivieren + remaining anzeigen
- Server: Insert muss Limit enforce’n
- Optional: race-safe

## 6.1 Plan → Limit mapping

```ts
// server/limits.ts
export const LIMITS = {
  locations: { free: 10, pro: 100, max: Infinity },
} as const;

export function locationLimit(tier: "free" | "pro" | "max") {
  return LIMITS.locations[tier];
}
```

## 6.2 Variante A (simpel): COUNT(\*) pro user/org (ok für MVP)

### Count helper

```ts
// server/location.server.ts
import { db } from "~/db";
import { locations } from "~/db/schema/locations";
import { and, eq, sql } from "drizzle-orm";

export async function countUserLocationsInOrg(userId: string, orgId: string) {
  const res = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(locations)
    .where(
      and(
        eq(locations.organizationId, orgId),
        eq(locations.createdByUserId, userId),
      ),
    );
  return res[0]?.count ?? 0;
}
```

### ServerFn: canCreate (UI check)

**Zweck:** UI-Enable/Disable + Anzeige “remaining”.

```ts
// server/location.functions.ts
import { createServerFn } from "@tanstack/solid-start";
import { z } from "zod";
import { countUserLocationsInOrg } from "./location.server";
import { getEffectiveTierForUser } from "./tier.server";
import { locationLimit } from "./limits";

export const canCreateLocationFn = createServerFn({ method: "GET" })
  .validator(z.object({ orgId: z.string() }))
  .handler(async ({ data }) => {
    const userId = "TODO_FROM_SESSION";
    const tier = await getEffectiveTierForUser(userId);
    const limit = locationLimit(tier);
    const used = await countUserLocationsInOrg(userId, data.orgId);

    return {
      tier,
      limit: Number.isFinite(limit) ? limit : null,
      used,
      remaining: Number.isFinite(limit) ? Math.max(0, limit - used) : null,
      canCreate: used < limit,
    };
  });
```

### ServerFn: createLocation (hard enforce!)

**Zweck:** Security & korrekte Limits.

```ts
import { createServerFn } from "@tanstack/solid-start";
import { z } from "zod";
import { db } from "~/db";
import { locations } from "~/db/schema/locations";
import { getEffectiveTierForUser } from "./tier.server";
import { locationLimit } from "./limits";
import { countUserLocationsInOrg } from "./location.server";

export const createLocationFn = createServerFn({ method: "POST" })
  .validator(z.object({ orgId: z.string(), name: z.string().min(1) }))
  .handler(async ({ data }) => {
    const userId = "TODO_FROM_SESSION";
    const tier = await getEffectiveTierForUser(userId);
    const limit = locationLimit(tier);

    if (Number.isFinite(limit)) {
      const used = await countUserLocationsInOrg(userId, data.orgId);
      if (used >= limit) throw new Error("LIMIT_REACHED:locations");
    }

    const [row] = await db
      .insert(locations)
      .values({
        organizationId: data.orgId,
        createdByUserId: userId,
        name: data.name,
      })
      .returning();

    return row;
  });
```

## 6.3 Variante B (best practice robust): usageCounter + row lock (no race)

**Zweck:** verhindert “2 Tabs gleichzeitig → Limit überschritten”.

```ts
// server/location.quota.server.ts
import { db } from "~/db";
import { usageCounter } from "~/db/schema/billing";
import { locations } from "~/db/schema/locations";
import { and, eq, sql } from "drizzle-orm";
import { getEffectiveTierForUser } from "./tier.server";
import { locationLimit } from "./limits";

export async function createLocationWithQuota(
  userId: string,
  orgId: string,
  name: string,
) {
  const tier = await getEffectiveTierForUser(userId);
  const limit = locationLimit(tier);

  return db.transaction(async (tx) => {
    await tx
      .insert(usageCounter)
      .values({
        id: `${userId}:${orgId}:locations`,
        userId,
        orgId,
        resource: "locations",
        used: 0,
      })
      .onConflictDoNothing();

    const locked = await tx.execute(sql`
      SELECT used
      FROM usage_counter
      WHERE user_id = ${userId} AND org_id = ${orgId} AND resource = 'locations'
      FOR UPDATE
    `);

    const used = Number(locked.rows[0]?.used ?? 0);

    if (Number.isFinite(limit) && used >= limit)
      throw new Error("LIMIT_REACHED:locations");

    await tx
      .update(usageCounter)
      .set({
        used: sql`${usageCounter.used} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(usageCounter.userId, userId),
          eq(usageCounter.orgId, orgId),
          eq(usageCounter.resource, "locations"),
        ),
      );

    const [loc] = await tx
      .insert(locations)
      .values({
        organizationId: orgId,
        createdByUserId: userId,
        name,
      })
      .returning();

    return loc;
  });
}
```

> Empfehlung: Wenn du schon weißt, dass Limits wichtig sind → nimm B.

---

# 7) Invite-Regel (Free darf keine Invites senden)

**Zweck:** Monetarisierter Team-Flow trotz “Org nur ACL”.

Implementiere eine `canInviteToOrg(userId, orgId)` Prüfung:

- Org-RBAC: user ist owner/admin (Org Plugin)
- Tier: effectiveTier(user) >= pro

(Implementierung hängt davon ab, wie du Org membership aus better-auth liest, aber die Logik ist genau diese.)

---

# 8) Reihenfolge der Implementierung (ToDos / Sprint Plan)

## Sprint 1: DB + Seed + Auth hooks

- [ ] Drizzle schema hinzufügen: `plan_assignment`, `plan_override`, optional `polar_product_map`, optional `usage_counter`
- [ ] Migrationen laufen lassen
- [ ] better-auth `databaseHooks.user.create.after` implementieren (FREE seed)
- [ ] `getEffectiveTierForUser` helper implementieren (admin → override → assignment)

## Sprint 2: Admin Support Tools

- [ ] ServerFns: `createOverrideFn`, `checkOverrideFn`, `getLastPlanByUserIdFn`
- [ ] Admin UI (simple):
  - [ ] Override setzen (tier + optional endsAt + reason)
  - [ ] aktuellen Plan + active override anzeigen

## Sprint 3: Polar Billing Sync

- [ ] Polar Plugin konfigurieren (checkout/portal/webhooks)
- [ ] `polar_product_map` seed (productId→tier)
- [ ] `syncTierFromPolarPayload` implementieren:
  - [ ] active sub/product → tier bestimmen
  - [ ] `setCurrentPlan(... source="polar")`
  - [ ] korrektes downgrade timing (period end)

- [ ] Logging + idempotenz (optional extra table `webhook_event` falls nötig)

## Sprint 4: Limits (Locations)

- [ ] `canCreateLocationFn` (UI check)
- [ ] `createLocationFn` (server enforce)
- [ ] Optional upgrade auf Counter-Variante B für Race-Safety
- [ ] UI: “Add Location” disabled + remaining anzeigen + Upgrade CTA bei `LIMIT_REACHED`

## Sprint 5: Polishing & Consistency

- [ ] Standardisierte Errors (`LIMIT_REACHED`, `FORBIDDEN_TIER`, `NOT_ORG_ADMIN`) + UI Mapping
- [ ] Query invalidation: nach Create Location `invalidate(["locations","canCreate",...])`
- [ ] Unit/Integration tests für tier resolution & limits

---

# 9) Was du am Ende hast

- **Deterministische** Tier-Auflösung (Admin/Override/Assignment)
- **Kein Chaos** zwischen “manuell” und “billing”: Override ist die einzige manuelle Schicht
- **Garantierter FREE default** bei Registrierung
- **Polar automatisiert** Up/Down-grades
- **Limits** sauber (UI + server) und optional race-safe
- Org bleibt **Access-Control/Data grouping** ohne Org-Billing – aber DB ist future-proof, falls du später Org-Plan willst

Wenn du willst, baue ich dir als nächsten Schritt die fehlenden Teile “komplett verdrahtet”:

- `syncTierFromPolarPayload` (mit konkretem Mapping/Payload-Annahme)
- `requireSession()` / `requireAdmin()` helper für TanStack Start
- `canInviteToOrg()` inkl. Org Plugin queries und Tier-Check.

# 10) Links

- Admin Plugin: https://www.better-auth.com/docs/plugins/admin.mdx
- Org Plugin: https://www.better-auth.com/docs/plugins/organization.mdx
- Polar Plugin: https://www.better-auth.com/docs/plugins/polar.mdx
- Tanstack Queryoptionen: https://tanstack.com/query/v5/docs/framework/solid/guides/query-options.md?framework=solid&pm=pnpm
- Tanstack Serverfunktionen: https://tanstack.com/start/latest/docs/framework/solid/guide/server-functions.md?framework=solid&pm=pnpm
- Beispiel Kombi Serverfunktion / Queryoptionen: https://raw.githubusercontent.com/TanStack/router/refs/heads/main/examples/solid/start-basic-solid-query/src/utils/posts.tsx
