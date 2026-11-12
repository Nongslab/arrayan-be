-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "probation_end_date" DATE;


-- Backfill: karyawan PROBATION yang sudah ada → join_date + 6 bulan
-- (Postgres membulatkan ke akhir bulan, mis. 31 Agu + 6 bulan = 28/29 Feb — sama dengan addMonths() di aplikasi).
UPDATE "employees"
SET "probation_end_date" = ("join_date"::date + INTERVAL '6 months')::date
WHERE "employment_type" = 'PROBATION' AND "probation_end_date" IS NULL;
