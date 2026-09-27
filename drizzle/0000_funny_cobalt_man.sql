CREATE TABLE `auth_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `oauth_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_user_id_idx` ON `auth_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `auth_sessions_expires_at_idx` ON `auth_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `oauth_transactions` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`code_verifier` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`return_to` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer
);
--> statement-breakpoint
CREATE INDEX `oauth_transactions_expires_at_idx` ON `oauth_transactions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `oauth_users` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`provider_subject` text NOT NULL,
	`display_name` text NOT NULL,
	`email` text,
	`email_verified` integer,
	`profile_image_url` text,
	`gender` text,
	`birthday` text,
	`birth_year` text,
	`age_range` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_users_provider_subject_uidx` ON `oauth_users` (`provider`,`provider_subject`);--> statement-breakpoint
CREATE INDEX `oauth_users_provider_idx` ON `oauth_users` (`provider`);