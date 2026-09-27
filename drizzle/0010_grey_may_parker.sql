CREATE TABLE `public_item_analysis_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`generation` integer DEFAULT 1 NOT NULL,
	`item_id` text NOT NULL,
	`category` text NOT NULL,
	`locale` text NOT NULL,
	`provider` text NOT NULL,
	`configured_model` text NOT NULL,
	`response_model` text,
	`prompt_version` text NOT NULL,
	`content_hash` text NOT NULL,
	`explanation` text DEFAULT '' NOT NULL,
	`source_name` text NOT NULL,
	`source_url` text NOT NULL,
	`source_expires_at` text,
	`status` text DEFAULT 'generating' NOT NULL,
	`lock_token` text,
	`lock_until` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`hit_count` integer DEFAULT 0 NOT NULL,
	`generated_at` integer,
	`last_accessed_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `public_item_analysis_cache_runtime_idx` ON `public_item_analysis_cache` (`generation`,`provider`,`configured_model`,`status`);--> statement-breakpoint
CREATE INDEX `public_item_analysis_cache_cleanup_idx` ON `public_item_analysis_cache` (`generation`,`last_accessed_at`);--> statement-breakpoint
CREATE TABLE `public_item_analysis_cache_meta` (
	`slot` integer PRIMARY KEY NOT NULL,
	`generation` integer DEFAULT 1 NOT NULL,
	`last_cleared_at` integer,
	`last_cleared_by_user_id` text,
	FOREIGN KEY (`last_cleared_by_user_id`) REFERENCES `oauth_users`(`id`) ON UPDATE no action ON DELETE set null
);
