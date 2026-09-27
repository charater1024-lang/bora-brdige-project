CREATE TABLE `service_api_settings` (
	`key_name` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `oauth_users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `service_api_settings_updated_by_idx` ON `service_api_settings` (`updated_by_user_id`);