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

**Core Architectural Decisions:**
- **Authentication:** Custom email/password authentication with session cookies. Staff/agent accounts created by admin with password; students self-register with email verification (6-digit code, 15min TTL, logged to console in dev). Rate limiting on login (10/15min), verify (5/15min), resend (3/15min), register (5/15min). Sessions stored in DB `sessions` table. Cookie: `sid` (httpOnly, secure, sameSite=lax). Open-redirect protection on returnTo param. Multi-role access control (`super_admin`, `admin`, `manager`, `staff`, `consultant`, `editor`, `accountant`, `student`, `agent`, `sub_agent`, `pending`). User activation is admin-controlled for staff; auto-activated on email verification for students.
- **Role-Based Access Control (RBAC):** Granular permissions across various modules (Dashboard, Leads, Applications, Students, Documents, Course Finder, Agents, Finance, Catalog, Users, Audit, Settings) with definable system and custom roles.
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
    - **Finance Management (Staff):** Redesigned system for commission tracking, service fees, financial transactions with file uploads, and comprehensive analytics.
    - **Course Finder (Staff/Agent):** Program search/filter, PDF proposal generation (with customizable branding), and direct application creation.
    - **Follow-Up System:** Tracks scheduled actions for leads/students.
- **Data Handling:** Paginated API responses, consistent data structures for frontend consumption.
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

## Object Storage & Logo Upload

- **Upload URL pattern:** `objectPath` from `/api/storage/uploads/request-url` returns paths like `/objects/uploads/<uuid>`. When constructing display URLs, **always strip** the `/objects` prefix: `objectPath.replace(/^\/objects/, "")` then build `${BASE_URL}/api/storage/objects${strippedPath}`. The serving route `/storage/objects/*path` internally re-adds the `/objects/` prefix.
- **Branding logo on public site:** Public homepage uses `GET /api/settings/branding/logo` (no auth required) to serve the logo. Supports `?variant=dark` for dark mode logo. `PublicLayout` uses `ThemeContext` to detect if a logo is configured and renders an `<img>` tag pointing to this public endpoint.
- **Agent logos:** Agent document uploads (logo, ID proof, business cert) in `Agents.tsx` use `fixStorageUrl()` to sanitize any legacy double-prefix URLs (`/objects/objects/`).