-- Technical connectivity probe for WIN-14.
CREATE TABLE "connection_probes" (
    "id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connection_probes_pkey" PRIMARY KEY ("id")
);
