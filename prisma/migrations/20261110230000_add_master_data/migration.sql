-- CreateEnum
CREATE TYPE "HierarchyLevel" AS ENUM ('MANAGEMENT', 'SR_MANAGER', 'MANAGER', 'SUPERVISOR', 'STAFF');

-- CreateEnum
CREATE TYPE "LeaveCategory" AS ENUM ('ANNUAL', 'SICK', 'PERMISSION', 'MATERNITY', 'SPECIAL', 'UNPAID');

-- CreateEnum
CREATE TYPE "HolidayKind" AS ENUM ('NATIONAL', 'COLLECTIVE_LEAVE', 'COMPANY');

-- CreateEnum
CREATE TYPE "KpiPeriod" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "KpiIndicatorType" AS ENUM ('QUANTITATIVE', 'QUALITATIVE');

-- AlterTable (kolom FK baru dibuat nullable dulu; diisi lewat backfill di bawah)
ALTER TABLE "employees" ADD COLUMN     "department_id" TEXT,
ADD COLUMN     "job_title_id" TEXT,
ADD COLUMN     "office_location_id" TEXT,
ADD COLUMN     "work_shift_id" TEXT;

-- CreateTable
CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parent_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_titles" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" "HierarchyLevel" NOT NULL DEFAULT 'STAFF',
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_titles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "office_locations" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "radius_meters" INTEGER NOT NULL DEFAULT 100,
    "wifi_ssids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "wifi_bssids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "office_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_shifts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "break_minutes" INTEGER NOT NULL DEFAULT 60,
    "late_tolerance_minutes" INTEGER NOT NULL DEFAULT 15,
    "work_days" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "is_overnight" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "LeaveCategory" NOT NULL,
    "default_quota" INTEGER NOT NULL DEFAULT 0,
    "is_paid" BOOLEAN NOT NULL DEFAULT true,
    "requires_attachment" BOOLEAN NOT NULL DEFAULT false,
    "deducts_annual_leave" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "HolidayKind" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_categories" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_templates" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "period" "KpiPeriod" NOT NULL DEFAULT 'QUARTERLY',
    "job_title_id" TEXT,
    "department_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kpi_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_indicators" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "KpiIndicatorType" NOT NULL,
    "weight" DECIMAL(5,2) NOT NULL,
    "target" DECIMAL(14,2),
    "unit" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kpi_indicators_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "departments_code_key" ON "departments"("code");

-- CreateIndex
CREATE INDEX "departments_parent_id_idx" ON "departments"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_titles_code_key" ON "job_titles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "office_locations_code_key" ON "office_locations"("code");

-- CreateIndex
CREATE UNIQUE INDEX "work_shifts_code_key" ON "work_shifts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_code_key" ON "leave_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_code_key" ON "holidays"("code");

-- CreateIndex
CREATE INDEX "holidays_date_idx" ON "holidays"("date");

-- CreateIndex
CREATE UNIQUE INDEX "training_categories_code_key" ON "training_categories"("code");

-- CreateIndex
CREATE UNIQUE INDEX "kpi_templates_code_key" ON "kpi_templates"("code");

-- CreateIndex
CREATE INDEX "kpi_templates_job_title_id_idx" ON "kpi_templates"("job_title_id");

-- CreateIndex
CREATE INDEX "kpi_templates_department_id_idx" ON "kpi_templates"("department_id");

-- CreateIndex
CREATE INDEX "kpi_indicators_template_id_idx" ON "kpi_indicators"("template_id");

-- CreateIndex
CREATE INDEX "employees_job_title_id_idx" ON "employees"("job_title_id");

-- CreateIndex
CREATE INDEX "employees_department_id_idx" ON "employees"("department_id");

-- CreateIndex
CREATE INDEX "employees_office_location_id_idx" ON "employees"("office_location_id");

-- CreateIndex
CREATE INDEX "employees_work_shift_id_idx" ON "employees"("work_shift_id");

-- ---------------------------------------------------------------------------
-- Backfill (manual): pindahkan nilai free-text lama employees.job_title &
-- employees.department ke tabel master, lalu isi FK. Kode = UPPER_SNAKE dari
-- nama lama. Seed (upsert by code) dapat memperbarui nama/level sesudahnya.
-- ---------------------------------------------------------------------------
INSERT INTO "departments" ("id", "code", "name", "updated_at")
SELECT gen_random_uuid()::text,
       TRIM(BOTH '_' FROM UPPER(REGEXP_REPLACE(TRIM("department"), '[^A-Za-z0-9]+', '_', 'g'))),
       MIN(TRIM("department")),
       CURRENT_TIMESTAMP
FROM "employees"
WHERE "department" IS NOT NULL AND TRIM("department") <> ''
GROUP BY 2
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "job_titles" ("id", "code", "name", "level", "updated_at")
SELECT gen_random_uuid()::text,
       TRIM(BOTH '_' FROM UPPER(REGEXP_REPLACE(TRIM("job_title"), '[^A-Za-z0-9]+', '_', 'g'))),
       MIN(TRIM("job_title")),
       'STAFF',
       CURRENT_TIMESTAMP
FROM "employees"
WHERE "job_title" IS NOT NULL AND TRIM("job_title") <> ''
GROUP BY 2
ON CONFLICT ("code") DO NOTHING;

UPDATE "employees" e
SET "department_id" = d."id"
FROM "departments" d
WHERE e."department" IS NOT NULL
  AND d."code" = TRIM(BOTH '_' FROM UPPER(REGEXP_REPLACE(TRIM(e."department"), '[^A-Za-z0-9]+', '_', 'g')));

UPDATE "employees" e
SET "job_title_id" = j."id"
FROM "job_titles" j
WHERE j."code" = TRIM(BOTH '_' FROM UPPER(REGEXP_REPLACE(TRIM(e."job_title"), '[^A-Za-z0-9]+', '_', 'g')));

-- Setelah backfill: jabatan wajib, kolom free-text lama dihapus
ALTER TABLE "employees" ALTER COLUMN "job_title_id" SET NOT NULL;
ALTER TABLE "employees" DROP COLUMN "department",
DROP COLUMN "job_title";

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_job_title_id_fkey" FOREIGN KEY ("job_title_id") REFERENCES "job_titles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_office_location_id_fkey" FOREIGN KEY ("office_location_id") REFERENCES "office_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_work_shift_id_fkey" FOREIGN KEY ("work_shift_id") REFERENCES "work_shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_templates" ADD CONSTRAINT "kpi_templates_job_title_id_fkey" FOREIGN KEY ("job_title_id") REFERENCES "job_titles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_templates" ADD CONSTRAINT "kpi_templates_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_indicators" ADD CONSTRAINT "kpi_indicators_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "kpi_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

