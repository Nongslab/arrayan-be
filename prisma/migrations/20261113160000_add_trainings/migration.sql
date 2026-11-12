-- CreateEnum
CREATE TYPE "TrainingStatus" AS ENUM ('SCHEDULED', 'CANCELLED');

-- CreateTable
CREATE TABLE "trainings" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category_id" TEXT NOT NULL,
    "organizer" TEXT,
    "location" TEXT,
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "TrainingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trainings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_participants" (
    "id" TEXT NOT NULL,
    "training_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "attended" BOOLEAN,
    "remarks" TEXT,
    "rating" INTEGER,
    "remarked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trainings_start_at_idx" ON "trainings"("start_at");

-- CreateIndex
CREATE INDEX "trainings_category_id_idx" ON "trainings"("category_id");

-- CreateIndex
CREATE INDEX "training_participants_employee_id_idx" ON "training_participants"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "training_participants_training_id_employee_id_key" ON "training_participants"("training_id", "employee_id");

-- AddForeignKey
ALTER TABLE "trainings" ADD CONSTRAINT "trainings_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "training_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_participants" ADD CONSTRAINT "training_participants_training_id_fkey" FOREIGN KEY ("training_id") REFERENCES "trainings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_participants" ADD CONSTRAINT "training_participants_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

