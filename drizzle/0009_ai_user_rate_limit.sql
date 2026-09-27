CREATE TABLE `ai_user_rate_limits` (
	`user_id` text PRIMARY KEY NOT NULL,
	`window_started_at` integer NOT NULL,
	`request_count` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `oauth_users`(`id`) ON UPDATE no action ON DELETE cascade
);
