CREATE TABLE `exchange_history_backfill_checkpoint` (
	`source_id` text PRIMARY KEY NOT NULL,
	`historical_cursor_date` text,
	`historical_floor_date` text NOT NULL,
	`gap_cursor_date` text,
	`gap_floor_date` text,
	`latest_observed_date` text NOT NULL,
	`completed_at` integer,
	`last_attempt_at` integer,
	`last_error` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `public_api_backfill_checkpoints` (
	`source_id` text PRIMARY KEY NOT NULL,
	`query_signature` text NOT NULL,
	`query_state` text DEFAULT '{}' NOT NULL,
	`next_page` integer DEFAULT 1 NOT NULL,
	`page_size` integer NOT NULL,
	`provider_total_count` integer,
	`fetched_count` integer DEFAULT 0 NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`latest_refresh_at` integer,
	`completed_at` integer,
	`updated_at` integer NOT NULL,
	CONSTRAINT "public_api_backfill_checkpoint_page_check" CHECK("public_api_backfill_checkpoints"."next_page" >= 1 AND "public_api_backfill_checkpoints"."page_size" >= 1 AND "public_api_backfill_checkpoints"."fetched_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `public_api_backfill_checkpoint_status_idx` ON `public_api_backfill_checkpoints` (`completed`,`updated_at`);--> statement-breakpoint
CREATE TABLE `public_api_backfill_pages` (
	`source_id` text NOT NULL,
	`query_signature` text NOT NULL,
	`page_number` integer NOT NULL,
	`payload` text NOT NULL,
	`item_count` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`source_id`, `query_signature`, `page_number`),
	CONSTRAINT "public_api_backfill_pages_values_check" CHECK("public_api_backfill_pages"."page_number" >= 0 AND "public_api_backfill_pages"."item_count" >= 0)
);
