CREATE TABLE `ai_provider_settings` (
	`provider` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`model_id` text NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `oauth_users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `ai_provider_settings_updated_by_idx` ON `ai_provider_settings` (`updated_by_user_id`);