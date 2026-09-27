CREATE TABLE IF NOT EXISTS `youth_policy_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`profile_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `oauth_users`(`id`) ON UPDATE no action ON DELETE cascade
);
