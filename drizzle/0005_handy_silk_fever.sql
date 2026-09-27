CREATE TABLE `ai_chat_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`topic` text NOT NULL,
	`source_count` integer DEFAULT 0 NOT NULL,
	`locale` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `oauth_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_chat_events_user_created_idx` ON `ai_chat_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_chat_events_user_topic_idx` ON `ai_chat_events` (`user_id`,`topic`);