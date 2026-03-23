# EdCons OS

## Overview

EdCons OS is a production-ready SaaS for education consultancy businesses. It's a pnpm workspace monorepo using TypeScript, designed to streamline operations, manage leads, applications, students, and finances, and provide comprehensive tools for staff, agents, and students. The platform aims to be a complete operating system for consultancies, enhancing efficiency, improving client management, and facilitating growth in the education consultancy market.

## User Preferences

The user prefers a clean, intuitive UI/UX with a focus on role-based access and clear workflows. They value dynamic content management, such as configurable pipeline stages, and robust authentication with granular permission control. AI integration should be leveraged for efficiency gains, particularly in document processing and data extraction. The system should be scalable and maintainable, built with modern web technologies.

## System Architecture

The project is structured as a pnpm monorepo with separate packages for the API server, frontend, and shared libraries.

**Technical Stack:**
- **Monorepo:** pnpm workspaces
- **Node.js:** 24, TypeScript: 5.9
- **API:** Express 5
- **Database:** PostgreSQL with Drizzle ORM
- **Validation:** Zod
- **API Codegen:** Orval (from OpenAPI spec)
- **Frontend:** React, Vite, TailwindCSS, shadcn/ui, Framer Motion
- **Performance:** Route-level code splitting with React.lazy + Suspense, Vite manual chunk splitting (vendor-export for jspdf/xlsx, vendor-charts for recharts/d3, vendor-motion for framer-motion), non-blocking Google Fonts loading, skeleton loading states, SEO meta tags (Open Graph, Twitter Card), accessibility improvements (aria-labels, noopener noreferrer, alt text)

**Core Architectural Decisions:**
- **Authentication:** Custom email/password authentication with session cookies. Staff/agent accounts created by admin with password; students self-register with email verification (6-digit code, 15min TTL, logged to console in dev) OR auto-created from public apply flow (token-based password setup + email verification). Rate limiting on login (10/15min), verify (5/15min), resend (3/15min), register (5/15min), set-password (5/15min). Sessions stored in DB `sessions` table. Cookie: `sid` (httpOnly, secure, sameSite=lax). Open-redirect protection on returnTo param. Multi-role access control (`super_admin`, `admin`, `manager`, `staff`, `consultant`, `editor`, `accountant`, `student`, `agent`, `sub_agent`, `pending`). User activation is admin-controlled for staff; auto-activated on email verification for students. `emailVerified` field included in session user data for frontend verification guards.
- **Role-Based Access Control (RBAC):** Granular permissions across various modules (Dashboard, Leads, Applications, Students, Documents, Course Finder, Agents, Finance, Catalog, Users, Audit, Settings) with definable system and custom roles. Role-based lead/student visibility: agents see only own + sub-agents' records (by agentId); staff/consultant/accountant/editor see own assigned + unassigned records (by assignedToId); managers/admins/super_admins see all. Staff can self-assign unassigned leads/students via "Assign to Me" button (pipeline cards + list view). Students on GET /students can only see their own record (by userId). Assignment UI includes "Assigned" column in list views and assignee indicators on pipeline cards. Communication Center enforces the same visibility: non-admin staff can only search/message staff colleagues + students assigned to them/unassigned + agents tied to their visible leads/students. Conversation creation (POST /conversations) server-side validates participant IDs against visibility rules.
- **Dynamic Pipeline Management:** Lead, application, and student pipeline stages are database-driven and fully configurable via API, allowing managers to customize workflows.
- **UI/UX:**
    - **Design System:** TailwindCSS and shadcn/ui for consistent styling.
    - **Layouts:** Role-based dashboards and navigation (`DashboardLayout`).
    - **Theming:** Customizable branding (logo, theme colors) and dark mode toggling.
- **Features:**
    - **Public Site:** Home, About, Programs, Blog, Contact pages.
    - **User Management (Admin):** Comprehensive user and role management, including custom roles and detailed permission editor.
    - **Student Management (Staff):** Pipeline and list views, AI-powered student creation from documents, bulk CSV import with AI mapping.
    - **Application Management (Staff):** Pipeline and list views, cascading selects for university/program, auto-fill of tuition fees and program details.
    - **Lead Management (Staff):** Kanban pipeline and list views.
    - **Finance Management (Staff — restricted to super_admin, admin, accountant):** Redesigned system with stage-based finance automation. Commission and service fee records auto-created when applications are created. Stage changes automatically update finance status: potential stages (inquiry→student_card) keep records as "potential"; enrolled confirms them; negative stages (rejected, cancelled, visa_reject, already_registered, refound) exclude them from calculations; %100 scholarship excludes commission but confirms service fee. Service fees have a dual-status system: `financeStatus` (potential/confirmed/excluded) for stage-based tracking and `status` (pending/partial/paid) for payment tracking. Finance summaries, university breakdown, and agent views all exclude "excluded" records from totals.
    - **Price Snapshot on Application Creation:** When an application is created (from either the main application form or course finder), all program financial fields are frozen/snapshotted onto the application record: `tuitionFee`, `discountedFee`, `commissionRate`, `serviceFeeAmount`, `applicationFee`, `depositFee`, `advancedFee`, `languageFee`, `currency`. Subsequent changes or deletions of the source program do NOT affect existing applications. Commission `programFee` uses `discountedFee` (if available), otherwise `tuitionFee`. Commission `universityCommissionRate` and `universityCommissionAmount` are auto-calculated from snapshot. Service fee `totalAmount` uses `serviceFeeAmount`, split evenly into two installments.
    - **Agent Portal:** Full-featured Leads, Students, Applications pages with pipeline Kanban + list dual views, DnD stage changes, sortable columns, edit/delete dialogs, search, filters, and pagination — mirroring staff pages but without admin-only features (no stage editing, no AI extraction, no bulk CSV import). Agent-scoped visibility (agent sees own + sub-agents' data; sub-agent sees only own). Create lead/student auto-assigns agentId. Application creation enforces student ownership validation. Sub-agent management (CRUD) for agents. Edit Student dialog matches admin panel with comprehensive sectioned form (Personal Info with country flags/phone codes, Passport/Identity, Education with GPA grading systems, Notes). Agents can PATCH their own students via ownership-checked `/api/students/:id`. Routes: `/agent/leads`, `/agent/students`, `/agent/applications`.
    - **Course Finder (Staff/Agent):** Program search/filter, PDF proposal generation (with customizable branding), and direct application creation.
    - **Public Countries/Destinations Page:** DB-driven destinations system. Listing page at `/countries` shows featured + regular destination cards with flag emojis, descriptions, university/program counts (live from DB). Detail page at `/countries/:slug` shows full country info: description, "Why Study Here" points, popular cities, Quick Facts sidebar (language, currency, living cost, climate, visa info, work permit), universities list, and CTA to browse programs filtered by that country. DB table: `destinations` (slug-based, with sort_order, isFeatured, rich content fields). API: `GET /api/public/destinations`, `GET /api/public/destinations/:slug`. Seeded with Turkey, UK, Canada, France, Australia.
    - **Public Programs Page:** Fetches from `/api/course-finder`, shows programs with pagination, dynamic filters (country/degree) from DB, debounced search, university logos via `fixStorageUrl()`, language/duration/fee/scholarship display, "Apply Now" button opens AI-powered `ApplyDialog`.
    - **Public Apply Flow:** Multi-step dialog: (1) Document upload zones (Passport, Diploma, Transcript, Photo) with drag-and-drop, (2) AI extraction via Anthropic Claude analyzing uploaded documents, (3) Review form with AI-highlighted fields and manual editing, (4) Submit creates lead + auto-creates student account, (5) Success screen with "What happens next?" steps and "Go to Login" button. Public API endpoints: `POST /api/public/apply` (rate-limited 10/15min), `POST /api/public/ai/extract-document` (rate-limited 5/15min, max 4 docs, 10MB total). Routes in `artifacts/api-server/src/routes/public-apply.ts`.
    - **Auto Account Creation from Public Apply:** After a guest submits an application, the system automatically creates a student account (if email is new) with `isActive: false`, `emailVerified: false`, no password. Account activates (`isActive: true`) only when BOTH password is set AND email is verified. Generates a secure 48h password-setup token and email-verification token. Logs a welcome email to console (with Set Password link, Verify Email button, login URL). If the email already exists, links the lead to the existing account and sends an "existing account" email instead. New DB fields on users: `passwordResetToken`, `passwordResetExpires`, `emailVerificationToken`, `createdFromSource`. API endpoints: `POST /api/auth/set-password` (token + new password), `GET /api/auth/verify-email-token/:token` (one-click email verify, redirects to `/login?verified=true`), `POST /api/auth/resend-verification-email` (authenticated, rate-limited). Frontend: Login page handles `?token=` (set-password form), `?verified=true` (success banner), `?verifyError=invalid` (error message). Student portal pages wrapped with `EmailVerificationGuard` — unverified students see a full-page verification prompt with "Send/Resend Verification Email" button. Email utility in `artifacts/api-server/src/lib/email.ts` (console-logged in dev, ready for SMTP integration).
    - **Staff Profile (Settings):** Extended profile with Work & Identity section — Start Date, Home Address, Passport Number, Employment Contract (with file upload to object storage). All fields persist via PATCH `/api/users/:id`.
    - **Follow-Up System:** Tracks scheduled actions for leads/students.
- **Data Handling:** Paginated API responses, consistent data structures for frontend consumption.
    - **Table Pagination Component:** Reusable `TablePagination` component + `useTablePagination` hook in `artifacts/edcons/src/components/TablePagination.tsx`. Applied to all table/list views: Documents, Users, Activity, AuditLog, Leads, Students, Applications, Agents, Finance (commissions + fees), agent/Commissions, agent/Applications. Server-side paginated pages (AuditLog, Agents) use `TablePagination` for UI consistency without double-paginating.
- **Type Safety:** Extensive use of TypeScript with pnpm workspaces, leveraging composite projects for robust type checking across the monorepo.

## External Dependencies

- **bcryptjs:** For password hashing (email/password auth).
- **Anthropic Claude:** AI integration for document OCR (claude-sonnet-4-6) and CSV parsing (claude-haiku-4-5) via Replit AI Integrations proxy.
- **PostgreSQL:** Primary database for all application data.
- **Object Storage:** For storing uploaded files like invoices, receipts, and branding assets (accessed via presigned URLs).
- **Stripe:** For payment processing (implied by finance system, though not explicitly detailed in the provided content, common in SaaS).

## Communication Hub

- **Messaging System:** Internal messaging with direct and group conversations. Channels: internal, WhatsApp, Telegram, email, SMS. Broadcast messaging for mass communication (admin/manager only).
  - DB tables: `conversations`, `conversation_participants`, `messages`, `broadcasts`
  - API: `/api/conversations`, `/api/conversations/:id/messages`, `/api/broadcasts`, `/api/users-search`
  - Frontend: `artifacts/edcons/src/pages/staff/Messages.tsx` at route `/staff/messages`
- **Notification System:** In-app notification center with bell icon in dashboard header showing unread count badge and dropdown panel.
  - DB tables: `notifications`, `notification_rules` (22 default rules across 7 event categories)
  - API: `/api/notifications`, `/api/notifications/unread-count`, `/api/notification-rules`
  - Frontend: `artifacts/edcons/src/components/NotificationCenter.tsx` (header bell icon), `artifacts/edcons/src/components/NotificationRulesManager.tsx` (admin settings)
  - Notification rules configurable per event with channel selection (in_app, email, whatsapp, telegram, sms), recipient targeting (role, assigned, owner, specific, all)
- **Message Templates:** Reusable message templates for quick communication. Templates have name, category (general/welcome/follow_up/application/visa/payment/offer/rejection/reminder/agent), channel, language, subject, content with `{{variable}}` placeholders, and active/inactive status.
  - DB table: `message_templates` (id, name, category, subject, content, channel, language, variables jsonb, isActive, createdById, timestamps)
  - API: `GET/POST /api/message-templates`, `PATCH/DELETE /api/message-templates/:id`
  - Frontend: "Templates" tab in Communication Center Messages page with search, category filter, create/edit dialog, preview, copy, activate/deactivate, delete
- **Quick Contact:** Reusable `QuickContactButtons` component for contacting leads/students/agents from detail pages. Supports internal, email, and WhatsApp channels. Creates conversation + message records for all channels.
  - API: `POST /api/quick-contact` with server-side channel validation (requires recipientEmail for email, recipientPhone for WhatsApp)
  - Frontend: `artifacts/edcons/src/components/QuickContact.tsx` — integrated into LeadDetail, StudentDetail, ApplicationDetail, and Agents pages
- **Message Notifications:** Sending a message to a conversation automatically creates in-app notifications for all other participants.
- **Security:** All conversation/messaging endpoints protected with `requireRole(...STAFF_ROLES, ...ADMIN_ROLES)` to prevent non-staff access. Participant membership checks on message read/send. Unread counts exclude self-authored messages. Broadcast tab gated to admin/manager roles on frontend.
- **ADMIN_ROLES:** `["super_admin", "admin", "manager"]` — used for notification rules, broadcast access, and other admin-level operations.

## Admin Settings Center

- **Route:** `/admin/settings` (managers) and `/staff/settings` (all staff — personal tabs only)
- **Layout:** Vertical sidebar navigation on desktop (lg:), horizontal chip bar on mobile. Two groups: Personal + Organization.
- **Personal Tabs (all users):** Profile, Language & Region, Notifications, Security
- **Organization Tabs (managers only):** Branding & Appearance, Company & Contact, SEO & Social, Email Branding, Documents / PDF, Integrations, Advanced
- **Branding Tab:** Theme mode (light/dark/system), 6 logo uploads (light, dark, square, favicon, Apple touch, PWA), 9 color pickers (primary, secondary, accent, button, hover, link, success, warning, danger), live brand preview
- **Company Tab:** Legal name, brand name, 3 emails, phone, WhatsApp, working hours, address/city/country, footer description/copyright/CTA, 6 social media links
- **SEO Tab:** Site name/title template, canonical URL, meta title/description/keywords with character counters, robots toggles, OG + Twitter cards with image uploads, Google search preview mock, analytics IDs (GA4, Meta Pixel, TikTok Pixel), Schema.org structured data
- **Email Branding Tab:** Sender name/email/reply-to, email header logo, button color, footer/signature/disclaimer text, live email preview
- **Documents Tab:** PDF logo, header/footer/watermark/signature text, seal image, primary color, live document preview
- **Advanced Tab:** Sitemap URL, robots.txt content, LinkedIn Insight/Clarity/reCAPTCHA/WhatsApp widget, custom scripts (super_admin only)
- **Security:** Custom scripts (customHeadScript, customBodyEndScript, liveChatScript, featureFlags) restricted to `super_admin` role on both frontend and backend
- **DB:** All settings in single `settings` table with ~80 columns. Credentials (smtpPassword, whatsappToken) redacted from API responses.
- **Files:** `lib/db/src/schema/settings.ts`, `artifacts/api-server/src/routes/settings.ts`, `artifacts/edcons/src/pages/staff/Settings.tsx`

## Integrations System

- **DB table:** `integrations` (id, key unique, name, category, isEnabled, config jsonb)
- **API routes:** `GET/PUT /api/integrations/:key`, `PATCH /api/integrations/:key/toggle`, `POST /api/integrations/:key/test`
- **Frontend:** `IntegrationsManager` component in Settings → Integrations tab (admin/manager only)
- **Categories:** Communication (SMTP, WhatsApp, Telegram, SMS/Twilio), AI (OpenAI, Claude, Gemini, HeyGen), Social Media (Instagram, Meta, Twitter, TikTok, YouTube, VK), Third-Party (Custom Webhook, Google Sheets, Custom API)
- **Security:** Secrets (passwords, tokens, API keys) are masked on read (first 4 chars + dots). On save, masked values are skipped so existing secrets aren't overwritten.
- **File:** `artifacts/api-server/src/routes/integrations.ts`, `artifacts/edcons/src/components/IntegrationsManager.tsx`

## Catalog Options

- **DB table:** `catalog_options` (id serial, category text, value text, sort_order int, is_active bool, timestamps). Unique index on `(category, value)`.
- **Categories:** `degree`, `language`, `duration`, `fee_type`, `intake`, `field`
- **API routes:** `GET /api/catalog-options` (public, returns grouped), `POST /api/catalog-options` (admin), `PATCH /api/catalog-options/:id`, `DELETE /api/catalog-options/:id`
- **Frontend:** "Options" tab in Catalog Management page — sidebar navigation for categories, inline add/edit/delete/activate/deactivate per item.
- **Integration:** Programs tab dropdowns (Degree, Language, Duration, Fee Type, Field) and Intake Periods badges all pull from `catalog-options` API dynamically instead of hardcoded values.
- **Files:** `lib/db/src/schema/catalog.ts` (catalogOptionsTable), `artifacts/api-server/src/routes/catalog.ts`, `artifacts/edcons/src/pages/admin/Catalog.tsx` (OptionsTab + ProgramsTab integration)

## Student Profile

- **Photo System:** Student photos stored as documents with `type = "photo"` in the `documents` table. Profile page displays latest photo (sorted by `createdAt` desc) as circular avatar in header. Hover reveals camera (upload) and download buttons. Photo upload creates a new document record with auto-naming `photo-firstname-lastname`.
- **`photoUrl` field:** Added to `students` table schema (`photo_url` column) for future external URL photo support, included in PATCH fields whitelist.
- **Download Naming Convention:** All document downloads follow `doctype-firstname-lastname.ext` format (lowercase, sanitized). Implemented via `buildDownloadFilename()` in `StudentDetail.tsx`. MIME-to-extension map handles common types (pdf, jpg, png, gif, webp, svg).

## Agent Account (Agent Portal)

- **Route:** `/agent/account` with tabs: Profile, Agency, Referral, Language, Security
- **Agency Tab Features:**
  - **Agency Code:** Read-only display, set by super_admin/admin via `PATCH /api/agents/:id`
  - **Business Name:** Editable by agent, saved via `PATCH /api/agents/me`
  - **Info Fields:** Country, Commission Rate, Status (read-only display)
  - **Documents Section:**
    - Logo for Agent Panel: Agent can upload/remove via self-service
    - Contract: Read-only for agents (view/download only), uploaded by admin via `PATCH /api/agents/:id` with `contractUrl`
    - Business Certificate: Agent can upload/remove via self-service
- **Self-Service API:** `PATCH /api/agents/me` — limited to `businessName`, `logoUrl`, `businessCertUrl` fields only. URL validation rejects non-storage URLs (must start with `/api/storage/objects/` or `https://`). Business name max 200 chars.
- **Admin API:** `PATCH /api/agents/:id` — full access to all agent fields including `agencyCode`, `contractUrl`, `status`, `commissionRate`, etc. Requires MANAGER_ROLES.
- **DB:** `agents` table includes `contract_url` column for admin-uploaded contracts.
- **Files:** `artifacts/edcons/src/pages/agent/Account.tsx`, `artifacts/api-server/src/routes/agents.ts`

## Agent Sub-Agent Management

- **Route:** `/agent/sub-agents` (agent role only, not visible to sub_agents)
- **Sidebar:** "Sub Agents" menu item under "Account" section, shown only to users with `agent` role
- **Features:** Full CRUD for sub-agents owned by the logged-in agent. Table view with search, pagination, create/edit/delete dialogs, set password, activate/deactivate toggle.
- **API Endpoints (all require `requireAuth` + `requireRole("agent")`):**
  - `GET /api/agents/me/sub-agents` — paginated list with search/status filters
  - `POST /api/agents/me/sub-agents` — create sub-agent (auto-creates user account with `sub_agent` role if email provided)
  - `PATCH /api/agents/me/sub-agents/:id` — update sub-agent details (syncs to users table)
  - `DELETE /api/agents/me/sub-agents/:id` — delete sub-agent and linked user account
  - `POST /api/agents/me/sub-agents/:id/set-password` — set login password for sub-agent
  - `PATCH /api/agents/me/sub-agents/:id/status` — toggle active/inactive (also syncs `users.isActive`)
- **Security:** All endpoints verify the sub-agent's `parentAgentId` matches the logged-in agent's ID. Status toggle syncs `users.isActive` to actually prevent login.
- **Files:** `artifacts/edcons/src/pages/agent/SubAgents.tsx`, `artifacts/api-server/src/routes/agents.ts`

## Stage Documents (Application)

- **Purpose:** Stage-specific document upload and viewing per application. Different pipeline stages have different upload permissions.
- **DB table:** `application_stage_documents` (id serial, applicationId, stage, fileName, fileData text, fileUrl, mimeType, sizeBytes, uploadedBy, uploadedByRole, uploadedByName, isMissingDocNote bool, createdAt)
- **Everyone-upload stages:** `app_fee_paid`, `missing_docs`, `upload_payment`, `visa_approved`, `student_card`, `visa_reject` — all authenticated users (staff, agents, sub-agents, students) can upload
- **Admin-only upload stages:** `offer_received`, `acceptance_letter`, `final_acceptance` — only ADMIN_ROLES can upload; everyone else can view/download
- **Missing Documents feature:** Admin can set a list of required documents (stored as `isMissingDocNote=true` rows). Agents, sub-agents, and students see these as a checklist. Admin can edit/clear the list.
- **API routes:**
  - `GET /api/applications/:id/stage-documents` — list docs (metadata only, no fileData blob)
  - `POST /api/applications/:id/stage-documents` — upload (validates stage permissions, file size, URL scheme)
  - `DELETE /api/applications/:id/stage-documents/:docId` — delete (admin or own uploads)
  - `GET /api/applications/:id/stage-documents/:docId/download` — stream file download
  - `GET /api/applications/:id/missing-doc-notes` — list missing doc requirements
  - `POST /api/applications/:id/missing-doc-notes` — set/clear missing doc list (admin only)
- **Frontend:** `StageDocumentsPanel` component (`artifacts/edcons/src/components/StageDocumentsPanel.tsx`) — collapsible stage sections with upload buttons, file list, download, delete. Used in staff ApplicationDetail, agent EditApplicationDialog, and student Applications page.
- **Files:** `lib/db/src/schema/applicationStageDocuments.ts`, `artifacts/api-server/src/routes/applicationStageDocuments.ts`, `artifacts/edcons/src/components/StageDocumentsPanel.tsx`

## Embeddable Widgets

- **Purpose:** Allow embedding course finder and application forms on external websites (WordPress, custom sites, etc.)
- **DB tables:** `embed_widgets` (config: name, slug, mode, preset/locked/hidden/visible filters, theme JSONB, allowedDomains), `embed_submissions` (form data, UTM tracking, lead_id link, ai_extracted_data jsonb, document_count integer). Indexes on `embed_submissions(widget_id, created_at, lead_id)`. Documents from embed submissions stored in `documents` table via `lead_id` column.
- **Widget modes:** `combined` (course finder + application), `course_finder` (browse only), `application_only` (form only). Server validates mode on create/update, defaults to `combined` for invalid values.
- **Admin endpoints (staff auth):** `GET/POST /api/embed/widgets`, `GET/PATCH/DELETE /api/embed/widgets/:id`, `GET /api/embed/widgets/:id/submissions`, `GET /api/embed/submissions`
- **Public endpoints (no auth):** `GET /api/public/embed/:slug/config|programs|filters`, `POST /api/public/embed/:slug/apply` (rate limited, honeypot spam protection), `GET /api/public/embed/:slug/widget` (HTML page), `GET /api/public/embed/embed.js` (loader script)
- **Embed methods:** JavaScript snippet (`<div data-edcons-widget="slug">` + `<script src="...embed.js">`) or iframe (`<iframe src="...widget">`)
- **AI-Powered Multi-Step Apply Form:** Widget apply form has 3-step flow: (1) Contact info, (2) Document upload with level-based doc slots (passport, diploma, transcript, photo, etc.) — supports file upload with 5MB per-file limit, (3) AI analysis via `/api/public/ai/extract-document` → review & submit. Documents stored in `documents` table linked to lead. AI-extracted data stored in embed_submissions.ai_extracted_data. Server-side validation: max 4 docs, 7MB per doc base64, 20MB total, null/invalid entries filtered.
- **Security:** Domain validation (allowedDomains checked against Origin/Referer), `sanitizeTheme()` for CSS injection prevention, DB transaction for atomic lead+submission creation, rate limiting on submissions, CORS open for `/api/public/embed/` paths, X-Frame-Options disabled for widget HTML.
- **Admin UI:** `/admin/embeds` page with widget table, create/edit dialog (4 tabs: General, Filters, Theme, Security), embed code generator, submissions viewer, delete with confirmation.
- **Files:** `lib/db/src/schema/embeds.ts`, `artifacts/api-server/src/routes/embed.ts`, `artifacts/edcons/src/pages/admin/Embeds.tsx`

## Multi-Language (i18n) System

- **Supported Languages:** English (en), Turkish (tr), Arabic (ar), French (fr), Russian (ru), Persian (fa), Chinese (zh), Hindi (hi), Spanish (es), Indonesian (id)
- **RTL Support:** Arabic (ar) and Persian (fa) render right-to-left with proper Noto Sans Arabic font. Chinese uses Noto Sans SC, Hindi uses Noto Sans Devanagari.
- **URL Routing:** Public pages use language prefix `/:lang/path` (e.g., `/tr/about`, `/ar/contact`). Portal routes (`/admin`, `/staff`, `/student`, `/agent`) have no language prefix.
- **Language Detection:** URL prefix → localStorage → browser language → English fallback.
- **Translation Files:** JSON files in `artifacts/edcons/src/lib/i18n/translations/` with dot-notation keys (e.g., `nav.home`, `login.signIn`). Interpolation via `{placeholder}` syntax.
- **Core Files:**
  - `src/lib/i18n/index.ts` — language config, `getTranslation()`, `isValidLanguage()`, `LANGUAGES` array
  - `src/lib/i18n/context.tsx` — `I18nProvider` with React context, sets `document.documentElement.dir` and `lang` attributes
  - `src/hooks/use-i18n.ts` — `useI18n()` hook re-export returning `t()`, `lang`, `setLang`, `isRTL`, `dir`, `localePath()`
- **SEO:** `useSeo` hook injects hreflang alternate links for all 10 languages + `x-default`, with proper canonical URLs.
- **Language Switcher:** Dropdown in `PublicLayout` nav showing flag emoji + language code, triggers full page navigation on switch.
- **Compatibility Route:** `/login` redirects to `/:lang/login` preserving query params for email verification flows.
- **Wouter Routing:** Uses `/:lang/:rest*` wildcard syntax (not Express 5's `{*rest}`). Inner `PublicRoutes` component matches full paths like `/${lang}/about`.
- **CSS:** RTL utilities and font imports in `src/index.css`. Uses CSS logical properties (`ms-auto`, `me-auto`) for RTL-safe margins.

## Production Deployment (Hostinger VPS)

- **Deploy directory:** `deploy/` contains all production deployment configs
- **Static serving:** In production (`NODE_ENV=production`), Express serves the built frontend from `artifacts/edcons/dist/public/` with SPA fallback. Hashed `/assets/` get `immutable, max-age=1y`; `index.html` gets `no-cache`.
- **Dev seed data gating:** All seed functions (`ensureSuperAdmin`, `ensureAgentUser`, `runSeedSQL`, `linkAgentUser`) are gated behind `NODE_ENV !== "production"` — they only run in development.
- **Nginx config:** `deploy/nginx.conf` — reverse proxy, gzip, SSL placeholders, security headers, rate limiting (30r/s API, 5r/m login).
- **PM2 config:** `deploy/ecosystem.config.cjs` — cluster mode, auto-restart, 512M memory limit, log rotation.
- **Build script:** `deploy/build-production.sh` or `pnpm run build:prod` — builds frontend (BASE_PATH=/) then backend.
- **Deploy script:** `deploy/deploy.sh` — installs deps, builds, migrates DB, starts PM2.
- **Environment:** `deploy/.env.example` documents all required/optional variables.
- **Shared hosting fallback:** `deploy/.htaccess` for Apache-based shared hosting (SPA rewrite, compression, cache headers).
- **Full documentation:** `deploy/DEPLOYMENT.md` — step-by-step Hostinger VPS setup guide.

## Object Storage & Logo Upload

- **Upload URL pattern:** `objectPath` from `/api/storage/uploads/request-url` returns paths like `/objects/uploads/<uuid>`. When constructing display URLs, **always strip** the `/objects` prefix: `objectPath.replace(/^\/objects/, "")` then build `${BASE_URL}/api/storage/objects${strippedPath}`. The serving route `/storage/objects/*path` internally re-adds the `/objects/` prefix.
- **Branding logo on public site:** Public homepage uses `GET /api/settings/branding/logo` (no auth required) to serve the logo. Supports `?variant=dark` for dark mode logo. `PublicLayout` uses `ThemeContext` to detect if a logo is configured and renders an `<img>` tag pointing to this public endpoint.
- **Agent logos:** Agent document uploads (logo, ID proof, business cert) in `Agents.tsx` use `fixStorageUrl()` to sanitize any legacy double-prefix URLs (`/objects/objects/`).