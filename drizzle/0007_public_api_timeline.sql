CREATE TABLE `public_api_source_state` (
	`source_id` text PRIMARY KEY NOT NULL,
	`quota_day` text DEFAULT '' NOT NULL,
	`used_calls` integer DEFAULT 0 NOT NULL,
	`reserved_calls` integer DEFAULT 0 NOT NULL,
	`daily_limit` integer DEFAULT 0 NOT NULL,
	`quota_verified` integer DEFAULT false NOT NULL,
	`next_due_at` integer DEFAULT 0 NOT NULL,
	`last_success_at` integer,
	`last_attempt_at` integer DEFAULT 0 NOT NULL,
	`backoff_until` integer DEFAULT 0 NOT NULL,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `public_api_source_state_due_idx` ON `public_api_source_state` (`next_due_at`,`backoff_until`);--> statement-breakpoint
CREATE TABLE `exchange_rate_points` (
	`source_id` text NOT NULL,
	`currency` text NOT NULL,
	`base_currency` text NOT NULL,
	`effective_date` text NOT NULL,
	`base_rate` real NOT NULL,
	`quoted_unit` integer NOT NULL,
	`quoted_rate` real NOT NULL,
	`captured_at` integer NOT NULL,
	CONSTRAINT "exchange_rate_points_pk" PRIMARY KEY(`source_id`,`currency`,`effective_date`)
);
--> statement-breakpoint
CREATE INDEX `exchange_rate_points_currency_date_idx` ON `exchange_rate_points` (`currency`,`effective_date`);
