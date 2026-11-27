CREATE TABLE "whatsapp_qr_connection" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'desconectado' NOT NULL,
	"phone" text,
	"profile_name" text,
	"connected_at" timestamp,
	"last_seen_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_qr_connection" ADD CONSTRAINT "whatsapp_qr_connection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;