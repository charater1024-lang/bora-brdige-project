CREATE TABLE `user_finance_snapshots` (
	`user_id` text PRIMARY KEY NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`snapshot_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `oauth_users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_finance_snapshots_version_check" CHECK("user_finance_snapshots"."schema_version" = 1),
	CONSTRAINT "user_finance_snapshots_payload_size_check" CHECK(length("user_finance_snapshots"."snapshot_json") <= 2048)
);
--> statement-breakpoint
CREATE INDEX `user_finance_snapshots_updated_at_idx` ON `user_finance_snapshots` (`updated_at`);
