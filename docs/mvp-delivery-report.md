# PARARIA MVP Delivery Report

## 1. Delivery Summary

This delivery completes the core MVP around `Student Room`, `Interview sessions`, `Lesson report sessions`, `AI-generated room artifacts`, `entity review`, and `parent report draft flow`.

The app is now in a state where we can:

- log in with real app auth (`NextAuth credentials`)
- create interview sessions from recorder / file upload
- create lesson report sessions with `check-in` and `check-out`
- generate structured room artifacts into the same student timeline
- review pending named entities before parent-facing output
- generate parent report drafts from selected sessions
- mark reports as sent
- run migrations and seed demo data for immediate local verification

## 2. What Was Implemented

### 2.1 Session-based data model

A new session layer was added so the product can treat `interview` and `lesson report` as one shared operational model.

Added models / enums:

- `Session`
- `SessionPart`
- `StudentEntity`
- `SessionEntity`
- `SessionType`
- `SessionStatus`
- `SessionPartType`
- `SessionPartStatus`
- `EntityKind`
- `EntityStatus`
- `ReportStatus`

Extended existing models:

- `ConversationLog`
  - `sessionId`
  - `studentStateJson`
  - `topicSuggestionsJson`
  - `quickQuestionsJson`
  - `profileSectionsJson`
  - `observationJson`
  - `entityCandidatesJson`
  - `lessonReportJson`
- `Report`
  - `status`
  - `reviewedAt`
  - `sentAt`
  - `sentByUserId`
  - `deliveryChannel`
  - `qualityChecksJson`

Files:

- `prisma/schema.prisma`
- `prisma/migrations/20260314000100_session_room_mvp/migration.sql`

### 2.2 Session APIs

Added new APIs for session-based operation.

- `GET/POST /api/sessions`
- `GET/PATCH /api/sessions/[id]`
- `POST /api/sessions/[id]/parts`
- `POST /api/sessions/[id]/generate`
- `PATCH /api/sessions/[id]/entities/[entityId]`
- `GET /api/students/[id]/room`
- `POST /api/reports/[id]/send`

Files:

- `app/api/sessions/route.ts`
- `app/api/sessions/[id]/route.ts`
- `app/api/sessions/[id]/parts/route.ts`
- `app/api/sessions/[id]/generate/route.ts`
- `app/api/sessions/[id]/entities/[entityId]/route.ts`
- `app/api/students/[id]/room/route.ts`
- `app/api/reports/[id]/send/route.ts`

### 2.3 Student Room UI

The student detail screen was rebuilt into the main operational screen.

Implemented blocks:

- hero state / one-liner
- room metrics
- recommended topics
- quick questions
- next actions
- profile sections
- pending entity review
- session history
- parent report generation and send marking
- embedded interview recorder
- embedded lesson report composer

Files:

- `app/app/students/[studentId]/page.tsx`
- `app/app/students/[studentId]/StudentRecorder.tsx`
- `app/app/students/[studentId]/LessonReportComposer.tsx`
- `app/api/students/[id]/room/route.ts`

### 2.4 Logs UI

The log detail screen now surfaces room artifacts, entity review context, and lesson report output instead of only summary / timeline / raw transcript.

File:

- `app/app/logs/LogDetailView.tsx`

### 2.5 Authentication

Implemented app authentication using `NextAuth` credentials against the existing user table.

Implemented:

- login page
- session provider
- protected app layout
- sidebar/header user binding
- API-backed credential auth

Files:

- `auth.ts`
- `app/api/auth/[...nextauth]/route.ts`
- `app/login/page.tsx`
- `app/app/layout.tsx`
- `app/layout.tsx`
- `components/providers/AuthProvider.tsx`
- `components/layout/Sidebar.tsx`
- `components/layout/AppHeader.tsx`
- `next-auth.d.ts`

### 2.6 AI pipeline extension

The pipeline now returns Student Room oriented artifacts, not just summary/timeline/todo.

Added output families:

- `studentState`
- `recommendedTopics`
- `quickQuestions`
- `profileSections`
- `entityCandidates`
- `observationEvents`
- `lessonReport`

Model defaults were moved to:

- final model: `gpt-5.4`
- fast model: `gpt-5-mini`
- speech-to-text model: `gpt-4o-transcribe-diarize`

Files:

- `lib/ai/conversationPipeline.ts`
- `lib/jobs/conversationJobs.ts`
- `lib/ai/stt.ts`
- `lib/types/conversation.ts`
- `lib/types/session.ts`
- `lib/session-service.ts`

### 2.7 Live dashboard / reports / student list

These pages now use live database data instead of mock-only data.

Files:

- `app/app/dashboard/page.tsx`
- `app/app/reports/page.tsx`
- `app/app/reports/[studentId]/page.tsx`
- `app/app/students/page.tsx`
- `app/api/students/route.ts`

## 3. Verification Completed

Executed successfully:

- `npx prisma migrate deploy`
- `npm run prisma:seed`
- `npm run lint`
- `npm run typecheck`
- `npm run build`

Result summary:

- migration applied successfully
- seed completed successfully
- lint passed with no warnings
- typecheck passed
- production build passed

## 4. Demo Data Loaded

Seed is additive and non-destructive to non-demo records.

Confirmed demo records:

- `student-demo-1` / `Hana Yamada`
  - sessions: 2
  - conversations: 2
  - reports: 1
- `student-demo-2` / `Aoi Sato`
  - sessions: 1
  - conversations: 1
  - reports: 1

Demo login:

- email: `admin@demo.com`
- password: `demo123`

## 5. Deployment Runbook

### Required env vars

Use `.env.example` as the base.

Required:

- `DATABASE_URL`
- `DIRECT_URL`
- `AUTH_SECRET`
- `OPENAI_API_KEY`

Recommended:

- `LLM_MODEL=gpt-5.4`
- `LLM_MODEL_FAST=gpt-5-mini`
- `LLM_MODEL_FINAL=gpt-5.4`
- `STT_MODEL=gpt-4o-transcribe-diarize`

### Deployment steps

1. install dependencies
   - `npm install`
2. set environment variables
3. generate prisma client
   - `npx prisma generate`
4. apply database migrations
   - `npx prisma migrate deploy`
5. seed demo data if needed
   - `npm run prisma:seed`
6. build
   - `npm run build`
7. start
   - `npm run start`

## 6. Manual QA Checklist

### Login

1. open `/login`
2. sign in with `admin@demo.com / demo123`
3. confirm redirect to `/app/dashboard`

### Student Room

1. open `/app/students`
2. open `Hana Yamada`
3. confirm hero state, topics, quick questions, next actions, profile sections
4. confirm pending entity review is shown

### Interview session flow

1. in Student Room, use `Interview session`
2. record or upload audio
3. confirm a new session is created
4. confirm conversation reaches `DONE`
5. confirm log detail opens and Student Room refreshes

### Lesson report flow

1. in Student Room, use `Lesson report session`
2. save `check-in`
3. save `check-out`
4. confirm the report is generated only after both parts exist
5. confirm lesson report artifacts appear in Student Room / log detail

### Entity review

1. open `Hana Yamada`
2. confirm pending entity `Waseda`
3. confirm or ignore it
4. verify pending count decreases

### Parent report flow

1. select sessions in Student Room or `/app/reports/[studentId]`
2. generate draft
3. preview markdown
4. mark the report as sent

## 7. Known Limits / Honest Notes

### Implemented for this delivery

This delivery is production-shaped and deployable, but optimized for immediate local/dev verification on the existing stack.

### Not implemented in this delivery

These were intentionally left out to keep the MVP stable and directly testable now:

- Vercel Blob direct-upload wiring
- Vercel Workflow / Queues orchestration rewrite
- parent login / parent portal auth
- campus/branch-level tenancy expansion
- full RBAC enforcement across every route

Current async processing still uses the repo's existing DB-backed job runner. That means the MVP works immediately and passed local build/test, but the Vercel-native async architecture is still a next-phase upgrade, not part of this shipment.

## 8. Main Files to Review

Core schema and data:

- `prisma/schema.prisma`
- `prisma/migrations/20260314000100_session_room_mvp/migration.sql`
- `prisma/seed.ts`

Session domain:

- `lib/session-service.ts`
- `lib/types/session.ts`

AI pipeline:

- `lib/ai/conversationPipeline.ts`
- `lib/jobs/conversationJobs.ts`
- `lib/ai/stt.ts`

Auth:

- `auth.ts`
- `app/api/auth/[...nextauth]/route.ts`
- `app/login/page.tsx`

Main UI:

- `app/app/students/[studentId]/page.tsx`
- `app/app/students/[studentId]/StudentRecorder.tsx`
- `app/app/students/[studentId]/LessonReportComposer.tsx`
- `app/app/logs/LogDetailView.tsx`
- `app/app/students/page.tsx`
- `app/app/reports/[studentId]/page.tsx`

## 9. Recommended Next Phase

If we continue from this delivery, the best next step is:

1. replace DB-backed async with Vercel Workflow / Blob
2. add per-route auth / org scoping hardening
3. add parent portal auth only after report sending workflow stabilizes