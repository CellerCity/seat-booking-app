ALTER TABLE "dues" ADD COLUMN "claimed_amount" integer;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "collected_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "collect_upi_vpa" text;--> statement-breakpoint
ALTER TABLE "trips" ADD COLUMN "collect_upi_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "upi_vpa" text;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_collected_by_user_id_users_id_fk" FOREIGN KEY ("collected_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;