CREATE TABLE `judge_evaluation_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_by_user_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`rubric_version` text NOT NULL,
	`dataset_id` text NOT NULL,
	`dataset_hash` text NOT NULL,
	`session_json` text NOT NULL,
	`total_score` integer DEFAULT 0 NOT NULL,
	`gate_status` text DEFAULT 'review' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`sealed_at` integer,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `oauth_users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "judge_evaluation_sessions_status_check" CHECK("judge_evaluation_sessions"."status" IN ('draft', 'review', 'sealed')),
	CONSTRAINT "judge_evaluation_sessions_score_check" CHECK("judge_evaluation_sessions"."total_score" >= 0 AND "judge_evaluation_sessions"."total_score" <= 100),
	CONSTRAINT "judge_evaluation_sessions_gate_check" CHECK("judge_evaluation_sessions"."gate_status" IN ('review', 'pass', 'fail')),
	CONSTRAINT "judge_evaluation_sessions_title_size_check" CHECK(length("judge_evaluation_sessions"."title") BETWEEN 1 AND 80),
	CONSTRAINT "judge_evaluation_sessions_payload_size_check" CHECK(length("judge_evaluation_sessions"."session_json") <= 131072)
);
--> statement-breakpoint
CREATE INDEX `judge_evaluation_sessions_creator_updated_idx` ON `judge_evaluation_sessions` (`created_by_user_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `judge_evaluation_sessions_status_updated_idx` ON `judge_evaluation_sessions` (`status`,`updated_at`);
