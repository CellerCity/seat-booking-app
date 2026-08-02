ALTER TABLE "trips" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "cancelled_by" uuid;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;