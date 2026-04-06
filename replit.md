# EdCons OS

## Overview

EdCons OS is a production-ready SaaS for education consultancy businesses. This pnpm workspace monorepo, built with TypeScript, serves as a comprehensive operating system to streamline operations like lead management, application processing, student tracking, and financial oversight. Its purpose is to enhance efficiency, client management, and growth for staff, agents, and students in the education consultancy market. Key capabilities include dynamic pipeline management, robust role-based access control, and AI-powered document processing.

## User Preferences

The user prefers a clean, intuitive UI/UX with a focus on role-based access and clear workflows. They value dynamic content management, such as configurable pipeline stages, and robust authentication with granular permission control. AI integration should be leveraged for efficiency gains, particularly in document processing and data extraction. The system should be scalable and maintainable, built with modern web technologies.

## System Architecture

The project is structured as a pnpm monorepo comprising separate packages for the API server, frontend, and shared libraries.

**Technical Stack:**
- **Monorepo:** pnpm workspaces
- **Backend:** Node.js (24), TypeScript (5.9), Express (5), PostgreSQL with Drizzle ORM, Zod for validation.
- **Frontend:** React, Vite, TailwindCSS, shadcn/ui, Framer Motion.
- **API Codegen:** Orval (from OpenAPI spec).

**Core Architectural Decisions:**
- **Authentication:** Custom email/password authentication with session cookies and multi-role access control (`super_admin`, `admin`, `manager`, `staff`, `consultant`, `editor`, `accountant`, `student`, `agent`, `sub_agent`, `agent_staff`, `pending`). Includes email verification, rate limiting, and open-redirect protection.
- **Role-Based Access Control (RBAC):** Granular, module-specific permissions and role-based visibility for leads and students, allowing staff to self-assign unassigned records.
- **Dynamic Pipeline Management:** Lead, application, and student pipeline stages are database-driven and fully configurable via API. Stage editor supports mandatory notes, file attachments (with max files and mandatory upload toggle), can-go-back, case-close, country-specific visibility, color, and finance category. Finance variants: `won`, `partial_won`, `lost`, `none_finance`.
- **UI/UX:** Utilizes TailwindCSS and shadcn/ui for a consistent design system. Features role-based dashboards, navigation, customizable branding, and dark mode.
- **Key Features:**
    - **Public Site:** Informational pages, DB-driven destination and program listings, multi-step public application flow with AI document extraction and degree-level based document requirements. Public applications auto-create Application records.
    - **User, Student, Application, Lead Management:** Comprehensive CRUD operations with pipeline and list views, AI-powered creation, bulk CSV import, and stage-specific document management with upload permissions and gate validation.
    - **Origin/Source Ownership System:** Tracks whether each Lead, Student, and Application is Direct, Agent, or Sub-Agent originated, with origin inferred at creation and inherited during conversions.
    - **Finance Management:** Dynamic variant-driven finance automation for commission and service fees. Pipeline stage variants drive commission/service fee status changes. Price snapshots are taken at application creation, and agent commission amounts are auto-calculated.
    - **Agent Portal:** Dedicated portal with Leads, Students, and Applications pages (agent-scoped visibility), sub-agent and agent staff management, self-service account settings, and Web-to-Lead forms.
    - **Course Finder:** Program search, filtering, PDF proposal generation, and direct application creation for staff and agents.
    - **Communication Hub:** Internal messaging system supporting direct and group conversations, broadcast messaging, message templates, and in-app notifications with configurable, DB-driven rules and email templates.
    - **Admin Settings Center:** Comprehensive configuration for branding, company information, SEO, email branding, document templates, and advanced settings.
    - **Integrations System:** Manages third-party service integrations (Communication, AI, Social Media, Custom Webhooks) with secure API key handling.
    - **Catalog Options:** Dynamic, database-driven management of dropdown options (degree, language, duration, fee type, intake, field).
    - **Embeddable Widgets:** Allows embedding course finder and application forms on external websites, including an AI-powered multi-step apply form.
    - **Multi-Language (i18n) System:** Supports 10 languages including RTL support, URL routing, language detection, and SEO-friendly hreflang tags.
    - **Document Management System:** Defines document requirements by education level, supports ZIP download of all student documents, and PDF merging. Application creation validates required student information.
    - **Website Module:** Full CMS with 17 DB tables for pages, blocks, navigation, global components, forms, blog posts, and collections. Features a Theme Builder UI (inheriting from Settings > Branding, with website-level overrides saved to `website_theme_tokens`), a Pages list with 6 managed pages (Home, About, Countries, Programs, Blog, Contact), and a 3-panel block-based Page Editor (left=block list, center=field editor, right=live preview). Supports 14 block types (Hero, Rich Text, Stats Strip, Feature Cards, Icon Cards, CTA Banner, FAQ, Team Grid, Office List, Logo Grid, Testimonials, Section Title, Spacer/Divider, Global Block). Draft/Publish/Version flow with version history restore. Desktop/tablet/mobile preview toggle. HTML sanitization for rich text blocks. Accessible via admin sidebar (super_admin + admin only).
- **Data Handling:** Consistent data structures with paginated API responses and extensive use of soft deletes for various entities.
- **Type Safety:** Extensive use of TypeScript across the monorepo.
- **Production Deployment:** Configured for Hostinger VPS with Nginx, PM2, and a build/deploy pipeline.

## External Dependencies

-   **bcryptjs:** For password hashing.
-   **Anthropic Claude:** AI integration for document OCR and CSV parsing.
-   **PostgreSQL:** Primary database.
-   **Object Storage:** For uploaded files.
-   **Stripe:** Implied payment processing.