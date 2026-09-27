CREATE TABLE `public_data_snapshots` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'empty' NOT NULL,
	`item_count` integer DEFAULT 0 NOT NULL,
	`last_successful_at` integer,
	`next_refresh_at` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` integer DEFAULT 0 NOT NULL,
	`lock_until` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `public_data_user_reads` (
	`user_id` text NOT NULL,
	`category` text NOT NULL,
	`seen_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `oauth_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `public_data_user_reads_user_category_uidx` ON `public_data_user_reads` (`user_id`,`category`);--> statement-breakpoint
CREATE INDEX `public_data_user_reads_seen_idx` ON `public_data_user_reads` (`user_id`,`seen_at`);