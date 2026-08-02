CREATE TYPE "public"."action_source" AS ENUM('self', 'coordinator');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."due_action" AS ENUM('generate', 'claim', 'verify', 'unverify', 'waive', 'amend');--> statement-breakpoint
CREATE TYPE "public"."due_status" AS ENUM('unpaid', 'claimed', 'verified', 'waived');--> statement-breakpoint
CREATE TYPE "public"."member_type" AS ENUM('regular', 'guest');--> statement-breakpoint
CREATE TYPE "public"."response_action" AS ENUM('book', 'withdraw', 'approve_late', 'decline_late');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('traveller', 'coordinator');--> statement-breakpoint
CREATE TYPE "public"."trip_status" AS ENUM('draft', 'poll_open', 'locked', 'in_progress', 'completed', 'settled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_action" AS ENUM('register', 'approve', 'reject', 'block', 'unblock', 'promote', 'demote');--> statement-breakpoint
CREATE TABLE "attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"boarded" boolean DEFAULT true NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"marked_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_trip_user_uq" UNIQUE("trip_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "cab_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"capacity" integer NOT NULL,
	"default_cost" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cabs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"cab_type_id" uuid NOT NULL,
	"contractor_name" text,
	"contractor_phone" text,
	"agreed_cost" integer,
	"actual_cost" integer,
	"dispatched_early" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "due_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"due_id" uuid NOT NULL,
	"action" "due_action" NOT NULL,
	"from_status" text,
	"to_status" text,
	"amount" integer,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "dues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"breakdown" jsonb,
	"status" "due_status" DEFAULT 'unpaid' NOT NULL,
	"claimed_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"paid_by_user_id" uuid,
	"method" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dues_trip_user_uq" UNIQUE("trip_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "response_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"action" "response_action" NOT NULL,
	"from_value" text,
	"to_value" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "action_source" NOT NULL,
	"actor_id" uuid
);
--> statement-breakpoint
CREATE TABLE "responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"going" boolean NOT NULL,
	"first_responded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "action_source" DEFAULT 'self' NOT NULL,
	"recorded_by" uuid,
	"late_approved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "responses_trip_user_uq" UNIQUE("trip_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trip_id" uuid NOT NULL,
	"total_cab_cost" integer NOT NULL,
	"riders" integer NOT NULL,
	"per_head" integer NOT NULL,
	"rounding_shortfall" integer DEFAULT 0 NOT NULL,
	"total_collected" integer DEFAULT 0 NOT NULL,
	"contractor_paid_at" timestamp with time zone,
	"contractor_paid_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlements_trip_id_unique" UNIQUE("trip_id")
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_date" date NOT NULL,
	"destination" text NOT NULL,
	"departure_time" time NOT NULL,
	"status" "trip_status" DEFAULT 'draft' NOT NULL,
	"poll_opened_at" timestamp with time zone,
	"poll_closes_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"locked_by" uuid,
	"locked_count" integer,
	"link_token" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trips_link_token_unique" UNIQUE("link_token")
);
--> statement-breakpoint
CREATE TABLE "user_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"action" "user_action" NOT NULL,
	"from_status" text,
	"to_status" text,
	"reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"role" "role" DEFAULT 'traveller' NOT NULL,
	"member_type" "member_type" DEFAULT 'regular' NOT NULL,
	"affiliation" text,
	"approval_status" "approval_status" DEFAULT 'pending' NOT NULL,
	"blocked_reason" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"can_manage_coordinators" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_unique" UNIQUE("phone"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cabs" ADD CONSTRAINT "cabs_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cabs" ADD CONSTRAINT "cabs_cab_type_id_cab_types_id_fk" FOREIGN KEY ("cab_type_id") REFERENCES "public"."cab_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_events" ADD CONSTRAINT "due_events_due_id_dues_id_fk" FOREIGN KEY ("due_id") REFERENCES "public"."dues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_events" ADD CONSTRAINT "due_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dues" ADD CONSTRAINT "dues_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dues" ADD CONSTRAINT "dues_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dues" ADD CONSTRAINT "dues_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dues" ADD CONSTRAINT "dues_paid_by_user_id_users_id_fk" FOREIGN KEY ("paid_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_events" ADD CONSTRAINT "response_events_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_events" ADD CONSTRAINT "response_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_events" ADD CONSTRAINT "response_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_trip_id_trips_id_fk" FOREIGN KEY ("trip_id") REFERENCES "public"."trips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_contractor_paid_by_users_id_fk" FOREIGN KEY ("contractor_paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trips" ADD CONSTRAINT "trips_locked_by_users_id_fk" FOREIGN KEY ("locked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_events" ADD CONSTRAINT "user_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_events" ADD CONSTRAINT "user_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_trip_idx" ON "attendance" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "cabs_trip_idx" ON "cabs" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "due_events_due_idx" ON "due_events" USING btree ("due_id","occurred_at");--> statement-breakpoint
CREATE INDEX "dues_user_status_idx" ON "dues" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "dues_status_idx" ON "dues" USING btree ("status");--> statement-breakpoint
CREATE INDEX "response_events_trip_idx" ON "response_events" USING btree ("trip_id","occurred_at");--> statement-breakpoint
CREATE INDEX "responses_trip_going_idx" ON "responses" USING btree ("trip_id","going");--> statement-breakpoint
CREATE INDEX "trips_status_idx" ON "trips" USING btree ("status");--> statement-breakpoint
CREATE INDEX "trips_event_date_idx" ON "trips" USING btree ("event_date");--> statement-breakpoint
CREATE INDEX "user_events_user_idx" ON "user_events" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "users_approval_status_idx" ON "users" USING btree ("approval_status");