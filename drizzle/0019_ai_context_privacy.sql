CREATE TABLE IF NOT EXISTS `user_ai_context_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`memory_enabled` integer DEFAULT 0 NOT NULL CHECK (`memory_enabled` IN (0, 1)),
	`conversation_context_enabled` integer DEFAULT 0 NOT NULL CHECK (`conversation_context_enabled` IN (0, 1)),
	`recent_activity_enabled` integer DEFAULT 0 NOT NULL CHECK (`recent_activity_enabled` IN (0, 1)),
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `oauth_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user_recent_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`activity_type` text NOT NULL CHECK (`activity_type` IN ('menu', 'information', 'exchange')),
	`target_code` text NOT NULL,
	`reference_id` text DEFAULT '' NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `oauth_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `user_recent_activities_user_target_uidx` ON `user_recent_activities` (`user_id`,`activity_type`,`target_code`,`reference_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_recent_activities_user_time_idx` ON `user_recent_activities` (`user_id`,`occurred_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_recent_activities_time_idx` ON `user_recent_activities` (`occurred_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ai_conversation_contexts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`topic` text NOT NULL,
	`user_excerpt` text NOT NULL,
	`assistant_excerpt` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `oauth_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ai_conversation_contexts_user_time_idx` ON `ai_conversation_contexts` (`user_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ai_conversation_contexts_time_idx` ON `ai_conversation_contexts` (`created_at`);
