CREATE TABLE `public_youth_policy_catalog_chunks` (
	`catalog_key` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`payload` text NOT NULL,
	`item_count` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`catalog_key`, `chunk_index`)
);
