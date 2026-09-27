CREATE TABLE `ai_user_memories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`topic` text NOT NULL,
	`summary` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `oauth_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_user_memories_user_updated_idx` ON `ai_user_memories` (`user_id`,`updated_at`);