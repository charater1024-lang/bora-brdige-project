CREATE TABLE IF NOT EXISTS `financial_law_guidance_cache` (
	`topic` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`retrieved_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
