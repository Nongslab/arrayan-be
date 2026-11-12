-- AlterTable
ALTER TABLE "attendance_logs" ADD COLUMN     "created_by_id" TEXT,
ADD COLUMN     "void_reason" TEXT,
ADD COLUMN     "voided_at" TIMESTAMP(3),
ADD COLUMN     "voided_by_id" TEXT;

