CREATE TABLE `developer_admins` (
	`slot` integer PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_subject` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `oauth_users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `developer_admins_user_id_uidx` ON `developer_admins` (`user_id`);--> statement-breakpoint
CREATE TABLE `service_api_credentials` (
	`key_name` text PRIMARY KEY NOT NULL,
	`encrypted_value` text NOT NULL,
	`iv` text NOT NULL,
	`masked_suffix` text NOT NULL,
	`updated_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `oauth_users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `service_api_credentials_updated_by_idx` ON `service_api_credentials` (`updated_by_user_id`);