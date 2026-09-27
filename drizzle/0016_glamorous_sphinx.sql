CREATE TABLE `public_data_catalog_chunks` (
	`source_id` text NOT NULL,
	`category` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`payload` text NOT NULL,
	`item_count` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`source_id`, `category`, `chunk_index`)
);
--> statement-breakpoint
CREATE INDEX `public_data_catalog_chunks_category_idx` ON `public_data_catalog_chunks` (`category`,`source_id`,`chunk_index`);