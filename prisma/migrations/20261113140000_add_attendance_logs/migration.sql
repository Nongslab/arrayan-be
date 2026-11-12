-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('APP', 'FINGERPRINT', 'MANUAL');

-- CreateTable
CREATE TABLE "attendance_logs" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "source" "AttendanceSource" NOT NULL,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "ip" TEXT,
    "device_code" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_logs_employee_id_occurred_at_idx" ON "attendance_logs"("employee_id", "occurred_at");

-- CreateIndex
CREATE INDEX "attendance_logs_occurred_at_idx" ON "attendance_logs"("occurred_at");

-- AddForeignKey
ALTER TABLE "attendance_logs" ADD CONSTRAINT "attendance_logs_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

