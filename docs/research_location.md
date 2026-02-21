# Zusammenfassung: Location-Management Plattform (Org-basiert) – inkl. Beispiele & Schema

## 1) Produktidee & Scope

Du baust ein **internes Location-Katalogsystem pro Organisation** (Fotograf/Videograf/Agentur/Prod).
Kein Marktplatz: Nutzer pflegen **ihre eigenen Locations**, Kunden/Client wählen daraus oder Agenturen geben an Clients weiter.

Kernanforderungen:

- **Multi-Tenant / DSGVO**: Daten strikt pro `organizationId`
- **Collaboration**: mehrere User in einer Org arbeiten an denselben Datensätzen
- **Schnelle Suche & Filter**: Karte/Radius, Tags/Taxonomie, technische Features
- **Audit/Activity**: “wer hat was wann gemacht?”

Stack:

- TanStack Start (Router/Server Functions)
- SolidJS + solid-ui
- Drizzle ORM
- better-auth (Auth/Organizations)

---

## 2) Datenmodell-Kernelemente

### Location (Haupt-Entity)

**Pflicht**: Name, Koordinaten optional aber sehr wichtig (Map/Distance).
**Adresse**: optional + “addressVisible” (exakte Adresse ggf. verborgen).

DB-Überlegungen:

- `lat/lng` DECIMAL(9,6)
- Index auf `(organizationId)` und optional `(lat,lng)` für Geo-Filter.

### Bilder

Separate Tabelle `location_images`:

- url, width/height, sort, cover
  Storage Empfehlung:
- S3-kompatibel (z.B. Hetzner Object Storage) + CDN
- Thumbnails/Optimierung (WebP/AVIF)
- Limits: z.B. 10–30 Bilder / Location, max 10MB, jpg/png/webp

### Tags/Taxonomie (Style/Mood/Palette/Texture/General)

Wichtigste Entscheidung:

- **Canonical tags in Englisch** speichern (z.B. `industrial`, `cozy`).
- UI kann **lokalisiert** anzeigen.

Tag-Kategorien als DB-Enum:

- `tag_type`: `style | mood | palette | texture | general`

**Warum nicht alles als Enum?**

- Tag-Namen sind Daten, wachsen/ändern sich → lieber Tabelle + Join.

### Tag-Translations (i18n für Tag-Anzeige)

Option: `tag_translations(tagId, locale, label, description)`
Locale bleibt `varchar` (kein Enum), damit später beliebige Sprachen möglich sind.

### Pricing

DB-Enum:

- `pricing_type`: `hourly | daily | project`

Relational statt JSON:

- `location_pricing`
- `location_pricing_includes` (z.B. Strom/WC/Parkplatz)
- `location_pricing_additional` (z.B. Reinigung 50€)

### Availability / Öffnungszeiten

`location_availability`:

- always
- bookingRequired
- noticeDays
- **timeZone** (IANA, z.B. `Europe/Berlin`) → sinnvoll für Internationalisierung

Opening hours:

- ISO 8601 day-of-week: **1=Mo … 7=So**
- `openTime`, `closeTime` (TIME)

Exceptions:

- Datum + note

---

## 3) Enums: wann nutzen, wann flexibel?

### Enums sinnvoll wenn…

- Werte **system-definiert** und stabil sind
- starke Datenintegrität nötig ist
- eng mit Business-Logik verzahnt

✅ bei dir: `pricing_type`, `tag_type`, Access Level, grobe Activity-Enums

### Flexibel wenn…

- Werte wachsen/häufig ändern
- org-spezifisch werden können
- “Content” statt “System”

❌ bei dir: Tag-Namen, locale, timezone

**Wichtig:** Postgres ENUMs sind echte DB-Types → Änderungen = Migration.

---

## 4) Access Level (Location Zugänglichkeit)

Canonical Werte (englisch), UI Übersetzung über i18n.

DB-Enum `access_level` (Beispiel):

- public_free
- public_permit
- private_invite
- private_contract
- restricted_sensitive

UI Mapping (DE/EN) via i18n-Keys:

- `access.public_free` → DE “Öffentlich (frei zugänglich)” / EN “Public (free access)”

---

## 5) Audit vs. Activity Log

### Audit-Felder (created/updated by/at)

Auf **Business-Entities** sinnvoll, nicht zwingend auf Join-Tabellen.

### Soft Delete (Alltag/Restore)

Für Business-Entities:

- isDeleted
- deletedAt
- deletedBy
- optional deleteReason

Soft delete empfohlen für:

- locations
- location_contacts
- location_pricing
- später: models, projects, clients, brands

Hard delete reicht für:

- opening hours
- availability exceptions
- pricing includes/additional
- location_tags
- images (meist hard delete; optional trash später)

---

## 6) DSGVO: Anonymize statt zerstören

Für personenbezogene Entities (z.B. models, person contacts):

- `isAnonymized`, `anonymizedAt`, `anonymizedBy`
- PII überschreiben/nullen (Name → “Anonymized …”, email/phone/address → NULL)
- Beziehungen bleiben (IDs bleiben), Auswertungen brechen nicht.
- Assets/Portraits ggf. löschen.

**Activity Log PII-Regel:** keine persönlichen Daten in `detail/meta` speichern
(sonst müsstest du Logs ebenfalls scrubben).

---

## 7) Zentrales Activity Log (org-weit) – Best Practice

Statt pro Modul eigene Tabelle: **eine zentrale Tabelle**.

### Konzept

- `context`: Parent-Kontext fürs UI (z.B. Location Detail Feed)
- `subject`: konkret betroffene Entity/Row
- `action`: grob (created/updated/…)
- `detail` (Text, PII-frei)
- `meta` (jsonb, PII-frei)

**Warum context/subject?**

- Detailseiten filtern schnell nach context
- trotzdem genaue Referenz auf betroffene Row

### Beispiel Insert (Drizzle)

```ts
await db.insert(activityLog).values({
  organizationId: session.orgId,
  actorUserId: session.userId,
  action: "updated",
  context: "location",
  contextId: locationId,
  subject: "location_pricing",
  subjectId: pricingId,
  detail: "Pricing aktualisiert",
  meta: { field: "amount", from: "120.00", to: "150.00", currency: "EUR" },
});
```

### Typesafety / Autocomplete

Mit `pgEnum()` bekommst du:

- TS Union Types → Autocomplete
- Compiler error bei ungültigen Werten
- bei Enum-Änderungen fallen kaputte Stellen sofort auf

---

## 8) UI/UX Best Practices für Activity Zugriff

Empfohlenes Pattern:

- **Sidebar Punkt “Aktivität”** (globaler Org-Feed)
- **zusätzlich in Entity-Details** (Location/Project/Client) ein Tab “Aktivität”
- User-Menü eher für Settings/Profil, nicht primär für Activity

Praktisches UX:

- Location Detail zeigt letzte 10–20 Events + “Mehr” Link → globaler Feed mit Filter preset.

---

## 9) i18n in TanStack Start + Solid

Best practice:

- UI DE/EN anbieten, später erweiterbar
- Locale serverseitig bestimmen (Cookie → Accept-Language fallback), sonst Hydration-Probleme
- Lib: `@solid-primitives/i18n`
  - [https://primitives.solidjs.community/package/i18n/](https://primitives.solidjs.community/package/i18n/)

- TanStack Start SSR/Hydration Hinweis:
  - [https://tanstack.com/start/latest/docs/framework/solid/guide/hydration-errors](https://tanstack.com/start/latest/docs/framework/solid/guide/hydration-errors)

- Drizzle Docs:
  - [https://orm.drizzle.team/](https://orm.drizzle.team/)

- PostgreSQL ENUM:
  - [https://www.postgresql.org/docs/current/datatype-enum.html](https://www.postgresql.org/docs/current/datatype-enum.html)

---

# Aktueller Schema Vorschlag (Drizzle / Postgres)

> Hinweis: FKs sind hier bewusst nicht überall gesetzt (z.B. im activity log), damit deletes/anonymize nicht blockieren. In den Domain-Tabellen kannst du natürlich FKs ergänzen, wenn du strikt referenziell bleiben willst.

```ts
import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  decimal,
  integer,
  timestamp,
  time,
  date,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/* =========================
   ENUMS
========================= */

export const tagTypeEnum = pgEnum("tag_type", [
  "style",
  "mood",
  "palette",
  "texture",
  "general",
]);

export const pricingTypeEnum = pgEnum("pricing_type", [
  "hourly",
  "daily",
  "project",
]);

export const accessLevelEnum = pgEnum("access_level", [
  "public_free",
  "public_permit",
  "private_invite",
  "private_contract",
  "restricted_sensitive",
]);

export const activityActionEnum = pgEnum("activity_action", [
  "created",
  "updated",
  "deleted",
  "restored",
  "added",
  "removed",
  "uploaded",
  "cover_changed",
  "status_changed",
]);

export const activityContextEnum = pgEnum("activity_context", [
  "location",
  "project",
  "client",
  "brand",
  "model",
  "asset",
]);

export const activitySubjectEnum = pgEnum("activity_subject", [
  // location domain
  "location",
  "location_image",
  "location_pricing",
  "location_pricing_include",
  "location_pricing_additional",
  "location_contact",
  "location_availability",
  "location_opening_hours",
  "location_availability_exception",
  "location_tag",

  // future domains
  "project",
  "client",
  "brand",
  "model",
  "asset",
]);

/* =========================
   CORE: LOCATIONS
========================= */

/** LOCATIONS — Org-gebundene Locations (Business Entity, Soft Delete empfohlen) */
export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),

    name: varchar("name", { length: 150 }).notNull(),
    shortDescription: text("short_description"),
    description: text("description"),

    country: varchar("country", { length: 100 }),
    city: varchar("city", { length: 100 }),
    postalCode: varchar("postal_code", { length: 20 }),
    address: varchar("address", { length: 150 }),

    lat: decimal("lat", { precision: 9, scale: 6 }),
    lng: decimal("lng", { precision: 9, scale: 6 }),

    addressVisible: boolean("address_visible").default(false).notNull(),
    accessLevel: accessLevelEnum("access_level")
      .default("private_invite")
      .notNull(),

    // Audit
    createdBy: uuid("created_by").notNull(),
    updatedBy: uuid("updated_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at"),

    // Soft Delete
    isDeleted: boolean("is_deleted").default(false).notNull(),
    deletedAt: timestamp("deleted_at"),
    deletedBy: uuid("deleted_by"),
    deleteReason: text("delete_reason"),
  },
  (t) => ({
    orgIdx: index("locations_org_idx").on(t.organizationId),
    geoIdx: index("locations_geo_idx").on(t.lat, t.lng),
  }),
);

/** LOCATION_IMAGES — Bilder zu Locations (meist hard delete ok) */
export const locationImages = pgTable(
  "location_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id").notNull(),

    url: text("url").notNull(),
    width: integer("width"),
    height: integer("height"),
    orderIndex: integer("order_index").default(0).notNull(),
    isCover: boolean("is_cover").default(false).notNull(),

    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    locIdx: index("location_images_location_idx").on(t.locationId),
  }),
);

/* =========================
   TAGS & TRANSLATIONS
========================= */

/** TAGS — Canonical taxonomie (name = english key) */
export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: tagTypeEnum("type").notNull(),
    name: varchar("name", { length: 100 }).notNull(),
  },
  (t) => ({
    uniqTypeName: uniqueIndex("tags_type_name_uniq").on(t.type, t.name),
  }),
);

/** TAG_TRANSLATIONS — UI Labels pro Locale (varchar: "de", "en", ...) */
export const tagTranslations = pgTable(
  "tag_translations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tagId: uuid("tag_id").notNull(),
    locale: varchar("locale", { length: 12 }).notNull(),
    label: varchar("label", { length: 120 }).notNull(),
    description: text("description"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at"),
  },
  (t) => ({
    uniq: uniqueIndex("tag_translations_uniq").on(t.tagId, t.locale),
    tagIdx: index("tag_translations_tag_idx").on(t.tagId),
    localeIdx: index("tag_translations_locale_idx").on(t.locale),
  }),
);

/** LOCATION_TAGS — m:n Zuordnung (hard delete ok) */
export const locationTags = pgTable(
  "location_tags",
  {
    locationId: uuid("location_id").notNull(),
    tagId: uuid("tag_id").notNull(),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("location_tags_uniq").on(t.locationId, t.tagId),
    locIdx: index("location_tags_location_idx").on(t.locationId),
    tagIdx: index("location_tags_tag_idx").on(t.tagId),
  }),
);

/* =========================
   CONTACTS (Business Entity, Soft Delete)
========================= */

/** LOCATION_CONTACTS — Ansprechpartner (Soft Delete empfohlen) */
export const locationContacts = pgTable(
  "location_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id").notNull(),

    name: varchar("name", { length: 120 }).notNull(),
    role: varchar("role", { length: 80 }),
    phone: varchar("phone", { length: 50 }),
    email: varchar("email", { length: 254 }),
    isPublic: boolean("is_public").default(false).notNull(),

    createdBy: uuid("created_by").notNull(),
    updatedBy: uuid("updated_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at"),

    isDeleted: boolean("is_deleted").default(false).notNull(),
    deletedAt: timestamp("deleted_at"),
    deletedBy: uuid("deleted_by"),
    deleteReason: text("delete_reason"),
  },
  (t) => ({
    locIdx: index("location_contacts_location_idx").on(t.locationId),
  }),
);

/* =========================
   PRICING (Business Entity, Soft Delete)
========================= */

/** LOCATION_PRICING — Pricing Model + Amount (Soft Delete empfohlen) */
export const locationPricing = pgTable(
  "location_pricing",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id").notNull(),

    type: pricingTypeEnum("type").notNull(),
    amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).default("EUR").notNull(),

    createdBy: uuid("created_by").notNull(),
    updatedBy: uuid("updated_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at"),

    isDeleted: boolean("is_deleted").default(false).notNull(),
    deletedAt: timestamp("deleted_at"),
    deletedBy: uuid("deleted_by"),
    deleteReason: text("delete_reason"),
  },
  (t) => ({
    locIdx: index("location_pricing_location_idx").on(t.locationId),
  }),
);

/** PRICING_INCLUDES — Inklusive Leistungen (hard delete ok) */
export const locationPricingIncludes = pgTable(
  "location_pricing_includes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pricingId: uuid("pricing_id").notNull(),
    label: varchar("label", { length: 100 }).notNull(),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    pricingIdx: index("pricing_includes_pricing_idx").on(t.pricingId),
  }),
);

/** PRICING_ADDITIONAL — Zusatzkosten-Items (hard delete ok) */
export const locationPricingAdditional = pgTable(
  "location_pricing_additional",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pricingId: uuid("pricing_id").notNull(),
    item: varchar("item", { length: 120 }).notNull(),
    price: decimal("price", { precision: 10, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).default("EUR").notNull(),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    pricingIdx: index("pricing_additional_pricing_idx").on(t.pricingId),
  }),
);

/* =========================
   AVAILABILITY
========================= */

/** LOCATION_AVAILABILITY — Regeln + IANA time zone (meist updaten statt löschen) */
export const locationAvailability = pgTable(
  "location_availability",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    locationId: uuid("location_id").notNull(),

    always: boolean("always").default(false).notNull(),
    bookingRequired: boolean("booking_required").default(true).notNull(),
    noticeDays: integer("notice_days").default(0).notNull(),

    timeZone: varchar("time_zone", { length: 64 })
      .default("Europe/Berlin")
      .notNull(),

    createdBy: uuid("created_by").notNull(),
    updatedBy: uuid("updated_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at"),
  },
  (t) => ({
    uniqLoc: uniqueIndex("availability_location_uniq").on(t.locationId),
  }),
);

/** OPENING_HOURS — ISO day (1=Mo..7=So), hard delete ok */
export const locationOpeningHours = pgTable(
  "location_opening_hours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    availabilityId: uuid("availability_id").notNull(),

    isoDay: integer("iso_day").notNull(), // 1..7
    openTime: time("open_time"),
    closeTime: time("close_time"),

    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("opening_hours_uniq").on(t.availabilityId, t.isoDay),
    avIdx: index("opening_hours_availability_idx").on(t.availabilityId),
  }),
);

/** AVAILABILITY_EXCEPTIONS — Datum-Ausnahmen, hard delete ok */
export const locationAvailabilityExceptions = pgTable(
  "location_availability_exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    availabilityId: uuid("availability_id").notNull(),
    date: date("date").notNull(),
    note: text("note"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    uniq: uniqueIndex("availability_exceptions_uniq").on(
      t.availabilityId,
      t.date,
    ),
    avIdx: index("availability_exceptions_availability_idx").on(
      t.availabilityId,
    ),
  }),
);

/* =========================
   ACTIVITY LOG (GLOBAL)
========================= */

/** ACTIVITY_LOG — Org-weites Log (context+subject), PII-sparsam */
export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull(),
    actorUserId: uuid("actor_user_id").notNull(),

    action: activityActionEnum("action").notNull(),

    context: activityContextEnum("context").notNull(),
    contextId: uuid("context_id").notNull(),

    subject: activitySubjectEnum("subject").notNull(),
    subjectId: uuid("subject_id").notNull(),

    detail: text("detail"),
    meta: jsonb("meta"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => ({
    orgCreatedIdx: index("activity_log_org_created_idx").on(
      t.organizationId,
      t.createdAt,
    ),
    orgContextIdx: index("activity_log_org_context_idx").on(
      t.organizationId,
      t.context,
      t.contextId,
      t.createdAt,
    ),
    orgSubjectIdx: index("activity_log_org_subject_idx").on(
      t.organizationId,
      t.subject,
      t.subjectId,
      t.createdAt,
    ),
    orgActorIdx: index("activity_log_org_actor_idx").on(
      t.organizationId,
      t.actorUserId,
      t.createdAt,
    ),
  }),
);
```
