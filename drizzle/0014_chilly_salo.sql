CREATE TABLE `financial_law_summary_cache` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`topic` text NOT NULL,
	`locale` text NOT NULL,
	`provider` text NOT NULL,
	`configured_model` text NOT NULL,
	`response_model` text,
	`prompt_version` text NOT NULL,
	`source_fingerprint` text NOT NULL,
	`law_name` text NOT NULL,
	`law_id` text NOT NULL,
	`law_version` text NOT NULL,
	`source_url` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
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
CREATE INDEX `financial_law_summary_runtime_idx` ON `financial_law_summary_cache` (`provider`,`configured_model`,`locale`,`status`);--> statement-breakpoint
CREATE INDEX `financial_law_summary_source_idx` ON `financial_law_summary_cache` (`topic`,`source_fingerprint`,`status`);