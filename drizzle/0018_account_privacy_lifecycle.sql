CREATE TABLE IF NOT EXISTS `user_required_consents` (
	`user_id` text NOT NULL,
	`terms_version` text NOT NULL,
	`privacy_version` text NOT NULL,
	`accepted_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `terms_version`, `privacy_version`),
	FOREIGN KEY (`user_id`) REFERENCES `oauth_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_required_consents_user_accepted_idx` ON `user_required_consents` (`user_id`,`accepted_at`);
