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
- **Authentication:** Replit Auth via OpenID Connect (PKCE) with session cookies, supporting multi-role access control (`super_admin`, `admin`, `manager`, `staff`, `consultant`, `editor`, `accountant`, `student`, `agent`, `sub_agent`, `pending`). User activation is admin-controlled.
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

- **Replit Auth:** For user authentication via OpenID Connect.
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
- **Security:** Conversation participants endpoint has membership authorization check. Broadcast tab gated to admin/manager roles on frontend.
- **ADMIN_ROLES:** `["super_admin", "admin", "manager"]` — used for notification rules, broadcast access, and other admin-level operations.