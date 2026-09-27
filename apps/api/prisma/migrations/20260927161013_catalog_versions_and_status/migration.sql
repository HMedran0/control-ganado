-- AlterTable
ALTER TABLE "breeds" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "farms" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "lots" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "tags" ADD COLUMN     "description" TEXT,
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "vaccination_cycles" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "vaccines" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;
