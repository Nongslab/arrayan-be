-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "address" TEXT,
ADD COLUMN     "birth_date" DATE,
ADD COLUMN     "gender" "Gender",
ADD COLUMN     "personal_email" TEXT,
ADD COLUMN     "phone" TEXT;

