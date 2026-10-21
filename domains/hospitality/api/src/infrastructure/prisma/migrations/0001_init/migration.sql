-- CreateEnum
CREATE TYPE "call_status" AS ENUM ('pending', 'in_progress', 'completed');

-- CreateEnum
CREATE TYPE "call_type" AS ENUM ('attention');

-- CreateEnum
CREATE TYPE "call_action" AS ENUM ('create', 'acknowledge', 'complete');

-- CreateEnum
CREATE TYPE "call_visibility" AS ENUM ('all');

-- CreateEnum
CREATE TYPE "transport" AS ENUM ('http', 'mqtt');

-- CreateEnum
CREATE TYPE "device_event_result" AS ENUM ('call_created', 'repeat_press', 'debounced', 'unknown_device', 'unassigned_device', 'location_inactive');

-- CreateTable
CREATE TABLE "location_settings" (
    "location_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "call_visibility" "call_visibility" NOT NULL DEFAULT 'all',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "location_settings_pkey" PRIMARY KEY ("location_id")
);

-- CreateTable
CREATE TABLE "zones" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_by" UUID,
    "deactivated_at" TIMESTAMPTZ,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dining_tables" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "zone_id" UUID,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_by" UUID,
    "deactivated_at" TIMESTAMPTZ,

    CONSTRAINT "dining_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateways" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "key_hash" BYTEA NOT NULL,
    "last_seen_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_by" UUID,
    "deactivated_at" TIMESTAMPTZ,

    CONSTRAINT "gateways_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "model" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_by" UUID,
    "deactivated_at" TIMESTAMPTZ,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_assignments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "table_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by" UUID NOT NULL,
    "unassigned_at" TIMESTAMPTZ,
    "unassigned_by" UUID,

    CONSTRAINT "device_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_calls" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "table_id" UUID NOT NULL,
    "call_type" "call_type" NOT NULL DEFAULT 'attention',
    "status" "call_status" NOT NULL DEFAULT 'pending',
    "press_count" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_press_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMPTZ,
    "acknowledged_by" UUID,
    "completed_at" TIMESTAMPTZ,
    "completed_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_call_transitions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "service_call_id" UUID NOT NULL,
    "action" "call_action" NOT NULL,
    "from_status" "call_status",
    "to_status" "call_status" NOT NULL,
    "actor_user_id" UUID,
    "device_event_id" UUID,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_call_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "organization_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "gateway_id" UUID NOT NULL,
    "device_id" UUID,
    "device_code" TEXT NOT NULL,
    "button_key" TEXT,
    "transport" "transport" NOT NULL,
    "payload" JSONB NOT NULL,
    "sent_at" TIMESTAMPTZ,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" "device_event_result" NOT NULL,
    "service_call_id" UUID,
    "correlation_id" UUID NOT NULL,

    CONSTRAINT "device_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "event_type" TEXT NOT NULL,
    "event_version" INTEGER NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organization_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "correlation_id" UUID NOT NULL,
    "causation_id" UUID,
    "payload" JSONB NOT NULL,
    "dispatched_at" TIMESTAMPTZ,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_zones_id_location" ON "zones"("id", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_dining_tables_id_location" ON "dining_tables"("id", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_gateways_key_hash" ON "gateways"("key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "uq_gateways_id_location" ON "gateways"("id", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_devices_id_location" ON "devices"("id", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_devices_code" ON "devices"("location_id", "code") WHERE (deactivated_at IS NULL);

-- CreateIndex
CREATE INDEX "ix_device_assignments_table" ON "device_assignments"("table_id") WHERE (unassigned_at IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "uq_device_assignments_active" ON "device_assignments"("device_id") WHERE (unassigned_at IS NULL);

-- CreateIndex
CREATE INDEX "ix_service_calls_board" ON "service_calls"("location_id") WHERE (status = ANY (ARRAY['pending'::call_status, 'in_progress'::call_status]));

-- CreateIndex
CREATE INDEX "ix_service_calls_history" ON "service_calls"("location_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_service_calls_active" ON "service_calls"("table_id", "call_type") WHERE (status = ANY (ARRAY['pending'::call_status, 'in_progress'::call_status]));

-- CreateIndex
CREATE INDEX "ix_service_call_transitions_call" ON "service_call_transitions"("service_call_id", "occurred_at");

-- CreateIndex
CREATE INDEX "ix_device_events_device" ON "device_events"("device_id", "received_at" DESC);

-- CreateIndex
CREATE INDEX "ix_device_events_unknown" ON "device_events"("location_id", "received_at" DESC) WHERE (result = 'unknown_device');

-- CreateIndex
CREATE INDEX "ix_outbox_pending" ON "outbox_events"("next_attempt_at") WHERE (dispatched_at IS NULL);

-- AddForeignKey
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_zone_id_location_id_fkey" FOREIGN KEY ("zone_id", "location_id") REFERENCES "zones"("id", "location_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_device_id_location_id_fkey" FOREIGN KEY ("device_id", "location_id") REFERENCES "devices"("id", "location_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_assignments" ADD CONSTRAINT "device_assignments_table_id_location_id_fkey" FOREIGN KEY ("table_id", "location_id") REFERENCES "dining_tables"("id", "location_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_calls" ADD CONSTRAINT "service_calls_table_id_location_id_fkey" FOREIGN KEY ("table_id", "location_id") REFERENCES "dining_tables"("id", "location_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_call_transitions" ADD CONSTRAINT "service_call_transitions_service_call_id_fkey" FOREIGN KEY ("service_call_id") REFERENCES "service_calls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_events" ADD CONSTRAINT "device_events_gateway_id_location_id_fkey" FOREIGN KEY ("gateway_id", "location_id") REFERENCES "gateways"("id", "location_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_events" ADD CONSTRAINT "device_events_service_call_id_fkey" FOREIGN KEY ("service_call_id") REFERENCES "service_calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===== SQL explícito (DATA-001): índices parciales/por expresión, CHECK, defaults que Prisma no expresa =====

-- Nombre de zona único entre activas del local, sin distinguir mayúsculas.
CREATE UNIQUE INDEX "uq_zones_name" ON "zones" ("location_id", lower("name")) WHERE "deactivated_at" IS NULL;

-- Misma etiqueta permitida en zonas distintas; nunca dentro de la misma zona (ni dos "sin zona" iguales).
CREATE UNIQUE INDEX "uq_dining_tables_label"
  ON "dining_tables" ("location_id", "zone_id", lower("label")) NULLS NOT DISTINCT
  WHERE "deactivated_at" IS NULL;

-- Una asignación cerrada tiene fecha y autor del cierre; una abierta, ninguno.
ALTER TABLE "device_assignments" ADD CONSTRAINT "ck_device_assignments_closed"
  CHECK (("unassigned_at" IS NULL) = ("unassigned_by" IS NULL));

-- Una solicitud cuenta al menos una pulsación; el estado y sus fechas no pueden contradecirse.
ALTER TABLE "service_calls" ADD CONSTRAINT "ck_service_calls_press_count" CHECK ("press_count" >= 1);
ALTER TABLE "service_calls" ADD CONSTRAINT "ck_service_calls_status_dates" CHECK (
  ("status" = 'pending'     AND "acknowledged_at" IS NULL     AND "completed_at" IS NULL) OR
  ("status" = 'in_progress' AND "acknowledged_at" IS NOT NULL AND "completed_at" IS NULL) OR
  ("status" = 'completed'   AND "acknowledged_at" IS NOT NULL AND "completed_at" IS NOT NULL)
);
ALTER TABLE "service_calls" ADD CONSTRAINT "ck_service_calls_acknowledged_actor" CHECK (("acknowledged_at" IS NULL) = ("acknowledged_by" IS NULL));
ALTER TABLE "service_calls" ADD CONSTRAINT "ck_service_calls_completed_actor" CHECK (("completed_at" IS NULL) = ("completed_by" IS NULL));

-- Toda transición tiene origen: una persona o un evento de botón.
ALTER TABLE "service_call_transitions" ADD CONSTRAINT "ck_service_call_transitions_origin"
  CHECK ("actor_user_id" IS NOT NULL OR "device_event_id" IS NOT NULL);
