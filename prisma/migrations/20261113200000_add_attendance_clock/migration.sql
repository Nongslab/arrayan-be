-- CreateEnum
CREATE TYPE "AttendanceKind" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "AttendanceVerification" AS ENUM ('GPS', 'IP_ALLOWLIST');

-- AlterTable
ALTER TABLE "attendance_logs" ADD COLUMN     "accuracy_meters" INTEGER,
ADD COLUMN     "kind" "AttendanceKind",
ADD COLUMN     "verification" "AttendanceVerification";

-- AlterTable
ALTER TABLE "office_locations" ADD COLUMN     "allowed_ip_ranges" TEXT[] DEFAULT ARRAY[]::TEXT[];

