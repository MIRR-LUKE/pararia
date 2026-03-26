ALTER TABLE "Report" DROP CONSTRAINT IF EXISTS "Report_previousReportId_fkey";
ALTER TABLE "Report" DROP COLUMN IF EXISTS "previousReportId";
