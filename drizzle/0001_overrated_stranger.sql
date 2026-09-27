CREATE TABLE `user_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`provider_name` text,
	`provider_nickname` text,
	`display_name_mode` text DEFAULT 'nickname' NOT NULL,
	`bora_alias` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `oauth_users`(`id`) ON UPDATE no action ON DELETE cascade
);
